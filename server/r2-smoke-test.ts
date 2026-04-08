/**
 * Smoke Test R2/Worker Upload
 * POST /api/test/r2/smoke-upload
 * 
 * Prova que R2/Worker ainda funciona hoje
 * Retorna: { ok, provider, publicUrl, key, ms, logs }
 */

import { Router, Request, Response } from 'express';
import { uploadPdfWithFallback } from './worker-storage';

const router = Router();

router.post('/r2/smoke-upload', async (req: Request, res: Response) => {
  const logs: string[] = [];
  const startTime = Date.now();

  try {
    logs.push('🚀 Iniciando smoke test R2/Worker');

    // Criar PDF dummy
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Smoke Test PDF) Tj ET\nendstream endobj xref 0 6 0000000000 65535 f 0000000009 00000 n 0000000058 00000 n 0000000115 00000 n 0000000214 00000 n 0000000301 00000 n trailer<</Size 6/Root 1 0 R>>startxref 391 %%EOF');
    
    logs.push(`PDF gerado: ${pdfBuffer.length} bytes`);

    // Upload via uploadPdfWithFallback
    const uploadResult = await uploadPdfWithFallback(`smoke_${Date.now()}`, pdfBuffer);

    const latency = Date.now() - startTime;

    if (!uploadResult?.success) {
      logs.push(`❌ Upload falhou: ${JSON.stringify(uploadResult)}`);
      return res.status(502).json({
        ok: false,
        error: 'UPLOAD_FAILED',
        uploadResult,
        latencyMs: latency,
        logs,
      });
    }

    logs.push(`✅ Upload bem-sucedido`);
    logs.push(`Provider: ${uploadResult.provider}`);
    logs.push(`Key: ${uploadResult.key}`);
    logs.push(`PublicUrl: ${uploadResult.publicUrl}`);
    logs.push(`Latency: ${latency}ms`);

    return res.json({
      ok: true,
      provider: uploadResult.provider,
      publicUrl: uploadResult.publicUrl,
      key: uploadResult.key,
      ms: latency,
      logs,
    });
  } catch (err: any) {
    const latency = Date.now() - startTime;
    logs.push(`❌ Erro: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: err.message,
      latencyMs: latency,
      logs,
    });
  }
});

export default router;
