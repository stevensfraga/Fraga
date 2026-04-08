/**
 * certificateUploadRouter.ts
 * Endpoint HTTPS para receber certificados PFX/P12 do Windows via HTTP POST.
 * Autenticação via header x-admin-key.
 *
 * Estratégia de persistência:
 *   - O conteúdo binário do PFX é salvo na coluna pfx_data (MEDIUMBLOB) da tabela certificates
 *   - O arquivo também é gravado em /data/certificados como cache temporário para o scanner
 *   - Ao iniciar, o servidor restaura os PFX do banco para o disco (ver restoreCertificatesFromDb)
 *   - Isso garante que os certificados sobrevivem a qualquer restart ou deploy
 *
 * POST /api/certificados/upload
 *   Header: x-admin-key: <FRAGA_ADMIN_KEY>
 *   Body: multipart/form-data, campo "file" com o .pfx ou .p12
 *
 * POST /api/certificados/upload-batch
 *   Header: x-admin-key: <FRAGA_ADMIN_KEY>
 *   Body: multipart/form-data, campo "files[]" com múltiplos .pfx ou .p12
 *
 * GET /api/certificados/list
 *   Header: x-admin-key: <FRAGA_ADMIN_KEY>
 *   Lista os arquivos presentes no disco (cache)
 *
 * POST /api/certificados/restore
 *   Header: x-admin-key: <FRAGA_ADMIN_KEY>
 *   Restaura todos os PFX do banco para o disco (útil após deploy)
 */

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import mysql from "mysql2/promise";
import forge from "node-forge";
import { runCertificateScanner } from "./services/certificateScannerService";

const router = express.Router();

const logger = {
  info: (msg: string) => console.log(`[CertUpload] ${msg}`),
  warn: (msg: string) => console.warn(`[CertUpload] WARN ${msg}`),
  error: (msg: string) => console.error(`[CertUpload] ERROR ${msg}`),
};

// ─── Pasta de destino (cache temporário) ──────────────────────────────────────
const CERT_DIR = process.env.CERTIFICATES_PATH || "/data/certificados";

// Garantir que a pasta existe
if (!fs.existsSync(CERT_DIR)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  logger.info(`Pasta criada: ${CERT_DIR}`);
}

function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

// ─── Multer — memória (para salvar no banco) ───────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máximo
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pfx" || ext === ".p12") {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${ext}. Apenas .pfx e .p12 são aceitos.`));
    }
  },
});

// ─── Middleware de autenticação ───────────────────────────────────────────────
function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const adminKey = process.env.FRAGA_ADMIN_KEY;
  const providedKey = req.headers["x-admin-key"];

  if (!adminKey) {
    logger.error("FRAGA_ADMIN_KEY não configurada no servidor");
    res.status(500).json({ success: false, error: "Configuração do servidor incompleta" });
    return;
  }

  if (!providedKey || providedKey !== adminKey) {
    logger.warn(`Tentativa de upload com chave inválida — IP: ${req.ip}`);
    res.status(401).json({ success: false, error: "Chave de autenticação inválida" });
    return;
  }

  next();
}

/**
 * Sanitiza o nome do arquivo removendo caracteres perigosos
 */
function sanitizeFilename(originalname: string): string {
  return originalname
    .replace(/[^a-zA-Z0-9._\-\u00C0-\u024F\u0400-\u04FF ]/g, "_")
    .replace(/\s+/g, "_");
}

/**
 * Salva o buffer do PFX no banco de dados (coluna pfx_data) e no disco (cache).
 * Faz upsert baseado no file_name — se já existe, atualiza o blob.
 * Retorna o ID do registro no banco.
 */
async function savePfxToDb(
  buffer: Buffer,
  filename: string,
  originalname: string,
  filePath: string
): Promise<number> {
  const conn = await getConn();
  try {
    // Verificar se já existe um registro com este nome de arquivo
    const [existing] = await conn.execute(
      "SELECT id FROM certificates WHERE file_name = ? AND is_active = 1 LIMIT 1",
      [filename]
    ) as [any[], any];

    if (existing.length > 0) {
      // Atualizar o blob existente
      await conn.execute(
        "UPDATE certificates SET pfx_data = ?, file_path = ?, updated_at = NOW() WHERE id = ?",
        [buffer, filePath, existing[0].id]
      );
      logger.info(`PFX atualizado no banco: ${filename} (id=${existing[0].id})`);
      return existing[0].id;
    } else {
      // Inserir novo registro com o blob
      // CNPJ será extraído pelo scanner após processar o arquivo
      const cnpjMatch = filename.match(/\b(\d{14}|\d{11})\b/);
      const cnpj = cnpjMatch ? cnpjMatch[1] : "unknown";

      const [result] = await conn.execute(
        `INSERT INTO certificates (cnpj, file_path, file_name, pfx_data, status, source, version, is_active, last_checked_at)
         VALUES (?, ?, ?, ?, 'unknown', 'upload', 1, 1, NOW())`,
        [cnpj, filePath, filename, buffer]
      ) as [any, any];

      const insertId = result.insertId;
      logger.info(`PFX salvo no banco: ${filename} (id=${insertId}, cnpj=${cnpj})`);
      return insertId;
    }
  } finally {
    await conn.end();
  }
}

