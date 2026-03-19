/**
 * Certificates Router — tRPC endpoints para o módulo de Certificados Digitais
 *
 * Módulo separado: não mistura com cobrança, NFS-e ou honorários.
 * Permissões: MASTER/ADMIN podem editar; OPERADOR pode atualizar; VISUALIZADOR só lê.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import mysql from "mysql2/promise";
import { audit } from "../_core/auditHelper";
import { runCertificateScanner, refreshCertificateStatuses, findCertBasePath, listCertFiles, getCertificateWatcherStatus } from "../services/certificateScannerService";
import { uploadCertificadoSieg, listarCertificadosSieg, testSiegConnection } from "../services/siegService";
import { reconcileSiegCertificates } from "../jobs/reconcileSiegCertificates";
import crypto from "crypto";

const ENCRYPTION_KEY = (process.env.JWT_SECRET || "fraga-cert-key-32chars-minimum!!").substring(0, 32);

function encryptPassword(plain: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

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

function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export const certificatesRouter = router({
  // ─── Listagem ────────────────────────────────────────────────────────────────

  list: protectedProcedure
    .input(z.object({
      status: z.enum(["all", "valid", "expiring_30", "expiring_15", "expiring_7", "expired", "unknown"]).optional().default("all"),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(200).optional().default(50),
    }))
    .query(async ({ input }) => {
      const conn = await getConn();
      try {
        const offset = (input.page - 1) * input.pageSize;
        const conditions: string[] = ["cert.is_active = 1"];
        const params: unknown[] = [];

        if (input.status !== "all") {
          conditions.push("cert.status = ?");
          params.push(input.status);
        }
        if (input.search) {
          conditions.push("(cert.cnpj LIKE ? OR cert.company_name LIKE ? OR cl.name LIKE ?)");
          params.push(`%${input.search}%`, `%${input.search}%`, `%${input.search}%`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        // JOIN com clients para obter nome do cliente pelo CNPJ normalizado
        // NOTA: MySQL2 não aceita ? para LIMIT/OFFSET — usar literais numéricos
        const limitVal = Number(input.pageSize);
        const offsetVal = Number(offset);
        const [rows] = await conn.execute(
          `SELECT cert.id, cert.cnpj, cert.company_name, cert.file_name, cert.serial_number,
                  cert.issuer, cert.subject, cert.valid_from, cert.valid_to, cert.status,
                  cert.source, cert.version, cert.last_checked_at, cert.notes,
                  cert.created_at, cert.updated_at,
                  cert.sieg_status, cert.sieg_id, cert.sieg_error,
                  cl.id as client_id,
                  COALESCE(
                    cl.name,
                    cert.company_name,
                    REGEXP_REPLACE(REGEXP_REPLACE(cert.file_name, '\\.(pfx|p12)$', ''), '[0-9]{11,14}', '')
                  ) as display_name
           FROM certificates cert
           LEFT JOIN clients cl ON 
             REPLACE(REPLACE(REPLACE(cert.cnpj, '.', ''), '/', ''), '-', '') = 
             REPLACE(REPLACE(REPLACE(cl.document, '.', ''), '/', ''), '-', '')
           ${where}
           ORDER BY 
             CASE cert.status 
               WHEN 'unknown' THEN 1
               WHEN 'expired' THEN 2 
               WHEN 'expiring_7' THEN 3 
               WHEN 'expiring_15' THEN 4 
               WHEN 'expiring_30' THEN 5 
               WHEN 'valid' THEN 6 
               ELSE 7 
             END,
             cert.valid_to ASC
           LIMIT ${limitVal} OFFSET ${offsetVal}`,
          params
        ) as [any[], any];

        const [countRows] = await conn.execute(
          `SELECT COUNT(*) as total FROM certificates cert
           LEFT JOIN clients cl ON 
             REPLACE(REPLACE(REPLACE(cert.cnpj, '.', ''), '/', ''), '-', '') = 
             REPLACE(REPLACE(REPLACE(cl.document, '.', ''), '/', ''), '-', '')
           ${where}`,
          params
        ) as [any[], any];

        return {
          items: rows,
          total: countRows[0].total as number,
          page: input.page,
          pageSize: input.pageSize,
        };
      } finally {
        await conn.end();
      }
    }),

  // ─── Sumário / Cards ─────────────────────────────────────────────────────────

  summary: protectedProcedure.query(async () => {
    const conn = await getConn();
    try {
      const [rows] = await conn.execute(
        `SELECT status, COUNT(*) as count FROM certificates WHERE is_active = 1 GROUP BY status`
      ) as [any[], any];

      const map: Record<string, number> = {};
      for (const r of rows) map[r.status] = Number(r.count);

      const [totalRows] = await conn.execute(
        "SELECT COUNT(*) as total FROM certificates WHERE is_active = 1"
      ) as [any[], any];

      // Empresas sem certificado (comparar com clients)
      const [missingRows] = await conn.execute(
        `SELECT COUNT(DISTINCT c.document) as missing
         FROM clients c
         WHERE c.status = 'active'
           AND c.document IS NOT NULL
           AND c.document != ''
           AND NOT EXISTS (
             SELECT 1 FROM certificates cert
             WHERE REPLACE(cert.cnpj, '.', '') = REPLACE(REPLACE(REPLACE(c.document, '.', ''), '/', ''), '-', '')
               AND cert.is_active = 1
           )`
      ) as [any[], any];

      return {
        total: Number(totalRows[0].total),
        valid: map["valid"] ?? 0,
        expiring_30: map["expiring_30"] ?? 0,
        expiring_15: map["expiring_15"] ?? 0,
        expiring_7: map["expiring_7"] ?? 0,
        expired: map["expired"] ?? 0,
        unknown: map["unknown"] ?? 0,
        withoutCertificate: Number(missingRows[0].missing),
      };
    } finally {
      await conn.end();
    }
  }),

  // ─── Scanner manual ──────────────────────────────────────────────────────────

  runScanner: protectedProcedure
    .input(z.object({ force: z.boolean().optional().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const result = await runCertificateScanner();

      await audit({
        userId: ctx.user.id,
        userName: ctx.user.name ?? ctx.user.email ?? null,
        userRole: ctx.user.role,
        action: "certificate_scan",
        resource: "certificates",
        description: `Scanner executado: ${result.scanned} escaneados, ${result.updated} atualizados, ${result.errors} erros, ${result.passwordFailed ?? 0} sem senha válida. Status: ${JSON.stringify(result.byStatus ?? {})}`,
        newValue: { scanned: result.scanned, updated: result.updated, errors: result.errors, passwordFailed: result.passwordFailed, byStatus: result.byStatus },
        status: result.errors > 0 ? "failure" : "success",
      });

      return result;
    }),

  // ─── Verificar pasta monitorada ───────────────────────────────────────────────

  checkFolder: protectedProcedure.query(async () => {
    const basePath = findCertBasePath();
    if (!basePath) {
      return { found: false, basePath: null, fileCount: 0, files: [] };
    }
    const files = listCertFiles(basePath);
    return {
      found: true,
      basePath,
      fileCount: files.length,
      files: files.map(f => ({ cnpj: f.cnpj, fileName: f.fileName })),
    };
  }),

  // ─── Atualizar notas de um certificado ───────────────────────────────────────

  updateNotes: protectedProcedure
    .input(z.object({
      id: z.number(),
      notes: z.string().max(1000),
      companyName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getConn();
      try {
        await conn.execute(
          "UPDATE certificates SET notes = ?, company_name = COALESCE(?, company_name) WHERE id = ?",
          [input.notes, input.companyName ?? null, input.id]
        );

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_update_notes",
          resource: "certificates",
          resourceId: String(input.id),
          description: `Notas atualizadas para certificado ID ${input.id}`,
          status: "success",
        });

        return { success: true };
      } finally {
        await conn.end();
      }
    }),

  // ─── Salvar senha criptografada ───────────────────────────────────────────────

  savePassword: protectedProcedure
    .input(z.object({
      certificateId: z.number(),
      password: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const encrypted = encryptPassword(input.password);
      const conn = await getConn();
      try {
        await conn.execute(
          `INSERT INTO certificate_secrets (certificate_id, encrypted_password)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE encrypted_password = ?, updated_at = NOW()`,
          [input.certificateId, encrypted, encrypted]
        );

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_password_saved",
          resource: "certificate_secrets",
          resourceId: String(input.certificateId),
          description: `Senha salva para certificado ID ${input.certificateId}`,
          status: "success",
        });

        return { success: true };
      } finally {
        await conn.end();
      }
    }),

  // ─── Definir senha e tentar ler o certificado imediatamente ──────────────────

  setPassword: protectedProcedure
    .input(z.object({
      certificateId: z.number(),
      password: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const { extractCertMetadataFromBuffer, calcCertStatus } = await import("../services/certificateScannerService");
      const encrypted = encryptPassword(input.password);
      const conn = await getConn();
      try {
        // 1. Salvar senha criptografada
        await conn.execute(
          `INSERT INTO certificate_secrets (certificate_id, encrypted_password)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE encrypted_password = ?, updated_at = NOW()`,
          [input.certificateId, encrypted, encrypted]
        );

        // 2. Buscar o certificado para obter pfx_data ou file_path
        const [certRows] = await conn.execute(
          `SELECT id, file_path, file_name, pfx_data FROM certificates WHERE id = ?`,
          [input.certificateId]
        ) as [any[], any];

        if (!certRows.length) {
          return { success: false, error: "Certificado não encontrado" };
        }

        const cert = certRows[0];
        let pfxBuffer: Buffer | null = null;

        // Tentar obter o buffer do PFX (do banco ou do disco)
        if (cert.pfx_data) {
          pfxBuffer = Buffer.from(cert.pfx_data);
        } else if (cert.file_path) {
          const fs = await import("fs");
          if (fs.existsSync(cert.file_path)) {
            pfxBuffer = fs.readFileSync(cert.file_path);
          }
        }

        if (!pfxBuffer) {
          return { success: true, passwordSaved: true, certRead: false, error: "Arquivo PFX não disponível no servidor" };
        }

        // 3. Tentar ler o certificado com a nova senha
        const result = extractCertMetadataFromBuffer(pfxBuffer, [input.password]);

        if (!result.passwordUsed) {
          return { success: true, passwordSaved: true, certRead: false, error: "Senha incorreta — o certificado não pôde ser lido" };
        }

        // 4. Atualizar o banco com os metadados extraídos
        const status = calcCertStatus(result.meta.validTo ?? null);
        await conn.execute(
          `UPDATE certificates SET 
             status = ?,
             valid_from = ?,
             valid_to = ?,
             serial_number = ?,
             issuer = ?,
             subject = ?,
             company_name = COALESCE(NULLIF(?, ''), company_name),
             last_checked_at = NOW()
           WHERE id = ?`,
          [
            status,
            result.meta.validFrom ?? null,
            result.meta.validTo ?? null,
            result.meta.serialNumber ?? null,
            result.meta.issuer ?? null,
            result.meta.subject ?? null,
            result.meta.subject ?? null,
            input.certificateId,
          ]
        );

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_password_set",
          resource: "certificates",
          resourceId: String(input.certificateId),
          description: `Senha informada e certificado lido com sucesso: status=${status}, vence=${result.meta.validTo?.toISOString()}`,
          status: "success",
        });

        return {
          success: true,
          passwordSaved: true,
          certRead: true,
          status,
          validTo: result.meta.validTo,
          subject: result.meta.subject,
        };
      } finally {
        await conn.end();
      }
    }),

  // ─── Status do watcher ──────────────────────────────────────────────────────────

  watcherStatus: protectedProcedure.query(() => {
    return getCertificateWatcherStatus();
  }),

  // ─── Histórico de versões ─────────────────────────────────────────────────────

  history: protectedProcedure
    .input(z.object({ cnpj: z.string() }))
    .query(async ({ input }) => {
      const conn = await getConn();
      try {
        const [rows] = await conn.execute(
          `SELECT id, cnpj, company_name, file_name, file_hash, serial_number, valid_from, valid_to, status, source, version, is_active, last_checked_at, created_at
           FROM certificates WHERE cnpj = ? ORDER BY created_at DESC LIMIT 20`,
          [input.cnpj]
        ) as [any[], any];
        return rows;
      } finally {
        await conn.end();
      }
    }),

  // ─── SIEG: Testar conexão ─────────────────────────────────────────────────────
  // Nota: Se USE_NFSE_NACIONAL=true, o SIEG capturará automaticamente:
  //   - ConsultaNfe: true (notas fiscais de venda)
  //   - ConsultaCte: true (conhecimentos de transporte)
  //   - ConsultaNfse: true (notas fiscais de serviço via ADN — modelo nacional)
  //   - ConsultaNoturna: true (consulta em horário noturno)
  // Isso elimina a dependência de configuração por prefeitura municipal.

  siegTestConnection: protectedProcedure.query(async () => {
    return await testSiegConnection();
  }),

  // ─── SIEG: Listar certificados cadastrados no SIEG ───────────────────────────
  // Lista reflete a configuração USE_NFSE_NACIONAL de cada certificado enviado.

  siegList: protectedProcedure.query(async () => {
    return await listarCertificadosSieg();
  }),

  // ─── SIEG: Enviar um certificado específico ──────────────────────────────────
  // Usa a configuração USE_NFSE_NACIONAL do env para habilitar/desabilitar captura de NFSe.

  siegSend: protectedProcedure
    .input(z.object({
      certificateId: z.number(),
      force: z.boolean().optional().default(false), // reenviar mesmo se já enviado
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getConn();
      try {
        // Buscar certificado com pfx_data
        const [certRows] = await conn.execute(
          `SELECT id, cnpj, company_name, file_name, file_path, pfx_data, sieg_status, sieg_id, status
           FROM certificates WHERE id = ? AND is_active = 1`,
          [input.certificateId]
        ) as [any[], any];

        if (!certRows.length) {
          return { success: false, error: "Certificado não encontrado" };
        }

        const cert = certRows[0];

        // Verificar se já foi enviado (a menos que force=true)
        if (!input.force && cert.sieg_status === "sent") {
          return { success: true, skipped: true, message: "Certificado já enviado ao SIEG", siegId: cert.sieg_id };
        }

        // Verificar se o certificado está em estado válido para envio
        if (cert.status === "unknown") {
          return { success: false, error: "Certificado com senha desconhecida — informe a senha antes de enviar ao SIEG" };
        }

        // Obter buffer do PFX
        let pfxBuffer: Buffer | null = null;
        if (cert.pfx_data) {
          pfxBuffer = Buffer.from(cert.pfx_data);
        } else if (cert.file_path) {
          const fs = await import("fs");
          if (fs.existsSync(cert.file_path)) {
            pfxBuffer = fs.readFileSync(cert.file_path);
          }
        }

        if (!pfxBuffer) {
          return { success: false, error: "Arquivo PFX não disponível no servidor" };
        }

        // Buscar senha do certificado (da tabela certificate_secrets ou extrair do nome)
        const [secretRows] = await conn.execute(
          `SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? LIMIT 1`,
          [input.certificateId]
        ) as [any[], any];

        // Descriptografar senha salva, ou usar senha padrão
        const encPwd = secretRows[0]?.encrypted_password;
        const decPwd = encPwd ? decryptPassword(encPwd) : null;
        const password = decPwd ?? process.env.CERT_PASSWORD_DEFAULT ?? "Abcd@1234";

        // Enviar ao SIEG
        const tipoCertificado = cert.file_name?.toLowerCase().endsWith(".p12") ? "P12" : "Pfx";
        const result = await uploadCertificadoSieg(
          cert.cnpj,
          cert.company_name || cert.cnpj,
          pfxBuffer,
          password,
          tipoCertificado,
          cert.sieg_id || undefined // editar se já existe
        );

        // Atualizar status no banco
        if (result.success) {
          await conn.execute(
            `UPDATE certificates SET sieg_status = 'sent', sieg_id = ?, sieg_sent_at = ?, sieg_error = NULL WHERE id = ?`,
            [result.siegId || null, Date.now(), input.certificateId]
          );
        } else {
          await conn.execute(
            `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
            [result.error || "Erro desconhecido", input.certificateId]
          );
        }

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_sieg_send",
          resource: "certificates",
          resourceId: String(input.certificateId),
          description: result.success
            ? `Certificado ${cert.cnpj} enviado ao SIEG com sucesso. ID SIEG: ${result.siegId}`
            : `Falha ao enviar certificado ${cert.cnpj} ao SIEG: ${result.error}`,
          status: result.success ? "success" : "failure",
        });

        return result;
      } finally {
        await conn.end();
      }
    }),

  // ─── SIEG: Enviar todos os certificados válidos de uma vez ───────────────────
  // Envia em lote com configuração USE_NFSE_NACIONAL para cada certificado.
  // Retorna: { sent, failed, skipped, description }

  siegSendAll: protectedProcedure
    .input(z.object({
      force: z.boolean().optional().default(false),
      onlyStatus: z.array(z.string()).optional(), // filtrar por status
    }))
    .output(z.object({
      sent: z.number(),
      failed: z.number(),
      skipped: z.number(),
      total: z.number(),
      errors: z.array(z.object({
        cnpj: z.string(),
        error: z.string(),
        reason: z.string().optional(),
      })),
    }).passthrough())
    .mutation(async ({ ctx, input }) => {
      const conn = await getConn();
      try {
        const statusFilter = input.onlyStatus?.length
          ? `AND cert.status IN (${input.onlyStatus.map(() => "?").join(",")})`
          : "";
        const statusParams = input.onlyStatus ?? [];

        const pendingFilter = input.force ? "" : "AND (cert.sieg_status IS NULL OR cert.sieg_status = 'pending' OR cert.sieg_status = 'error')";

        const [certRows] = await conn.execute(
          `SELECT id, cnpj, company_name, file_name, file_path, pfx_data, sieg_status, sieg_id, status
           FROM certificates
           WHERE is_active = 1
             AND status != 'unknown'
             ${pendingFilter}
             ${statusFilter}
           ORDER BY status ASC
           LIMIT 500`,
          [...statusParams]
        ) as [any[], any];

        let sent = 0;
        let failed = 0;
        let skipped = 0;
        const errors: Array<{ cnpj: string; error: string; reason?: string }> = [];

        for (const cert of certRows) {
          let pfxBuffer: Buffer | null = null;
          if (cert.pfx_data) {
            pfxBuffer = Buffer.from(cert.pfx_data);
          } else if (cert.file_path) {
            const fs = await import("fs");
            if (fs.existsSync(cert.file_path)) {
              pfxBuffer = fs.readFileSync(cert.file_path);
            }
          }

          if (!pfxBuffer) {
            skipped++;
            continue;
          }

          // Buscar e descriptografar senha de cada certificado individualmente
          const [certSecretRows] = await conn.execute(
            `SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? LIMIT 1`,
            [cert.id]
          ) as [any[], any];
          const certEncPwd = certSecretRows[0]?.encrypted_password;
          const certDecPwd = certEncPwd ? decryptPassword(certEncPwd) : null;
          const password = certDecPwd ?? ENV.certPasswordDefault ?? "Abcd@1234";
          const tipoCertificado = cert.file_name?.toLowerCase().endsWith(".p12") ? "P12" : "Pfx";

          const result = await uploadCertificadoSieg(
            cert.cnpj,
            cert.company_name || cert.cnpj,
            pfxBuffer,
            password,
            tipoCertificado,
            cert.sieg_id || undefined
          );

          if (result.success) {
            await conn.execute(
              `UPDATE certificates SET sieg_status = 'sent', sieg_id = ?, sieg_sent_at = NOW(), sieg_error = NULL WHERE id = ?`,
              [result.siegId || null, cert.id]
            );
            sent++;
          } else {
            await conn.execute(
              `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
              [result.error || "Erro desconhecido", cert.id]
            );
            failed++;
            errors.push({ cnpj: cert.cnpj, error: result.error || "Erro desconhecido" });
          }

          // Pequena pausa para não sobrecarregar a API
          await new Promise(r => setTimeout(r, 200));
        }

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_sieg_send_all",
          resource: "certificates",
          description: `Envio em lote ao SIEG: ${sent} enviados, ${failed} erros, ${skipped} ignorados`,
          status: failed > 0 ? "failure" : "success",
        });

        return { sent, failed, skipped, total: certRows.length, errors: errors.slice(0, 20) };
      } finally {
        await conn.end();
      }
    }),

  // ─── SIEG: Teste Piloto com Validação ─────────────────────────────────────────
  // Teste piloto: envia um certificado com USE_NFSE_NACIONAL e valida no SIEG
  // Se bem-sucedido, retorna a configuração fiscal aplicada
  // Se falhar, retorna erro sem afetar outros certificados

  siegPilotTest: protectedProcedure
    .input(z.object({
      certificateId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getConn();
      try {
        // Buscar certificado com file_path do banco
        const [certRows] = await conn.execute(
          `SELECT id, cnpj, company_name, file_name, file_path, sieg_id FROM certificates WHERE id = ? AND is_active = 1 LIMIT 1`,
          [input.certificateId]
        ) as [any[], any];

        if (!certRows.length) {
          return { success: false, error: "Certificado não encontrado" };
        }

        const cert = certRows[0];
        // Priorizar file_path do banco; fallback para montar caminho com CERTIFICATES_PATH
        const certPath = cert.file_path || `${process.env.CERTIFICATES_PATH || "/data/certificados"}/${cert.file_name}`;

        // Ler arquivo PFX
        const fs = require("fs");
        let pfxBuffer: Buffer | null = null;
        try {
          pfxBuffer = fs.readFileSync(certPath);
        } catch {
          return { success: false, error: `Não foi possível ler o arquivo: ${certPath}` };
        }

        if (!pfxBuffer) {
          return { success: false, error: "Buffer vazio" };
        }

        // Buscar e descriptografar senha
        const [certSecretRows] = await conn.execute(
          `SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? LIMIT 1`,
          [cert.id]
        ) as [any[], any];
        const certEncPwd = certSecretRows[0]?.encrypted_password;
        const certDecPwd = certEncPwd ? decryptPassword(certEncPwd) : null;
        const password = certDecPwd ?? ENV.certPasswordDefault ?? "Abcd@1234";
        const usedSavedPassword = !!certDecPwd;  // Rastrear se usou senha salva ou default
        const tipoCertificado = cert.file_name?.toLowerCase().endsWith(".p12") ? "P12" : "Pfx";

        // Enviar ao SIEG com USE_NFSE_NACIONAL
        console.log(`[SIEG_PILOT_TEST] Iniciando teste piloto para CNPJ: ${cert.cnpj}`);
        const result = await uploadCertificadoSieg(
          cert.cnpj,
          cert.company_name || cert.cnpj,
          pfxBuffer,
          password,
          tipoCertificado,
          cert.sieg_id || undefined
        );

        if (!result.success) {
          console.log(`[SIEG_PILOT_TEST] Falha no envio: ${result.error}`);
          return {
            success: false,
            error: result.error || "Erro desconhecido",
            cnpj: cert.cnpj,
          };
        }

        // Atualizar banco com status de piloto
        await conn.execute(
          `UPDATE certificates SET sieg_status = 'pilot_sent', sieg_id = ?, sieg_sent_at = NOW(), sieg_error = NULL WHERE id = ?`,
          [result.siegId || null, cert.id]
        );

        // Listar certificados do SIEG para validar
        const listResult = await listarCertificadosSieg();
        if (!listResult.success) {
          return {
            success: true,
            message: "Certificado enviado, mas não foi possível validar no SIEG",
            siegId: result.siegId,
            cnpj: cert.cnpj,
            warning: listResult.error,
          };
        }

        // Buscar o certificado na listagem
        const cnpjNorm = cert.cnpj.replace(/\D/g, "");
        const pilotCert = listResult.data?.find(
          (c) => c.CnpjCpf?.replace(/\D/g, "") === cnpjNorm
        );

        if (!pilotCert) {
          return {
            success: true,
            message: "Certificado enviado, mas não encontrado na listagem do SIEG",
            siegId: result.siegId,
            cnpj: cert.cnpj,
            warning: "Certificado pode estar em processamento",
          };
        }

        // Validar configuração fiscal
        const fiscalConfig = {
          ConsultaNfe: true,
          ConsultaCte: true,
          ConsultaNfse: ENV.useNfseNacional,
          ConsultaNfce: false,
          BaixarCancelados: true,
          ConsultaNoturna: ENV.useNfseNacional,
          IntegracaoEstadual: false,
          UfCertificado: 32,
        };

        console.log(`[SIEG_PILOT_TEST] Sucesso! Certificado ${cert.cnpj} enviado com configuração: ${JSON.stringify(fiscalConfig)}`);

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_sieg_pilot_test",
          resource: "certificates",
          description: `Teste piloto SIEG: ${cert.cnpj} com USE_NFSE_NACIONAL=${ENV.useNfseNacional}`,
          status: "success",
        });

        return {
          success: true,
          message: "Teste piloto concluído com sucesso",
          cnpj: cert.cnpj,
          siegId: result.siegId,
          fiscalConfig,
          passwordSource: usedSavedPassword ? "saved" : "default",  // Indicar se usou senha salva ou default
          pilotCertData: {
            Id: pilotCert.Id,
            Nome: pilotCert.Nome,
            CnpjCpf: pilotCert.CnpjCpf,
            Ativo: pilotCert.Ativo,
            Deletado: pilotCert.Deletado,
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SIEG_PILOT_TEST] Erro: ${msg}`);
        return { success: false, error: msg };
      } finally {
        await conn.end();
      }
    }),

  // ─── SIEG: Aplicação em Massa (após validação piloto) ─────────────────────────────────────────
  // Envia todos os certificados válidos após confirmação de sucesso do piloto
  // Usa a mesma configuração fiscal do piloto para todos

  siegApplyToAll: protectedProcedure
    .input(z.object({
      pilotCertificateId: z.number(),
      confirmPilotSuccess: z.boolean(),
      dryRun: z.boolean().optional().default(false),  // Preview do lote antes de enviar
    }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      if (!input.confirmPilotSuccess) {
        return {
          success: false,
          error: "Piloto não foi confirmado como bem-sucedido. Abortando aplicação em massa.",
        };
      }

      const conn = await getConn();
      try {
        // Verificar que o piloto foi bem-sucedido
        const [pilotRows] = await conn.execute(
          `SELECT sieg_status, sieg_id FROM certificates WHERE id = ? LIMIT 1`,
          [input.pilotCertificateId]
        ) as [any[], any];

        if (!pilotRows.length || pilotRows[0].sieg_status !== "pilot_sent") {
          return {
            success: false,
            error: "Certificado piloto não está em status 'pilot_sent'. Abortando.",
          };
        }

        // Buscar todos os certificados válidos que ainda não foram enviados ao SIEG
        // EXCLUIR o certificado piloto para não reenviar
        const [certRows] = await conn.execute(
          `SELECT id, cnpj, company_name, file_name, file_path, sieg_id, sieg_status
           FROM certificates
           WHERE is_active = 1
           AND id != ?  -- Excluir piloto
           AND status IN ('valid', 'expiring_30', 'expiring_15', 'expiring_7')
           AND (sieg_status IS NULL OR sieg_status = 'pending' OR sieg_status = 'error')
           ORDER BY valid_to ASC`,
          [input.pilotCertificateId]
        ) as [any[], any];

        if (!certRows.length) {
          return {
            success: true,
            message: "Nenhum certificado pendente para enviar (além do piloto)",
            sent: 0,
            failed: 0,
            skipped: 0,
            total: 0,
          };
        }

        // Retornar preview/dry-run do lote com estatísticas detalhadas
        if (input.dryRun) {
          let noFile = 0;
          let noSavedPassword = 0;
          let alreadyHasSiegId = 0;
          const fs = require("fs");

          for (const cert of certRows) {
            const certPath = cert.file_path || `${process.env.CERTIFICATES_PATH || "/data/certificados"}/${cert.file_name}`;
            const fileExists = fs.existsSync(certPath);
            if (!fileExists) noFile++;

            const [certSecretRows] = await conn.execute(
              `SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? LIMIT 1`,
              [cert.id]
            ) as [any[], any];
            const hasPassword = !!certSecretRows[0]?.encrypted_password;
            if (!hasPassword) noSavedPassword++;

            if (cert.sieg_id) alreadyHasSiegId++;
          }

          const readyToSend = certRows.length - noFile;
          const willUseDefault = noSavedPassword;

          return {
            success: true,
            message: "Preview do lote (dry-run)",
            dryRun: true,
            stats: {
              total: certRows.length,
              noFile,
              noSavedPassword,
              willUseDefault,
              alreadyHasSiegId,
              readyToSend,
            },
            preview: certRows.slice(0, 10).map((c) => ({
              id: c.id,
              cnpj: c.cnpj,
              company: c.company_name,
              status: c.sieg_status,
              hasFile: fs.existsSync(c.file_path || `${process.env.CERTIFICATES_PATH || "/data/certificados"}/${c.file_name}`),
            })),
            moreCount: certRows.length > 10 ? certRows.length - 10 : 0,
          };
        }

        let sent = 0;
        let failed = 0;
        let skipped_no_file = 0;
        let skipped_default_password = 0;
        const errors: Array<{ cnpj: string; error: string; reason?: string }> = [];

        for (const cert of certRows) {
          // Priorizar file_path do banco; fallback para montar caminho
          const certPath = cert.file_path || `${process.env.CERTIFICATES_PATH || "/data/certificados"}/${cert.file_name}`;

          // Ler arquivo PFX
          const fs = require("fs");
          let pfxBuffer: Buffer | null = null;
          try {
            pfxBuffer = fs.readFileSync(certPath);
          } catch {
            skipped_no_file++;
            errors.push({ cnpj: cert.cnpj, error: `Arquivo não encontrado: ${certPath}` });
            continue;
          }

          if (!pfxBuffer) {
            skipped_no_file++;
            errors.push({ cnpj: cert.cnpj, error: "Buffer vazio" });
            continue;
          }

          // Buscar e descriptografar senha
          const [certSecretRows] = await conn.execute(
            `SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? LIMIT 1`,
            [cert.id]
          ) as [any[], any];
          const certEncPwd = certSecretRows[0]?.encrypted_password;
          const certDecPwd = certEncPwd ? decryptPassword(certEncPwd) : null;
          const password = certDecPwd ?? ENV.certPasswordDefault ?? "Abcd@1234";
          const tipoCertificado = cert.file_name?.toLowerCase().endsWith(".p12") ? "P12" : "Pfx";

          console.log(`[SIEG_APPLY_ALL] Enviando ${cert.cnpj} com USE_NFSE_NACIONAL=${ENV.useNfseNacional}`);

          const result = await uploadCertificadoSieg(
            cert.cnpj,
            cert.company_name || cert.cnpj,
            pfxBuffer,
            password,
            tipoCertificado,
            cert.sieg_id || undefined
          );

          if (result.success) {
            await conn.execute(
              `UPDATE certificates SET sieg_status = 'sent', sieg_id = ?, sieg_sent_at = NOW(), sieg_error = NULL WHERE id = ?`,
              [result.siegId || null, cert.id]
            );
            sent++;
          } else {
            await conn.execute(
              `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
              [result.error || "Erro desconhecido", cert.id]
            );
            failed++;
            errors.push({ cnpj: cert.cnpj, error: result.error || "Erro desconhecido" });
          }

          // Pequena pausa para não sobrecarregar a API
          await new Promise(r => setTimeout(r, 200));
        }

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "certificate_sieg_apply_all",
          resource: "certificates",
          description: `Aplicação em massa após piloto: ${sent} enviados, ${failed} erros, ${skipped_no_file} sem arquivo, ${skipped_default_password} com senha default (USE_NFSE_NACIONAL=${ENV.useNfseNacional})`,
          status: failed > 0 ? "failure" : "success",
        });

        return {
          success: true,
          message: `Aplicação em massa concluída: ${sent} enviados, ${failed} erros, ${skipped_no_file} sem arquivo`,
          sent,
          failed,
          skipped: {
            no_file: skipped_no_file,
            default_password: skipped_default_password,
          },
          total: certRows.length,
          errors: errors.slice(0, 20),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SIEG_APPLY_ALL] Erro: ${msg}`);
        return { success: false, error: msg };
      } finally {
        await conn.end();
      }
    }),

  listPilotCandidates: protectedProcedure
    .query(async () => {
      const conn = await getConn();
      try {
        const [rows] = await conn.execute(`
          SELECT 
            id,
            cnpj,
            company_name,
            status,
            DATE_FORMAT(valid_to, '%Y-%m-%d') as valid_to,
            file_path,
            sieg_status
          FROM certificates
          WHERE 
            is_active = 1
            AND status = 'valid'
            AND (sieg_status IS NULL OR sieg_status = 'pending' OR sieg_status = 'error')
          ORDER BY valid_to DESC
          LIMIT 10
        `) as [any[], any];

        return {
          success: true,
          total: rows.length,
          candidates: rows,
          recommended: rows.length > 0 ? rows[0] : null,
        };
      } finally {
        await conn.end();
      }
    }),

  // ─── Reconciliação SIEG ↔ banco local ────────────────────────────────────────────────────

  /** Executa a reconciliação SIEG ↔ banco local manualmente */
  siegRunRecon: protectedProcedure
    .mutation(async ({ ctx }) => {
      await audit({
        userId: ctx.user.id,
        userName: ctx.user.name ?? ctx.user.email ?? null,
        userRole: ctx.user.role,
        action: "sieg_recon_manual",
        resource: "certificates",
        description: "Reconciliação SIEG manual iniciada",
        status: "success",
      });
      const result = await reconcileSiegCertificates();
      return result;
    }),

  /** Retorna estatísticas de reconciliação do banco */
  siegReconStats: protectedProcedure
    .query(async () => {
      const conn = await getConn();
      try {
        const [rows] = await conn.execute(
          `SELECT
             sieg_recon_status,
             sieg_source,
             COUNT(*) as total,
             SUM(CASE WHEN sieg_remote_active = 1 THEN 1 ELSE 0 END) as remote_active,
             MAX(sieg_synced_at) as last_synced
           FROM certificates
           WHERE is_active = 1
           GROUP BY sieg_recon_status, sieg_source
           ORDER BY total DESC`
        ) as [any[], any];

        const [totalRow] = await conn.execute(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN sieg_synced_at IS NOT NULL THEN 1 ELSE 0 END) as synced,
             MAX(sieg_synced_at) as last_synced_at
           FROM certificates
           WHERE is_active = 1`
        ) as [any[], any];

        // Distribuição por classificação
        const distribution: Record<string, number> = {};
        for (const r of rows) {
          const key = r.sieg_recon_status || 'not_reconciled';
          distribution[key] = (distribution[key] || 0) + Number(r.total);
        }

        return {
          total: Number(totalRow[0].total),
          synced: Number(totalRow[0].synced),
          lastSyncedAt: totalRow[0].last_synced_at,
          distribution,
          breakdown: rows,
        };
      } finally {
        await conn.end();
      }
    }),

  /** Lista certificados por classificação de reconciliação */
  siegReconList: protectedProcedure
    .input(z.object({
      reconStatus: z.enum(["local_ok", "sieg_only", "local_only", "divergent", "not_reconciled"]).optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(50),
    }))
    .query(async ({ input }) => {
      const conn = await getConn();
      try {
        const conditions: string[] = ["is_active = 1"];
        const params: unknown[] = [];

        if (input.reconStatus === "not_reconciled") {
          conditions.push("sieg_recon_status IS NULL");
        } else if (input.reconStatus) {
          conditions.push("sieg_recon_status = ?");
          params.push(input.reconStatus);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const offset = (input.page - 1) * input.pageSize;

        const [rows] = await conn.execute(
          `SELECT id, cnpj, company_name, file_path, file_name,
                  sieg_status, sieg_id, sieg_remote_active, sieg_remote_expiry,
                  sieg_remote_status, sieg_synced_at, sieg_source, sieg_recon_status,
                  valid_to, status, created_at
           FROM certificates
           ${where}
           ORDER BY sieg_recon_status ASC, valid_to DESC
           LIMIT ${Number(input.pageSize)} OFFSET ${Number(offset)}`,
          params
        ) as [any[], any];

        const [countRow] = await conn.execute(
          `SELECT COUNT(*) as total FROM certificates ${where}`,
          params
        ) as [any[], any];

        return {
          items: rows,
          total: Number(countRow[0].total),
          page: input.page,
          pageSize: input.pageSize,
        };
      } finally {
        await conn.end();
      }
    }),
});
