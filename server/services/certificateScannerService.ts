/**
 * Certificate Scanner Service
 *
 * Lê arquivos .pfx/.p12 de uma pasta monitorada no servidor,
 * extrai metadados (validade, serial, emissor, CNPJ) e persiste no banco.
 *
 * Lógica de senhas (tentadas em ordem):
 *   1. Extraída do nome do arquivo (última parte após _ ou espaço antes do .pfx)
 *   2. CERT_PASSWORD_DEFAULT (env) — padrão: Abcd@1234
 *   3. Sem senha (string vazia)
 *   4. CNPJ extraído do nome do arquivo como senha
 *
 * Estruturas de pasta suportadas:
 *   1. Plana:      {basePath}/EMPRESA_CNPJ.pfx
 *   2. Por CNPJ:   {basePath}/{CNPJ}/certificado.pfx
 *   3. Mista:      qualquer combinação acima
 *
 * Prioridade do caminho base:
 *   1. CERTIFICATES_PATH (env)
 *   2. /data/certificados
 *   3. /opt/fraga/certificados
 *   4. /home/ubuntu/certificados (dev/sandbox)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import mysql from "mysql2/promise";
import chokidar, { FSWatcher } from "chokidar";
import forge from "node-forge";
import { uploadCertificadoSieg } from "./siegService";

// Chave de criptografia para senhas (mesma usada no certificatesRouter)
const ENCRYPTION_KEY = (process.env.JWT_SECRET || "fraga-cert-key-32chars-minimum!!").substring(0, 32);

function decryptPassword(encrypted: string): string | null {
  try {
    const [ivHex, encHex] = encrypted.split(":");
    if (!ivHex || !encHex) return null;
    const iv = Buffer.from(ivHex, "hex");
    const encBuf = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
    const decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

const CERT_BASE_PATHS = [
  process.env.CERTIFICATES_PATH,
  "/data/certificados",
  "/opt/fraga/certificados",
  "/home/ubuntu/certificados",
].filter(Boolean) as string[];

// Remove duplicatas mantendo ordem
const CERT_PATHS_DEDUP = CERT_BASE_PATHS.filter((v, i, a) => a.indexOf(v) === i);

const logger = {
  info: (msg: string, ...args: unknown[]) => console.log(`[CertScanner] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[CertScanner] ⚠️ ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[CertScanner] ❌ ${msg}`, ...args),
};

export interface CertMetadata {
  cnpj: string;
  filePath: string;
  fileName: string;
  fileHash: string;
  serialNumber: string | null;
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  status: "valid" | "expiring_30" | "expiring_15" | "expiring_7" | "expired" | "invalid" | "unknown";
  passwordUsed?: string | null; // qual senha funcionou (para debug)
}

function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/**
 * Calcula o hash SHA-256 de um arquivo
 */
function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Extrai a(s) senha(s) do nome do arquivo.
 *
 * Padrões reais identificados nos arquivos de produção:
 *   1. `SENHA-MpR9310m`         → senha: MpR9310m
 *   2. `- Senha Abcd@1234`      → senha: Abcd@1234
 *   3. `- Abcd@1234`            → senha: Abcd@1234 (sem a palavra Senha)
 *   4. `Senha abc123`           → senha: abc123
 *   5. `_senha_Abcd_1234`       → senha: Abcd@1234 (underscore = @)
 *   6. `_-_Abcd_1234`           → senha: Abcd@1234
 *
 * Os nomes dos arquivos podem ter espaços OU underscores como separadores.
 * Normalização: "Abcd_1234" → "Abcd@1234" (underscore entre letras e dígitos = @)
 *
 * NÃO extrai de nomes comuns como EMPRESA_LTDA_CNPJ.pfx
 */