// ─── POST /api/certificados/upload ───────────────────────────────────────────
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: express.Request, res: express.Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: "Nenhum arquivo enviado. Use o campo 'file' no multipart/form-data." });
      return;
    }

    const filename = sanitizeFilename(req.file.originalname);
    const filePath = path.join(CERT_DIR, filename);
    const buffer = req.file.buffer;
    const size = buffer.length;

    try {
      // 1. Salvar no disco (cache para o scanner/watcher)
      fs.writeFileSync(filePath, buffer);

      // 2. Salvar no banco (persistência permanente)
      const dbId = await savePfxToDb(buffer, filename, req.file.originalname, filePath);

      logger.info(`Certificado recebido: ${filename} (${(size / 1024).toFixed(1)} KB) — IP: ${req.ip} — DB id=${dbId}`);

      res.json({
        success: true,
        filename,
        originalName: req.file.originalname,
        size,
        sizeKB: Math.round(size / 1024),
        path: filePath,
        dbId,
        savedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error(`Erro ao salvar certificado ${filename}: ${err.message}`);
      res.status(500).json({ success: false, error: `Erro ao salvar certificado: ${err.message}` });
    }
  }
);

// ─── POST /api/certificados/upload-batch ─────────────────────────────────────
router.post(
  "/upload-batch",
  authMiddleware,
  upload.array("files", 100),
  async (req: express.Request, res: express.Response) => {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: "Nenhum arquivo enviado. Use o campo 'files' no multipart/form-data." });
      return;
    }

    const results: Array<{ filename: string; originalName: string; sizeKB: number; success: boolean; dbId?: number; error?: string }> = [];

    for (const f of files) {
      const filename = sanitizeFilename(f.originalname);
      const filePath = path.join(CERT_DIR, filename);
      const buffer = f.buffer;

      try {
        // 1. Salvar no disco (cache)
        fs.writeFileSync(filePath, buffer);

        // 2. Salvar no banco (persistência)
        const dbId = await savePfxToDb(buffer, filename, f.originalname, filePath);

        results.push({
          filename,
          originalName: f.originalname,
          sizeKB: Math.round(buffer.length / 1024),
          success: true,
          dbId,
        });
      } catch (err: any) {
        logger.error(`Erro ao salvar ${filename}: ${err.message}`);
        results.push({
          filename,
          originalName: f.originalname,
          sizeKB: Math.round(buffer.length / 1024),
          success: false,
          error: err.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info(`Batch upload: ${successCount}/${files.length} certificado(s) salvos — IP: ${req.ip}`);

    res.json({
      success: true,
      count: successCount,
      total: files.length,
      files: results,
      savedAt: new Date().toISOString(),
    });
  }
);

// ─── GET /api/certificados/list ──────────────────────────────────────────────
router.get("/list", authMiddleware, (_req: express.Request, res: express.Response) => {
  try {
    const files = fs
      .readdirSync(CERT_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.(pfx|p12)$/i.test(d.name))
      .map((d) => {
        const stat = fs.statSync(path.join(CERT_DIR, d.name));
        return {
          filename: d.name,
          sizeKB: Math.round(stat.size / 1024),
          modifiedAt: stat.mtime.toISOString(),
        };
      });

    res.json({ success: true, count: files.length, basePath: CERT_DIR, files });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});// ─── POST /api/certificados/scan-admin ───────────────────────────────────────────
// Dispara o scanner completo com x-admin-key (sem OAuth)
router.post("/scan-admin", authMiddleware, async (_req: express.Request, res: express.Response) => {
  try {
    logger.info("[CertAdmin] Scanner manual disparado via /scan-admin");
    const result = await runCertificateScanner();
    res.json({
      success: true,
      scanned: result.scanned,
      updated: result.updated,
      errors: result.errors,
      passwordFailed: result.passwordFailed,
      byStatus: result.byStatus,
      basePath: result.basePath,
      siegSent: result.siegSent,
      siegFailed: result.siegFailed,
      siegSkipped: result.siegSkipped,
      message: `Scanner concluído: ${result.scanned} escaneados, ${result.updated} atualizados, ${result.errors} erros. SIEG: ${result.siegSent} enviados, ${result.siegFailed} erros`,
    });
  } catch (err: any) {
    logger.error(`[CertAdmin] Erro no scanner: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/certificados/diag ─────────────────────────────────────────────────
// Diagnóstico: testa node-forge nos arquivos reais
router.get("/diag", authMiddleware, async (_req: express.Request, res: express.Response) => {
  const result: any = {
    certDir: CERT_DIR,
    nodeForgeAvailable: true,
    files: [],
    tests: [],
  };

  // Listar arquivos
  let files: string[] = [];
  try {
    files = fs.readdirSync(CERT_DIR).filter(f => /\.(pfx|p12)$/i.test(f));
    result.fileCount = files.length;
    result.files = files.slice(0, 5);
  } catch (e: any) {
    result.listError = e.message;
  }

  // Testar até 3 arquivos com node-forge
  const targets = files.filter(f => f.includes('WILLCAFE') || f.includes('AEL') || f.includes('RPM') || f.includes('Zenilton') || f.includes('359678'));
  const testFiles = [...targets.slice(0, 2), ...files.slice(0, 1)].slice(0, 3);
  const senhas = ['abc123', 'Abcd@1234', 'Fraga@123', 'Fraga@1234', '1234', '123456', ''];

  for (const filename of testFiles) {
    const filePath = path.join(CERT_DIR, filename);
    const stat = fs.statSync(filePath);
    const buf = fs.readFileSync(filePath);
    const binaryStr = buf.toString('binary');
    const fileInfo: any = {
      filename,
      sizeBytes: stat.size,
      firstBytesHex: buf.slice(0, 8).toString('hex'),
      encoding: buf.slice(0, 2).toString('hex') === '3082' ? 'DER' : 'BER',
      forgeResults: [],
    };

    for (const senha of senhas) {
      try {
        const asn1 = forge.asn1.fromDer(binaryStr, { strict: false } as any);
        const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
        const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const cert = (bags as any)[forge.pki.oids.certBag]?.[0]?.cert;
        fileInfo.forgeResults.push({
          senha,
          ok: true,
          cn: cert?.subject?.getField('CN')?.value,
          notAfter: cert?.validity?.notAfter,
        });
        break;
      } catch (e: any) {
        fileInfo.forgeResults.push({ senha, ok: false, error: e.message?.substring(0, 100) });
      }
    }

    result.tests.push(fileInfo);
  }

  res.json(result);
});

// ─── POST /api/certificados/restore ──────────────────────────────────────────────
// Restaura todos os PFX do banco para o disco (útil após deploy/restart)
router.post("/restore", authMiddleware, async (_req: express.Request, res: express.Response) => { try {
    const restored = await restoreCertificatesFromDb();
    res.json({ success: true, restored, message: `${restored} certificados restaurados para ${CERT_DIR}` });
  } catch (err: any) {
    logger.error(`Erro ao restaurar certificados: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Tratamento de erro do multer ─────────────────────────────────────────────
router.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ success: false, error: "Arquivo muito grande. Limite: 10 MB." });
      return;
    }
    res.status(400).json({ success: false, error: `Erro no upload: ${err.message}` });
    return;
  }
  if (err) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }
});

