import express from "express";
import { getDb } from "../db";
import { processNfseEmissions } from "../jobs/nfseEmissionProcessor";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import mysql from "mysql2/promise";

const router = express.Router();

// Diretório local para salvar PDFs
const PDF_DIR = "/opt/fraga-dashboard/data/nfse-pdfs";

/**
 * POST /api/nfse/process
 * Processa emissões de NFS-e com status "ready_to_emit"
 */
router.post("/process", async (req, res) => {
  try {
    const result = await processNfseEmissions();
    res.json({
      ...result,
      success: true,
    });
  } catch (err) {
    console.error("[NfseEmissionWebhook] Erro:", err);
    res.status(500).json({
      success: false,
      error: String(err),
    });
  }
});

/**
 * GET /api/nfse/status/:emissaoId
 * Retorna status de uma emissão específica
 */
router.get("/status/:emissaoId", async (req, res) => {
  try {
    const { emissaoId } = req.params;
    const connection = await getDb();
    if (!connection) {
      return res.status(500).json({ error: "Conexão com banco falhou" });
    }
    const [emission] = await (connection as any).query(
      `SELECT * FROM nfse_emissions WHERE id = ?`,
      [emissaoId]
    );
    if (!emission || (Array.isArray(emission) && emission.length === 0)) {
      return res.status(404).json({ error: "Emissão não encontrada" });
    }
    const emissionData = Array.isArray(emission) ? emission[0] : emission;
    return res.json({ success: true, emission: emissionData });
  } catch (err) {
    console.error("[NfseEmissionWebhook] Erro ao buscar status:", err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * GET /api/nfse/pdf/:token
 * Serve o PDF da NFS-e diretamente sem necessidade de login.
 * O token é válido por 24h e é gerado após a emissão.
 */
router.get("/pdf/:token", async (req, res) => {
  const { token } = req.params;
  let connection: mysql.Connection | undefined;
  try {
    const DATABASE_URL = process.env.DATABASE_URL || "";
    connection = await mysql.createConnection(DATABASE_URL);

    // Buscar token no banco
    const [rows] = await connection.execute(
      `SELECT t.*, e.pdfLocalPath, e.pdfUrl, e.numeroNf
       FROM nfse_pdf_tokens t
       LEFT JOIN nfse_emissoes e ON t.emissao_id = e.id
       WHERE t.token = ? AND t.expires_at > NOW()
       LIMIT 1`,
      [token]
    );
    const tokenRow = (rows as any[])[0];
    if (!tokenRow) {
      await connection.end();
      return res.status(404).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>❌ Link expirado ou inválido</h2>
          <p>Este link de download expirou (válido por 24h) ou é inválido.</p>
          <p>Acesse o portal da prefeitura para baixar a nota: 
            <a href="https://nfse.vilavelha.es.gov.br/nfse/consultarnota">Vila Velha NFS-e</a>
          </p>
        </body></html>
      `);
    }

    const pdfLocalPath = tokenRow.pdfLocalPath || tokenRow.pdf_local_path;
    const numeroNf = tokenRow.numeroNf || tokenRow.numero_nf || "NFS-e";

    // Registrar uso do token
    await connection.execute(
      "UPDATE nfse_pdf_tokens SET used_at = NOW() WHERE token = ?",
      [token]
    );
    await connection.end();

    // Verificar se o arquivo existe localmente
    if (pdfLocalPath && fs.existsSync(pdfLocalPath)) {
      const pdfBuffer = fs.readFileSync(pdfLocalPath);
      const fileName = `NFS-e-${numeroNf}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      console.log(`[NfseEmissionWebhook] PDF servido: ${fileName} (${pdfBuffer.length} bytes)`);
      return res.send(pdfBuffer);
    }

    // Fallback: redirecionar para URL do S3 se disponível
    if (tokenRow.pdfUrl) {
      return res.redirect(302, tokenRow.pdfUrl);
    }

    // Nenhum PDF disponível
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>⚠️ PDF não disponível</h2>
        <p>O PDF da nota ${numeroNf} ainda não foi gerado.</p>
        <p>Acesse o portal da prefeitura: 
          <a href="https://nfse.vilavelha.es.gov.br/nfse/consultarnota">Vila Velha NFS-e</a>
        </p>
      </body></html>
    `);
  } catch (err: any) {
    console.error("[NfseEmissionWebhook] Erro ao servir PDF:", err);
    if (connection) await connection.end().catch(() => {});
    return res.status(500).send("Erro interno ao processar o PDF.");
  }
});

/**
 * Gera um token de download temporário para um PDF de NFS-e.
 * Chamada internamente após a emissão.
 */
export async function generatePdfToken(
  emissaoId: number,
  numeroNf: string,
  pdfLocalPath: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const DATABASE_URL = process.env.DATABASE_URL || "";
  const connection = await mysql.createConnection(DATABASE_URL);
  try {
    await connection.execute(
      `INSERT INTO nfse_pdf_tokens (token, emissao_id, numero_nf, pdf_local_path, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [token, emissaoId, numeroNf, pdfLocalPath]
    );
    console.log(`[NfseEmissionWebhook] Token gerado para emissão ${emissaoId}: ${token.substring(0, 8)}...`);
    return token;
  } finally {
    await connection.end();
  }
}

/**
 * Salva o buffer do PDF localmente e retorna o caminho.
 */
export function savePdfLocally(
  pdfBuffer: Buffer,
  emissaoId: number,
  numeroNf: string,
  cnpj: string
): string {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }
  const fileName = `NFS-${numeroNf}-${cnpj}.pdf`;
  const filePath = path.join(PDF_DIR, fileName);
  fs.writeFileSync(filePath, pdfBuffer);
  console.log(`[NfseEmissionWebhook] PDF salvo localmente: ${filePath} (${pdfBuffer.length} bytes)`);
  return filePath;
}

export default router;