function extractPasswordFromName(fileName: string): string | null {
  const semExtensao = fileName.replace(/\.(pfx|p12)$/i, "");

  /**
   * Normaliza a senha extraída:
   * - "Abcd 1234" ou "Abcd_1234" → "Abcd@1234"
   * - "abc123", "MpR9310m", "Well9982" → sem alteração
   */
  function normalizePassword(raw: string): string {
    const trimmed = raw.trim().replace(/^[_\s]+|[_\s]+$/g, "");
    return trimmed.replace(/^([A-Za-z]+)[\s_](\d+)$/, "$1@$2");
  }

  // ─── Padrões com UNDERSCORE como separador ────────────────────────────────

  // Padrão U1: _senha_VALOR ou _SENHA_VALOR (ex: "_senha_Abcd_1234", "_SENHA_19191919")
  // Usa greedy para capturar "Abcd_1234" inteiro, depois remove sufixo _Validade
  const u1 = semExtensao.match(/[_\-](?:senha|password)[_\-](.+)$/i);
  if (u1) {
    // Remove sufixo _Validade_DD-MM-AAAA e underscores extras no final
    const raw = u1[1].replace(/_+[Vv]alidade.*/i, "").replace(/_+\d{1,2}[_-]?$/g, "").replace(/_+$/, "");
    if (raw.length >= 1) return normalizePassword(raw);
  }

  // Padrão U2: _-_VALOR no final (ex: "_-_Abcd_1234", "_-_senha_Well9982")
  const u2 = semExtensao.match(/_-_(.+)$/);
  if (u2) {
    // Se contiver _senha_ ou _Senha_ dentro, extrair a parte após isso
    const innerSenha = u2[1].match(/(?:senha|password)[_\-](.+?)(?:_[Vv]alidade.*)?$/i);
    if (innerSenha) return normalizePassword(innerSenha[1].replace(/_+$/, ""));
    // Senão, pegar o valor após _-_ (pode ser "Abcd_1234" = "Abcd@1234")
    const val = u2[1].replace(/_+$/, "").trim();
    const ehSoCnpj = /^\d{8,14}$/.test(val);
    const ehPalavraComum = /^(LTDA|ME|SA|EPP|EIRELI|CNPJ|CPF|CERT|DIGITAL|VALIDADE|VENCIMENTO)$/i.test(val);
    if (!ehSoCnpj && !ehPalavraComum && val.length >= 4) return normalizePassword(val);
  }

  // Padrão U3: _Senha_VALOR ou _Senha_VALOR_Validade...
  // Usa greedy para capturar "Abcd_1234" inteiro, depois remove sufixo _Validade
  const u3 = semExtensao.match(/_[Ss]enha_(.+)$/);
  if (u3) {
    const raw = u3[1].replace(/_+[Vv]alidade.*/i, "").replace(/_+\d{1,2}[_-]?$/g, "").replace(/_+$/, "");
    if (raw.length >= 1) return normalizePassword(raw);
  }

  // Padrão U4: _VALOR no final onde VALOR é alfanumérico simples (sem underscore)
  // Ex: "SMART_monxuara_senha_yu694775" já capturado por U1
  // Ex: "WJ_..._SENHA_19191919" já capturado por U1
  const u4 = semExtensao.match(/_([A-Za-z][A-Za-z0-9@#!$%^&*]+)$/);
  if (u4) {
    const candidato = u4[1];
    const ehPalavraComum = /^(LTDA|ME|SA|EPP|EIRELI|CNPJ|CPF|CERT|DIGITAL|VALIDADE|VENCIMENTO|LTDA\d+)$/i.test(candidato);
    if (!ehPalavraComum && candidato.length >= 4) return normalizePassword(candidato);
  }

  // Padrão U5: _LETRAS_DIGITOS no final (ex: "Abcd_1234", "Zama_2025")
  // Ex: "VINOX_INDUSTRIA_Abcd_1234" → "Abcd@1234"
  // Ex: "SAO_JERONIMO_HOLDING_LTDA_Abcd_1234" → "Abcd@1234"
  const u5 = semExtensao.match(/_([A-Za-z][A-Za-z0-9]*)_(\d+)$/);
  if (u5) {
    const candidato = `${u5[1]}_${u5[2]}`;
    const ehPalavraComum = /^(LTDA|ME|SA|EPP|EIRELI|CNPJ|CPF|CERT|DIGITAL)_\d+$/i.test(candidato);
    if (!ehPalavraComum) return normalizePassword(candidato);
  }

  // ─── Padrões com ESPAÇO como separador ──────────────────────────────────────
  // Normaliza underscores para espaços para os padrões abaixo
  const normalizado = semExtensao.replace(/_/g, " ").trim();

  // Padrão E1: SENHA- ou SENHA (ex: "SENHA-MpR9310m")
  const e1 = normalizado.match(/SENHA[-\s]+([^\s]+)$/i);
  if (e1) return normalizePassword(e1[1]);

  // Padrão E2: "Senha XXXX" ou "- Senha XXXX" no final
  const e2 = normalizado.match(/(?:-\s*)?[Ss]enha\s+([^\s]+)$/i);
  if (e2) return normalizePassword(e2[1]);

  // Padrão E3: " - XXXX" no final (sem a palavra Senha)
  const e3 = normalizado.match(/\s+-\s+([^\s]+)$/);
  if (e3) {
    const candidato = e3[1];
    const ehSoCnpj = /^\d{8,14}$/.test(candidato);
    const ehPalavraComum = /^(LTDA|ME|SA|EPP|EIRELI|CNPJ|CPF|CERT|DIGITAL|VALIDADE|VENCIMENTO)$/i.test(candidato);
    if (!ehSoCnpj && !ehPalavraComum && candidato.length >= 4) return normalizePassword(candidato);
  }

  return null;
}

/**
 * Tenta extrair CNPJ de um nome de arquivo ou caminho de diretório
 * Ex: "12345678000195 - EMPRESA.pfx" → "12345678000195"
 *     "12345678000195" (nome da pasta) → "12345678000195"
 */
function extractCnpjFromName(name: string): string | null {
  // Remove extensão se houver
  const base = path.basename(name, path.extname(name));
  // Procura sequência de 14 dígitos (CNPJ)
  const match14 = base.match(/\b(\d{14})\b/);
  if (match14) return match14[1];
  // Procura sequência de 11 dígitos (CPF)
  const match11 = base.match(/\b(\d{11})\b/);
  if (match11) return match11[1];
  // Remove pontuação e tenta novamente
  const digits = base.replace(/\D/g, "");
  if (digits.length === 14 || digits.length === 11) return digits;
  return null;
}

/**
 * Monta a lista de senhas a tentar para um arquivo, em ordem de prioridade:
 * 1. Senha extraída do nome do arquivo
 * 2. Lista de senhas padrão (CERT_PASSWORD_LIST env ou lista embutida)
 * 3. Sem senha (string vazia)
 * 4. CNPJ extraído do nome como senha
 *
 * CERT_PASSWORD_LIST: lista separada por vírgula, ex: "Fraga@123,Abcd@1234,1234"
 */

/** Lista de senhas padrão embutida (fallback quando CERT_PASSWORD_LIST não está definida) */
const DEFAULT_PASSWORD_LIST = [
  "Fraga@123",
  "Fraga@1234",
  "Fraga123",
  "Abcd@1234",
  "abc123",   // Senha mais comum nos certificados A1 enviados via Sync-Certificados
  "abc@123",
  "Abc@123",
  "1234",
  "123456",
];

function buildPasswordList(fileName: string): string[] {
  const senhas: string[] = [];

  // Helper para adicionar sem duplicatas
  const add = (s: string) => { if (!senhas.includes(s)) senhas.push(s); };

  // 1. Senha extraída do nome do arquivo
  const senhaDoNome = extractPasswordFromName(fileName);
  if (senhaDoNome) add(senhaDoNome);

  // 2. Lista de senhas padrão (env CERT_PASSWORD_LIST ou lista embutida)
  const envList = process.env.CERT_PASSWORD_LIST;
  const passwordList = envList
    ? envList.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_PASSWORD_LIST;

  for (const senha of passwordList) {
    add(senha);
  }

  // Também incluir CERT_PASSWORD_DEFAULT se definido e não estiver na lista
  const senhaDefault = process.env.CERT_PASSWORD_DEFAULT;
  if (senhaDefault) add(senhaDefault);

  // 3. Sem senha
  add("");

  // 4. CNPJ como senha
  const cnpj = extractCnpjFromName(fileName);
  if (cnpj) add(cnpj);

  return senhas;
}

/**
 * Extrai metadados de um certificado PFX/P12 usando node-forge.
 * Suporta tanto DER (3082) quanto BER (3080) encoding, comum em certificados A1 brasileiros.
 * Tenta as senhas na ordem fornecida e retorna na primeira que funcionar.
 */
function extractCertMetadataWithPasswords(
  filePath: string,
  passwords: string[]
): { meta: Partial<CertMetadata>; passwordUsed: string | null } {
  const buf = fs.readFileSync(filePath);
  const binaryStr = buf.toString("binary");

  for (const password of passwords) {
    try {
      // Tentar parsear como ASN.1 com strict:false para suportar BER (3080) e DER (3082)
      const asn1 = forge.asn1.fromDer(binaryStr, { strict: false } as any);
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

      // Extrair certificados do bag
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag = (certBags as any)[forge.pki.oids.certBag];
      if (!certBag || certBag.length === 0) continue;

      const cert = certBag[0]?.cert;
      if (!cert) continue;

      const meta: Partial<CertMetadata> = {};

      // Validade
      meta.validFrom = cert.validity.notBefore;
      meta.validTo = cert.validity.notAfter;

      // Serial number
      meta.serialNumber = cert.serialNumber?.toUpperCase();

      // Subject
      const cn = cert.subject.getField("CN")?.value || "";
      const o = cert.subject.getField("O")?.value || "";
      meta.subject = cn || o;

      // Issuer
      const issuerCn = cert.issuer.getField("CN")?.value || "";
      const issuerO = cert.issuer.getField("O")?.value || "";
      meta.issuer = issuerCn || issuerO;

      // CNPJ: tentar extrair do CN (formato: NOME:CNPJ14DIGITOS)
      const cnpjInCn = cn.match(/(\d{14})/);
      if (cnpjInCn) meta.cnpj = cnpjInCn[1];

      // Sucesso
      return { meta, passwordUsed: password };
    } catch {
      // Senha incorreta ou formato inválido — tenta a próxima
      continue;
    }
  }

  // Nenhuma senha funcionou
  return { meta: {}, passwordUsed: null };
}

/**
 * Versão exportada de extractCertMetadataWithPasswords que aceita Buffer diretamente
 * (usada pelo router de certificados para tentar senha informada manualmente)
 */
export function extractCertMetadataFromBuffer(
  buf: Buffer,
  passwords: string[]
): { meta: Partial<CertMetadata>; passwordUsed: string | null } {
  const binaryStr = buf.toString("binary");

  for (const password of passwords) {
    try {
      const asn1 = forge.asn1.fromDer(binaryStr, { strict: false } as any);
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag = (certBags as any)[forge.pki.oids.certBag];
      if (!certBag || certBag.length === 0) continue;

      const cert = certBag[0]?.cert;
      if (!cert) continue;

      const meta: Partial<CertMetadata> = {};
      meta.validFrom = cert.validity.notBefore;
      meta.validTo = cert.validity.notAfter;
      meta.serialNumber = cert.serialNumber?.toUpperCase();

      const cn = cert.subject.getField("CN")?.value || "";
      const o = cert.subject.getField("O")?.value || "";
      meta.subject = cn || o;

      const issuerCn = cert.issuer.getField("CN")?.value || "";
      const issuerO = cert.issuer.getField("O")?.value || "";
      meta.issuer = issuerCn || issuerO;

      const cnpjInCn = cn.match(/(\d{14})/);
      if (cnpjInCn) meta.cnpj = cnpjInCn[1];

      return { meta, passwordUsed: password };
    } catch {
      continue;
    }
  }

  return { meta: {}, passwordUsed: null };
}

/**
 * Calcula o status do certificado baseado na data de vencimento
 */
export function calcCertStatus(validTo: Date | null): CertMetadata["status"] {
  return calcStatus(validTo);
}

/**
 * Calcula o status do certificado baseado na data de vencimento
 */
function calcStatus(validTo: Date | null): CertMetadata["status"] {
  if (!validTo) return "unknown";
  const now = new Date();
  const diffMs = validTo.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "expired";
  if (diffDays <= 7) return "expiring_7";
  if (diffDays <= 15) return "expiring_15";
  if (diffDays <= 30) return "expiring_30";
  return "valid";
}

/**
 * Encontra a pasta base de certificados disponível no servidor
 * Prioriza CERTIFICATES_PATH do env
 */
export function findCertBasePath(): string | null {
  for (const p of CERT_PATHS_DEDUP) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Lista todos os certificados PFX/P12 na pasta monitorada
 * Suporta estrutura plana e estrutura por subpasta de CNPJ
 */
export function listCertFiles(basePath: string): Array<{ cnpj: string; filePath: string; fileName: string }> {
  const result: Array<{ cnpj: string; filePath: string; fileName: string }> = [];

  if (!fs.existsSync(basePath)) return result;

  const entries = fs.readdirSync(basePath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      // Estrutura por subpasta: {basePath}/{CNPJ}/arquivo.pfx
      const cnpjFromDir = extractCnpjFromName(entry.name);
      const subFiles = fs.readdirSync(fullPath);
      for (const file of subFiles) {
        const ext = path.extname(file).toLowerCase();
        if (ext !== ".pfx" && ext !== ".p12") continue;
        const filePath = path.join(fullPath, file);
        // CNPJ: preferir do nome do arquivo, fallback para nome da pasta
        const cnpjFromFile = extractCnpjFromName(file);
        const cnpj = cnpjFromFile ?? cnpjFromDir;
        if (!cnpj) continue;
        result.push({ cnpj, filePath, fileName: file });
      }
    } else if (entry.isFile()) {
      // Estrutura plana: {basePath}/EMPRESA_CNPJ.pfx
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".pfx" && ext !== ".p12") continue;
      const cnpj = extractCnpjFromName(entry.name);
      if (!cnpj) {
        // Sem CNPJ no nome — incluir mesmo assim, CNPJ virá do certificado
        result.push({ cnpj: "unknown", filePath: fullPath, fileName: entry.name });
        continue;
      }
      result.push({ cnpj, filePath: fullPath, fileName: entry.name });
    }
  }

  return result;
}

/**
 * Processa um único arquivo de certificado e persiste no banco.
 * Tenta múltiplas senhas automaticamente.
 */
async function processCertFile(
  conn: mysql.Connection,
  cnpjHint: string,
  filePath: string,
  fileName: string
): Promise<CertMetadata | null> {
  try {
    const fileHash = hashFile(filePath);

    const [existing] = await conn.execute(
      "SELECT id, file_hash FROM certificates WHERE cnpj = ? AND is_active = 1 ORDER BY version DESC LIMIT 1",
      [cnpjHint]
    ) as [any[], any];

    // Tentar múltiplas senhas
    const passwords = buildPasswordList(fileName);
    const { meta, passwordUsed } = extractCertMetadataWithPasswords(filePath, passwords);

    if (passwordUsed === null) {
      logger.warn(`Nenhuma senha funcionou para: ${fileName} (tentadas: ${passwords.length})`);
    } else if (passwordUsed === "") {
      logger.info(`Senha vazia funcionou para: ${fileName}`);
    } else {
      logger.info(`Senha "${passwordUsed}" funcionou para: ${fileName}`);
    }

    // CNPJ final: do certificado > do hint do arquivo/pasta
    const cnpj = (meta as any).cnpj ?? cnpjHint;
    const status = passwordUsed !== null ? calcStatus(meta.validTo ?? null) : "unknown";

    const certData: CertMetadata = {
      cnpj,
      filePath,
      fileName,
      fileHash,
      serialNumber: meta.serialNumber ?? null,
      issuer: meta.issuer ?? null,
      subject: meta.subject ?? null,
      validFrom: meta.validFrom ?? null,
      validTo: meta.validTo ?? null,
      status,
      passwordUsed,
    };

    if (existing.length > 0 && existing[0].file_hash === fileHash) {
      // Arquivo não mudou — apenas atualizar lastCheckedAt e status
      await conn.execute(
        "UPDATE certificates SET status = ?, last_checked_at = NOW() WHERE id = ?",
        [status, existing[0].id]
      );
    } else {
      // Novo certificado ou versão atualizada
      if (existing.length > 0) {
        await conn.execute(
          "UPDATE certificates SET is_active = 0 WHERE cnpj = ? AND is_active = 1",
          [cnpj]
        );
      }

      await conn.execute(
        `INSERT INTO certificates 
          (cnpj, file_path, file_name, file_hash, serial_number, issuer, subject, valid_from, valid_to, status, source, version, is_active, last_checked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scanner', 1, 1, NOW())`,
        [
          cnpj,
          filePath,
          fileName,
          fileHash,
          certData.serialNumber,
          certData.issuer,
          certData.subject,
          certData.validFrom,
          certData.validTo,
          status,
        ]
      );
    }

    const vencimento = certData.validTo?.toLocaleDateString("pt-BR") ?? "N/A";
    logger.info(`✅ ${cnpj} — ${status} — vence: ${vencimento}`);
    return certData;
  } catch (err) {
    logger.error(`Erro ao processar ${filePath}:`, err);
    return null;
  }
}

/**
 * Escaneia todos os certificados e atualiza o banco de dados.
 * Retorna resumo com contagem por status.
 */
export async function runCertificateScanner(): Promise<{
  scanned: number;
  updated: number;
  errors: number;
  passwordFailed: number;
  summary: CertMetadata[];
  basePath: string | null;
  byStatus: Record<string, number>;
  siegSent: number;
  siegFailed: number;
  siegSkipped: number;
}> {
  let updated = 0;
  let errors = 0;
  let passwordFailed = 0;
  const summary: CertMetadata[] = [];
  const byStatus: Record<string, number> = {};
  const processedFileNames = new Set<string>();

  // ─── Fase 1: Escanear arquivos do disco ───────────────────────────────────
  const basePath = findCertBasePath();
  const conn = await getConn();

  try {
    if (basePath) {
      logger.info(`Escaneando pasta: ${basePath}`);
      const certFiles = listCertFiles(basePath);
      logger.info(`Encontrados ${certFiles.length} arquivos de certificado no disco`);

      for (const { cnpj, filePath, fileName } of certFiles) {
        const result = await processCertFile(conn, cnpj, filePath, fileName);
        if (result) {
          summary.push(result);
          updated++;
          processedFileNames.add(fileName);
          if (result.passwordUsed === null) passwordFailed++;
          byStatus[result.status] = (byStatus[result.status] || 0) + 1;
        } else {
          errors++;
        }
      }
    } else {
      logger.warn("Pasta de certificados não encontrada no disco. Caminhos verificados:", CERT_PATHS_DEDUP);
    }

    // ─── Fase 2: Processar certificados do banco que têm pfx_data mas não estão no disco ──
    // Isso garante que certificados persistidos no banco sejam re-escaneados após deploys
    const [dbRows] = await conn.execute(
      "SELECT id, file_name, file_path, pfx_data, cnpj FROM certificates WHERE is_active = 1 AND pfx_data IS NOT NULL"
    ) as [any[], any];

    const dbOnlyRows = dbRows.filter((row: any) => !processedFileNames.has(row.file_name));

    if (dbOnlyRows.length > 0) {
      logger.info(`Fase 2: ${dbOnlyRows.length} certificados no banco sem arquivo no disco — restaurando e re-escaneando...`);

      // Garantir que a pasta existe
      const certDir = basePath || CERT_PATHS_DEDUP[0] || "/data/certificados";
      if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
      }

      for (const row of dbOnlyRows) {
        const fileName = row.file_name as string;
        const filePath = path.join(certDir, fileName);
        const cnpjHint = (row.cnpj as string) || extractCnpjFromName(fileName) || "unknown";

        try {
          // Restaurar arquivo do banco para o disco
          const buffer = Buffer.isBuffer(row.pfx_data) ? row.pfx_data : Buffer.from(row.pfx_data);
          fs.writeFileSync(filePath, buffer);

          // Processar o arquivo restaurado
          const result = await processCertFile(conn, cnpjHint, filePath, fileName);
          if (result) {
            summary.push(result);
            updated++;
            processedFileNames.add(fileName);
            if (result.passwordUsed === null) passwordFailed++;
            byStatus[result.status] = (byStatus[result.status] || 0) + 1;
          } else {
            errors++;
          }
        } catch (err: any) {
          logger.error(`Erro ao restaurar/processar ${fileName} do banco: ${err.message}`);
          errors++;
        }
      }
    }
  } finally {
    await conn.end();
  }

  logger.info(`Scanner concluído: ${summary.length} escaneados, ${updated} atualizados, ${errors} erros, ${passwordFailed} sem senha válida`);

  // ─── Fase 3: Envio automático ao SIEG ────────────────────────────────────
  // Envia ao SIEG todos os certificados válidos/vencendo que ainda não foram enviados
  // Só executa se SIEG_API_KEY estiver configurada
  let siegSent = 0;
  let siegFailed = 0;
  let siegSkipped = 0;

  if (process.env.SIEG_API_KEY) {
    logger.info("Fase 3: Enviando certificados ao SIEG...");
    const connSieg = await getConn();
    try {
      const [pendentes] = await connSieg.execute(
        `SELECT id, cnpj, file_path, file_name, subject, pfx_data, status
         FROM certificates
         WHERE is_active = 1
           AND status IN ('valid', 'expiring_30', 'expiring_15', 'expiring_7')
           AND (sieg_status IS NULL OR sieg_status = 'pending' OR sieg_status = 'error')
         LIMIT 200`
      ) as [any[], any];

      logger.info(`Fase 3: ${pendentes.length} certificados pendentes de envio ao SIEG`);

      for (const row of pendentes) {
        try {
          // Obter buffer do PFX: do disco ou do banco
          let pfxBuffer: Buffer | null = null;
          if (row.file_path && fs.existsSync(row.file_path)) {
            pfxBuffer = fs.readFileSync(row.file_path);
          } else if (row.pfx_data) {
            pfxBuffer = Buffer.isBuffer(row.pfx_data) ? row.pfx_data : Buffer.from(row.pfx_data);
          }

          if (!pfxBuffer) {
            logger.warn(`SIEG: sem arquivo PFX para ${row.file_name} — pulando`);
            siegSkipped++;
            continue;
          }

          // Obter senha do certificado (da tabela certificate_secrets)
          const [secretRows] = await connSieg.execute(
            "SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? ORDER BY created_at DESC LIMIT 1",
            [row.id]
          ) as [any[], any];
          // Descriptografar senha salva, ou usar senha padrão
          const encryptedPwd = secretRows[0]?.encrypted_password;
          const decryptedPwd = encryptedPwd ? decryptPassword(encryptedPwd) : null;
          const password = decryptedPwd ?? process.env.CERT_PASSWORD_DEFAULT ?? "Abcd@1234";

          // Extrair nome da empresa do subject CN
          const companyName = row.subject
            ? (row.subject.match(/CN=([^,]+)/)?.[1] ?? row.cnpj)
            : row.cnpj;

          const result = await uploadCertificadoSieg(
            row.cnpj,
            companyName,
            pfxBuffer,
            password
          );

          if (result.success) {
            await connSieg.execute(
              "UPDATE certificates SET sieg_status = 'sent', sieg_id = ?, sieg_sent_at = NOW() WHERE id = ?",
              [result.siegId ?? null, row.id]
            );
            siegSent++;
            logger.info(`SIEG ✅ ${row.file_name} — ID: ${result.siegId}`);
          } else {
            await connSieg.execute(
              "UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?",
              [result.error?.substring(0, 255) ?? "Erro desconhecido", row.id]
            );
            siegFailed++;
            logger.warn(`SIEG ❌ ${row.file_name}: ${result.error}`);
          }
        } catch (err: any) {
          logger.error(`SIEG erro inesperado em ${row.file_name}: ${err.message}`);
          siegFailed++;
        }
      }
    } finally {
      await connSieg.end();
    }
    logger.info(`Fase 3 SIEG: ${siegSent} enviados, ${siegFailed} erros, ${siegSkipped} ignorados`);
  } else {
    logger.info("Fase 3: SIEG_API_KEY não configurada — envio ao SIEG ignorado");
  }

  return { scanned: summary.length, updated, errors, passwordFailed, summary, basePath, byStatus, siegSent, siegFailed, siegSkipped };
}

/**
 * Atualiza o status de todos os certificados ativos baseado na data atual
 * (para rodar diariamente sem re-escanear arquivos)
 */
export async function refreshCertificateStatuses(): Promise<void> {
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(
      "SELECT id, valid_to FROM certificates WHERE is_active = 1"
    ) as [any[], any];

    for (const row of rows) {
      const status = calcStatus(row.valid_to ? new Date(row.valid_to) : null);
      await conn.execute(
        "UPDATE certificates SET status = ?, last_checked_at = NOW() WHERE id = ?",
        [status, row.id]
      );
    }
    logger.info(`Status de ${rows.length} certificados atualizado`);
  } finally {
    await conn.end();
  }
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

let activeWatcher: FSWatcher | null = null;

/**
 * Inicia o watcher de pasta de certificados usando chokidar.
 * Detecta novos arquivos e modificações automaticamente.
 * Só inicia se a pasta existir.
 */
export function startCertificateWatcher(): void {
  const basePath = findCertBasePath();
  if (!basePath) {
    logger.warn("Watcher não iniciado: pasta de certificados não encontrada.");
    return;
  }

  if (activeWatcher) {
    logger.info("Watcher já está ativo.");
    return;
  }

  logger.info(`Iniciando watcher em: ${basePath}`);

  activeWatcher = chokidar.watch(basePath, {
    persistent: true,
    ignoreInitial: true, // não processar arquivos existentes no boot (o scanner faz isso)
    depth: 2, // subpastas até 2 níveis
    awaitWriteFinish: {
      stabilityThreshold: 3000, // aguarda 3s sem modificação antes de processar
      pollInterval: 500,
    },
  });

  const handleFile = async (filePath: string, event: "add" | "change") => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".pfx" && ext !== ".p12") return;

    logger.info(`[Watcher] ${event === "add" ? "Novo arquivo" : "Arquivo modificado"}: ${filePath}`);

    const fileName = path.basename(filePath);
    const parentDir = path.dirname(filePath);
    const isInSubdir = parentDir !== basePath;

    let cnpjHint = "unknown";
    if (isInSubdir) {
      cnpjHint = extractCnpjFromName(path.basename(parentDir)) ?? extractCnpjFromName(fileName) ?? "unknown";
    } else {
      cnpjHint = extractCnpjFromName(fileName) ?? "unknown";
    }

    try {
      const conn = await getConn();
      try {
        await processCertFile(conn, cnpjHint, filePath, fileName);
        logger.info(`[Watcher] ✅ Certificado processado automaticamente: ${fileName}`);
      } finally {
        await conn.end();
      }
    } catch (err) {
      logger.error(`[Watcher] Erro ao processar ${filePath}:`, err);
    }
  };

  activeWatcher
    .on("add", (filePath) => handleFile(filePath, "add"))
    .on("change", (filePath) => handleFile(filePath, "change"))
    .on("error", (err) => logger.error("Erro no watcher:", err))
    .on("ready", () => logger.info(`[Watcher] ✅ Monitorando: ${basePath}`));
}

/**
 * Para o watcher ativo
 */
export async function stopCertificateWatcher(): Promise<void> {
  if (activeWatcher) {
    await activeWatcher.close();
    activeWatcher = null;
    logger.info("Watcher encerrado.");
  }
}

/**
 * Retorna o status atual do watcher
 */
export function getCertificateWatcherStatus(): { active: boolean; basePath: string | null } {
  return {
    active: activeWatcher !== null,
    basePath: findCertBasePath(),
  };
}
