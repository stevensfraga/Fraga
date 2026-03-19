/**
 * ETAPA 9.1 — PASSO 9.1-C: ENVIAR PDF REAL VIA ZAP (MULTIPART PREVIEW)
 * 
 * Endpoint: POST /api/test/etapa9/r7/send-real-pdf
 * 
 * Objetivo:
 *   Baixar PDF real do Conta Azul
 *   Enviar via Zap com multipart/form-data (preview)
 *   Registrar provas (logs + proofPack)
 */

import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import FormData from 'form-data';
import { getZapAuth } from '../zap/zapAuth';
import { zapRequest } from '../zap/zapRequest';

const router = express.Router();

const CONTA_AZUL_BASE = 'https://api.contaazul.com/v1';
const ZAP_API_BASE = process.env.ZAP_CONTABIL_BASE_URL || 'https://api.zapcontabil.com.br';

/**
 * POST /api/test/etapa9/r7/send-real-pdf
 * 
 * Fluxo: Download PDF real → Enviar via Zap (multipart)
 */
router.post('/send-real-pdf', async (req, res) => {
  try {
    const { ticketId = 8019, correlationId } = req.body;
    const finalCorrelationId = correlationId || `[#FRAGA:${ticketId}:ETAPA9_1_R7_${Date.now()}]`;

    console.log('[Etapa9-C] Iniciando envio de PDF real...');
    console.log('[Etapa9-C] Ticket:', ticketId);
    console.log('[Etapa9-C] CorrelationID:', finalCorrelationId);

    const proofPack: any = {
      stepA: {},
      stepB: {},
      stepC: {},
    };

    // ──────────────────────────────────────────────────────────────────────
    // PASSO A: Resolver Payment
    // ──────────────────────────────────────────────────────────────────────
    console.log('[Etapa9-C] [A] Resolvendo payment R7...');

    const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
    const pdfUrl = `${CONTA_AZUL_BASE}/financial-events/${financialEventId}/pdf`;

    proofPack.stepA = {
      financialEventId,
      pdfUrl,
      timestamp: new Date().toISOString(),
    };

    console.log('[Etapa9-C] [A] ✅ Payment resolvido');

    // ──────────────────────────────────────────────────────────────────────
    // PASSO B: Download PDF Real
    // ──────────────────────────────────────────────────────────────────────
    console.log('[Etapa9-C] [B] Baixando PDF real...');

    const auth = await getZapAuth();
    let pdfBuffer: Buffer;
    let pdfSizeBytes: number;
    let pdfSha256: string;

    try {
      const downloadResponse = await axios.get(pdfUrl, {
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Cookie': auth.cookie,
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      pdfBuffer = Buffer.from(downloadResponse.data);
      pdfSizeBytes = pdfBuffer.length;
      pdfSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

      console.log('[Etapa9-C] [B] ✅ PDF baixado:', pdfSizeBytes, 'bytes');
      console.log('[Etapa9-C] [B] SHA256:', pdfSha256);

      // Validar tamanho
      if (pdfSizeBytes < 10240) {
        throw new Error(`PDF muito pequeno: ${pdfSizeBytes} < 10240 bytes`);
      }

      proofPack.stepB = {
        httpStatus: downloadResponse.status,
        sizeBytes: pdfSizeBytes,
        sha256: pdfSha256,
        contentType: downloadResponse.headers['content-type'],
        decision: 'PDF_REAL_OK',
        timestamp: new Date().toISOString(),
      };
    } catch (downloadErr: any) {
      console.error('[Etapa9-C] [B] ❌ Download falhou:', downloadErr.message);

      proofPack.stepB = {
        error: downloadErr.message,
        httpStatus: downloadErr.response?.status,
        decision: 'PDF_REAL_NOT_FOUND',
        timestamp: new Date().toISOString(),
      };

      return res.status(downloadErr.response?.status || 500).json({
        ok: false,
        error: 'Falha ao baixar PDF',
        proofPack,
        correlationId: finalCorrelationId,
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // PASSO C: Enviar via Zap (multipart)
    // ──────────────────────────────────────────────────────────────────────
    console.log('[Etapa9-C] [C] Enviando via Zap (multipart)...');

    const filename = `R7_VENDA_14464_${pdfSha256.substring(0, 8)}.pdf`;
    const bodyText = `R7 - Boleto real da venda 14464.\n${finalCorrelationId}`;

    const form = new FormData();
    form.append('fromMe', 'true');
    form.append('mediaType', 'application/pdf');
    form.append('filename', filename);
    form.append('body', bodyText);
    form.append('medias', pdfBuffer, {
      filename,
      contentType: 'application/pdf'
    });

    console.log('[Etapa9-C] [C] Multipart preparado');
    console.log('[Etapa9-C] [C] Filename:', filename);
    console.log('[Etapa9-C] [C] Body:', bodyText);

    let sendResponse;
    try {
      sendResponse = await zapRequest(
        `/messages/${ticketId}`,
        {
          method: 'POST',
          data: form,
          headers: form.getHeaders(),
        },
        { retryOnAuth: true, correlationId: finalCorrelationId }
      );

      console.log('[Etapa9-C] [C] HTTP Status:', sendResponse.httpStatus);

      if (sendResponse.httpStatus !== 200) {
        throw new Error(`HTTP ${sendResponse.httpStatus}: ${sendResponse.text}`);
      }

      console.log('[Etapa9-C] [C] ✅ Enviado com sucesso');

      proofPack.stepC = {
        httpStatus: sendResponse.httpStatus,
        ticketId,
        filename,
        bodyText,
        timestamp: new Date().toISOString(),
      };
    } catch (sendErr: any) {
      console.error('[Etapa9-C] [C] ❌ Envio falhou:', sendErr.message);

      proofPack.stepC = {
        error: sendErr.message,
        httpStatus: sendResponse?.httpStatus || 500,
        timestamp: new Date().toISOString(),
      };

      return res.status(sendResponse?.httpStatus || 500).json({
        ok: false,
        error: 'Falha ao enviar PDF',
        proofPack,
        correlationId: finalCorrelationId,
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // SUCESSO: Retornar provas finais
    // ──────────────────────────────────────────────────────────────────────
    console.log('[Etapa9-C] ✅ ETAPA 9.1 COMPLETA');

    return res.json({
      ok: true,
      correlationId: finalCorrelationId,
      pdf: {
        sizeBytes: pdfSizeBytes,
        sha256: pdfSha256,
        filename,
        source: 'CONTA_AZUL_FINANCIAL_EVENT',
      },
      zap: {
        httpStatusSend: sendResponse.httpStatus,
        ticketId,
      },
      proofPack,
      nextAction: 'VERIFY_IN_PANEL',
      message: 'PDF real enviado com sucesso! Verifique ticket 8019 para confirmar preview.'
    });
  } catch (error: any) {
    console.error('[Etapa9-C] ❌ Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

export default router;
