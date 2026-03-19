/**
 * ETAPA 8 — PASSO 8.3: E2E REAL COMPLETO (COM RETRY AUTOMÁTICO)
 * 
 * Endpoint: POST /api/test/etapa8/e2e-real
 * Usa zapRequest com retry 401/403
 */

import express from 'express';
import crypto from 'crypto';
import FormData from 'form-data';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { zapRequest } from './zap/zapRequest';

const router = express.Router();

/**
 * POST /api/test/etapa8/e2e-real
 * 
 * Fluxo E2E real: Conta Azul → PDF → Zap (multipart, preview, com retry)
 */
router.post('/e2e-real', async (req, res) => {
  try {
    const { ticketId = 8019, clientId = 30004, strategy = 'FIRST_AVAILABLE', receivableId, correlationId } = req.body;
    const finalCorrelationId = correlationId || `[#FRAGA:${ticketId}:ETAPA8_E2E_REAL_${Date.now()}]`;

    console.log('[E2EReal] Iniciando E2E real...');
    console.log('[E2EReal] Ticket:', ticketId, 'Client:', clientId, 'Strategy:', strategy);
    console.log('[E2EReal] CorrelationID:', finalCorrelationId);

    // 1) Obter DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database connection failed'
      });
    }

    // 2) Resolver receivable
    let targetReceivable;
    if (strategy === 'BY_RECEIVABLE_ID' && receivableId) {
      const items = await db
        .select()
        .from(receivables)
        .where(eq(receivables.id, receivableId))
        .limit(1);
      targetReceivable = items[0];
    } else {
      // FIRST_AVAILABLE
      const items = await db
        .select()
        .from(receivables)
        .where(eq(receivables.clientId, clientId))
        .limit(1);
      targetReceivable = items[0];
    }

    if (!targetReceivable) {
      return res.status(404).json({
        ok: false,
        error: 'Receivable não encontrado'
      });
    }

    console.log('[E2EReal] Receivable resolvido:', targetReceivable.contaAzulId);

    // 3) Gerar PDF
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 400 >>
stream
BT
/F1 14 Tf
50 750 Td
(BOLETO - FRAGA DASHBOARD) Tj
0 -30 Td
/F1 12 Tf
(Conta Azul ID: ${targetReceivable.contaAzulId}) Tj
0 -20 Td
(Valor: R$ ${targetReceivable.amount}) Tj
0 -20 Td
(Vencimento: ${targetReceivable.dueDate?.toLocaleDateString('pt-BR') || 'N/A'}) Tj
0 -20 Td
(Status: ${targetReceivable.status}) Tj
0 -20 Td
(Correlation: ${finalCorrelationId}) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
0000000301 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
751
%%EOF`;

    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    console.log('[E2EReal] PDF gerado:', pdfBuffer.length, 'bytes');
    console.log('[E2EReal] SHA256:', sha256);

    // 4) Warm-up: GET /tickets (validar auth)
    console.log('[E2EReal] Warm-up: GET /tickets...');
    const warmupResponse = await zapRequest(
      '/tickets?pageNumber=1&pageSize=10',
      { method: 'GET' },
      { retryOnAuth: true, correlationId: finalCorrelationId }
    );

    if (warmupResponse.httpStatus !== 200) {
      return res.status(warmupResponse.httpStatus).json({
        ok: false,
        error: 'Warm-up falhou',
        warmup: {
          httpStatus: warmupResponse.httpStatus,
          text: warmupResponse.text,
        }
      });
    }

    console.log('[E2EReal] ✅ Warm-up OK');

    // 5) Enviar PDF via Zap (multipart)
    console.log('[E2EReal] Enviando PDF via Zap...');

    const form = new FormData();
    form.append('fromMe', 'true');
    form.append('mediaType', 'application/pdf');
    form.append('filename', `boleto_${targetReceivable.id}.pdf`);
    form.append('body', `ETAPA 8 - E2E REAL\n${finalCorrelationId}`);
    form.append('medias', pdfBuffer, {
      filename: `boleto_${targetReceivable.id}.pdf`,
      contentType: 'application/pdf'
    });

    const sendResponse = await zapRequest(
      `/messages/${ticketId}`,
      {
        method: 'POST',
        data: form,
        headers: form.getHeaders(),
      },
      { retryOnAuth: true, correlationId: finalCorrelationId }
    );

    if (sendResponse.httpStatus !== 200) {
      return res.status(sendResponse.httpStatus).json({
        ok: false,
        error: 'Falha ao enviar PDF',
        send: {
          httpStatus: sendResponse.httpStatus,
          text: sendResponse.text,
        }
      });
    }

    console.log('[E2EReal] ✅ PDF enviado com sucesso');

    return res.json({
      ok: true,
      correlationId: finalCorrelationId,
      pdf: {
        source: 'FALLBACK_MOCK',
        sizeBytes: pdfBuffer.length,
        sha256
      },
      zap: {
        warmupStatus: warmupResponse.httpStatus,
        sendStatus: sendResponse.httpStatus,
        ticketId
      },
      receivable: {
        id: targetReceivable.id,
        contaAzulId: targetReceivable.contaAzulId,
        amount: targetReceivable.amount,
        dueDate: targetReceivable.dueDate
      },
      proofs: {
        mustSeeInPanel: `ticket #${ticketId} + preview pdf + correlationId visível`
      },
      nextAction: 'VERIFY_IN_PANEL',
      message: 'E2E real completo com retry automático! Verifique o painel do ticket para confirmar envio com preview'
    });
  } catch (error: any) {
    console.error('[E2EReal] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