/**
 * Restaura todos os PFX do banco de dados para o disco.
 * Chamado no boot do servidor para garantir que os arquivos existem no disco
 * mesmo após um deploy/restart que apaga /data/certificados.
 *
 * Só restaura arquivos que têm pfx_data no banco e não existem no disco.
 * Retorna o número de arquivos restaurados.
 */
export async function restoreCertificatesFromDb(): Promise<number> {
  let restored = 0;
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(
      "SELECT id, file_name, file_path, pfx_data FROM certificates WHERE is_active = 1 AND pfx_data IS NOT NULL"
    ) as [any[], any];

    if (rows.length === 0) {
      logger.info("Nenhum certificado com pfx_data no banco para restaurar.");
      return 0;
    }

    logger.info(`Restaurando ${rows.length} certificados do banco para o disco...`);

    // Garantir que a pasta existe
    if (!fs.existsSync(CERT_DIR)) {
      fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    for (const row of rows) {
      const filename = row.file_name;
      const filePath = path.join(CERT_DIR, filename);

      // Só restaurar se não existe no disco (evitar sobrescrever arquivos mais novos)
      if (!fs.existsSync(filePath)) {
        try {
          const buffer = Buffer.isBuffer(row.pfx_data) ? row.pfx_data : Buffer.from(row.pfx_data);
          fs.writeFileSync(filePath, buffer);
          restored++;
          logger.info(`Restaurado: ${filename}`);
        } catch (err: any) {
          logger.error(`Erro ao restaurar ${filename}: ${err.message}`);
        }
      }
    }

    logger.info(`Restauração concluída: ${restored}/${rows.length} arquivos restaurados para ${CERT_DIR}`);
    return restored;
  } finally {
    await conn.end();
  }
}

export default router;
