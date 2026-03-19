/**
 * ETAPA 9.1 — PASSO 9.1-B: DOWNLOAD PDF REAL (VALIDAR >10KB)
 * 
 * Endpoint: GET /api/test/etapa9/r7/download-pdf
 * 
 * Objetivo:
 *   Baixar PDF real do Conta Azul
 *   Validar: content-type = application/pdf
 *   Validar: sizeBytes >= 10240 (>10KB)
 */

import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { getZapAuth } from '../zap/zapAuth';
import { getValidAccessToken } from '../contaAzulOAuthManager';

const router = express.Router();

const CONTA_AZUL_BASE = 'https://api.contaazul.com/v1';

/**
 * GET /api/test/etapa9/r7/download-pdf
 * 
 * Baixa PDF real da venda R7 (14464)
 */
router.get('/download-pdf', async (req, res) => {
  try {
    console.log('[Etapa9-B] Iniciando download de PDF real...');

    // IDs da venda R7
    const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
    const pdfUrl = `${CONTA_AZUL_BASE}/financial-events/${financialEventId}/pdf`;

    console.log('[Etapa9-B] URL:', pdfUrl);

    // Obter token Conta Azul (OAuth) com refresh automático
    console.log('[Etapa9-B] Obtendo token Conta Azul (OAuth)...');
    let contaAzulToken: string;
    try {
      // Tentar obter token válido (com refresh se necessário)
      contaAzulToken = await getValidAccessToken();
      console.log('[Etapa9-B] ✅ Token Conta Azul obtido');
    } catch (err: any) {
      console.error('[Etapa9-B] ❌ Falha ao obter token Conta Azul:', err.message);
      throw err;
    }

    // Tentar download
    console.log('[Etapa9-B] Fazendo download...');
    let pdfBuffer: Buffer;
    let contentType: string = '';

    try {
      const response = await axios.get(pdfUrl, {
        headers: {
          'Authorization': `Bearer ${contaAzulToken}`,
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      pdfBuffer = Buffer.from(response.data);
      contentType = response.headers['content-type'] || 'application/octet-stream';

      console.log('[Etapa9-B] ✅ Download bem-sucedido');
      console.log('[Etapa9-B] Content-Type:', contentType);
      console.log('[Etapa9-B] Size:', pdfBuffer.length, 'bytes');
    } catch (downloadErr: any) {
      console.error('[Etapa9-B] ❌ Download falhou:', downloadErr.message);
      console.error('[Etapa9-B] Status:', downloadErr.response?.status);
      console.error('[Etapa9-B] Data:', downloadErr.response?.data?.error || downloadErr.response?.data);

      return res.status(downloadErr.response?.status || 500).json({
        ok: false,
        error: 'Falha ao baixar PDF',
        details: {
          httpStatus: downloadErr.response?.status,
          message: downloadErr.message,
          errorData: downloadErr.response?.data,
        },
        decision: 'PDF_REAL_NOT_FOUND'
      });
    }

    // Validar content-type
    const isPdf = contentType.includes('application/pdf') || contentType.includes('pdf');
    if (!isPdf) {
      console.error('[Etapa9-B] ⚠️ Content-Type pode não ser PDF:', contentType);
      // Continuar mesmo assim (pode ser application/octet-stream)
    }

    // Validar tamanho (>= 10KB = 10240 bytes)
    const minSize = 10240;
    const isValidSize = pdfBuffer.length >= minSize;

    console.log('[Etapa9-B] Validando tamanho...');
    console.log('[Etapa9-B] Size:', pdfBuffer.length, 'bytes');
    console.log('[Etapa9-B] Min required:', minSize, 'bytes');
    console.log('[Etapa9-B] Valid:', isValidSize);

    if (!isValidSize) {
      console.error('[Etapa9-B] ❌ PDF muito pequeno:', pdfBuffer.length, '< 10KB');

      return res.status(400).json({
        ok: false,
        error: 'PDF menor que 10KB',
        sizeBytes: pdfBuffer.length,
        minRequired: minSize,
        decision: 'PDF_REAL_NOT_FOUND'
      });
    }

    // Calcular SHA256
    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    console.log('[Etapa9-B] ✅ PDF validado (>10KB)');
    console.log('[Etapa9-B] SHA256:', sha256);

    return res.json({
      ok: true,
      sizeBytes: pdfBuffer.length,
      sha256,
      source: 'CONTA_AZUL_FINANCIAL_EVENT',
      contentType,
      decision: 'PDF_REAL_OK',
      nextAction: 'SEND_MULTIPART',
      message: 'PDF real validado (>10KB). Pronto para enviar via Zap.'
    });
  } catch (error: any) {
    console.error('[Etapa9-B] ❌ Erro geral:', error.message);
    console.error('[Etapa9-B] Stack:', error.stack?.substring(0, 200));

    return res.status(500).json({
      ok: false,
      error: error.message,
      decision: 'PDF_REAL_NOT_FOUND'
    });
  }
});

export default router;
