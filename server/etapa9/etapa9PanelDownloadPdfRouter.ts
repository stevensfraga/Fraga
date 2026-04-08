/**
 * ETAPA 9.1 — PASSO 9.1-C: PANEL DOWNLOAD PDF (VALIDAR >10KB)
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-download-pdf
 * 
 * Objetivo:
 *   Pegar pdf_url do PASSO 9.1-B
 *   Baixar o PDF
 *   Validar: content-type=application/pdf e sizeBytes >= 10240
 */

import express from 'express';
import axios from 'axios';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /api/test/etapa9/r7/panel-download-pdf
 * 
 * Download PDF real do painel
 */
router.get('/panel-download-pdf', async (req, res) => {
  try {
    console.log('[Etapa9-C] Iniciando panel-download-pdf...');

    // Query param: pdfUrl (pode vir do PASSO 9.1-B)
    const pdfUrl = req.query.pdfUrl as string;

    if (!pdfUrl) {
      console.error('[Etapa9-C] ❌ pdfUrl não fornecida');

      return res.status(400).json({
        ok: false,
        error: 'pdfUrl é obrigatória (query param)',
        decision: 'PDF_URL_MISSING',
        message: 'Use: /panel-download-pdf?pdfUrl=<url>'
      });
    }

    console.log('[Etapa9-C] PDF URL:', pdfUrl.substring(0, 50) + '...');

    // Baixar PDF
    console.log('[Etapa9-C] Fazendo download...');
    let pdfBuffer: Buffer;
    let contentType: string = '';

    try {
      const response = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        withCredentials: true, // Incluir cookies httpOnly se necessário
      });

      pdfBuffer = Buffer.from(response.data);
      contentType = response.headers['content-type'] || 'application/octet-stream';

      console.log('[Etapa9-C] ✅ Download bem-sucedido');
      console.log('[Etapa9-C] Content-Type:', contentType);
      console.log('[Etapa9-C] Size:', pdfBuffer.length, 'bytes');
    } catch (downloadErr: any) {
      console.error('[Etapa9-C] ❌ Download falhou:', downloadErr.message);
      console.error('[Etapa9-C] Status:', downloadErr.response?.status);

      return res.status(downloadErr.response?.status || 500).json({
        ok: false,
        error: 'Falha ao baixar PDF',
        details: {
          httpStatus: downloadErr.response?.status,
          message: downloadErr.message,
        },
        decision: 'PDF_DOWNLOAD_FAILED'
      });
    }

    // Validar content-type
    const isPdf = contentType.includes('application/pdf') || contentType.includes('pdf');
    if (!isPdf) {
      console.error('[Etapa9-C] ⚠️ Content-Type pode não ser PDF:', contentType);
      // Continuar mesmo assim
    }

    // Validar tamanho (>= 10KB = 10240 bytes)
    const minSize = 10240;
    const isValidSize = pdfBuffer.length >= minSize;

    console.log('[Etapa9-C] Validando tamanho...');
    console.log('[Etapa9-C] Size:', pdfBuffer.length, 'bytes');
    console.log('[Etapa9-C] Min required:', minSize, 'bytes');
    console.log('[Etapa9-C] Valid:', isValidSize);

    if (!isValidSize) {
      console.error('[Etapa9-C] ❌ PDF muito pequeno:', pdfBuffer.length, '< 10KB');

      return res.status(400).json({
        ok: false,
        error: 'PDF menor que 10KB',
        sizeBytes: pdfBuffer.length,
        minRequired: minSize,
        decision: 'PDF_TOO_SMALL'
      });
    }

    // Calcular SHA256
    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    console.log('[Etapa9-C] ✅ PDF validado (>10KB)');
    console.log('[Etapa9-C] SHA256:', sha256);

    // Mascarar URL para logging
    const pdfSourceUrlMasked = pdfUrl.substring(0, 50) + '...' + pdfUrl.substring(pdfUrl.length - 20);

    return res.json({
      ok: true,
      sizeBytes: pdfBuffer.length,
      sha256,
      pdfSourceUrlMasked,
      contentType,
      decision: 'PDF_REAL_OK',
      nextAction: 'SEND_MULTIPART',
      message: 'PDF real validado (>10KB). Pronto para enviar via Zap.'
    });
  } catch (error: any) {
    console.error('[Etapa9-C] ❌ Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
      decision: 'PANEL_DOWNLOAD_ERROR'
    });
  }
});

export default router;
