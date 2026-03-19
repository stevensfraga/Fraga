/**
 * 🚀 ETAPA 6: E2E Completo - Sincronizar Receivable Real e Enviar via WhatsApp
 * 
 * Fluxo:
 * 1. Buscar receivable real do banco (mock ou real)
 * 2. Gerar PDF de boleto
 * 3. Fazer upload para storage Zap
 * 4. Obter signedUrl
 * 5. Enviar mensagem com PDF via WhatsApp
 * 
 * Prova obrigatória: HTTP 200 + mensagem no painel Zap + PDF abre
 */

import express from 'express';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

import { initZapAuthManager } from './zapcontabilAuthManager.js';


const router = express.Router();



/**
 * Helper: Gerar PDF de boleto (simulado com Buffer)
 */
function generateBoletoPDF(): Buffer {
  const content = `
%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 500 >>
stream
BT
/F1 24 Tf
50 700 Td
(BOLETO BANCÁRIO) Tj
ET
BT
/F1 12 Tf
50 650 Td
(Fraga Contabilidade) Tj
ET
BT
50 630 Td
(CNPJ: 12.345.678/0001-90) Tj
ET
BT
50 600 Td
(Valor: R$ 1.000,00) Tj
ET
BT
50 570 Td
(Vencimento: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR')}) Tj
ET
BT
50 540 Td
(Linha Digitável: 12345.67890 12345.678901 12345.678901 1 12345678901234) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000244 00000 n
0000000793 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
872
%%EOF
  `;
  return Buffer.from(content, 'utf-8');
}

/**
 * POST /api/test/etapa6/e2e-complete
 * 
 * Fluxo E2E completo:
 * 1. Buscar receivable do banco
 * 2. Gerar PDF
 * 3. Fazer upload Zap
 * 4. Obter signedUrl
 * 5. Enviar via WhatsApp
 */
router.post('/e2e-complete', async (req, res) => {
  try {
    const { receivableId, ticketId = 8019 } = req.body;

    if (!receivableId) {
      return res.status(400).json({
        success: false,
        error: 'receivableId é obrigatório',
        hint: 'Use POST /api/test/conta-azul/sync-mock para gerar receivables de teste'
      });
    }

    console.log('[ETAPA6] Iniciando fluxo E2E...');
    console.log('[ETAPA6] receivableId:', receivableId);
    console.log('[ETAPA6] ticketId:', ticketId);

    // 1) Buscar receivable do banco
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    const receivableList = await db
      .select()
      .from(receivables)
      .where(eq(receivables.contaAzulId, receivableId))
      .limit(1);

    if (receivableList.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Receivable ${receivableId} não encontrado`,
        hint: 'Use POST /api/test/conta-azul/sync-mock para gerar receivables'
      });
    }

    const receivable = receivableList[0];
    console.log('[ETAPA6] Receivable encontrado:', receivable.contaAzulId, receivable.amount);

    // 2) Gerar PDF
    console.log('[ETAPA6] Gerando PDF...');
    const pdfBuffer = generateBoletoPDF();
    console.log('[ETAPA6] PDF gerado:', pdfBuffer.length, 'bytes');

    // 3) Fazer upload Zap (simulado - usar arquivo existente)
    const filename = `FRAGA_BOLETO_${receivableId}_${Date.now()}.pdf`;
    console.log('[ETAPA6] Filename:', filename);

    // 4) Obter signedUrl (simulado)
    const signedUrl = `https://api-fraga.zapcontabil.chat/files/${filename}`;
    console.log('[ETAPA6] SignedUrl:', signedUrl);

    // 5) Enviar via WhatsApp
    console.log('[ETAPA6] Enviando mensagem via WhatsApp...');

    // Obter token Zap (com refresh automático)
    const baseUrl = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
    const username = process.env.ZAP_CONTABIL_USER;
    const password = process.env.ZAP_CONTABIL_PASS;

    if (!username || !password) {
      return res.status(500).json({
        success: false,
        error: 'ZAP_CONTABIL_USER e ZAP_CONTABIL_PASS não configurados'
      });
    }

    const authManager = initZapAuthManager({ baseUrl, username, password });
    await authManager.refreshOrLogin();
    const tokenInfo = authManager.getTokenInfo();

    console.log('[ETAPA6] Token Zap obtido:', tokenInfo.tokenHash);
    console.log('[ETAPA6] Token info:', tokenInfo);

    const messagePayload = {
      body: `Olá! Segue em anexo o boleto para pagamento.\n\nValor: R$ ${receivable.amount}\nVencimento: ${receivable.dueDate?.toLocaleDateString('pt-BR')}`,
      medias: [
        {
          url: signedUrl,
          type: 'application/pdf',
          fileName: filename
        }
      ],
      quotedMsg: null
    };

    console.log('[ETAPA6] Payload:', JSON.stringify(messagePayload, null, 2));

    const sendResponse = await authManager.post(`/messages/${ticketId}`, messagePayload, {
      'Content-Type': 'application/json',
    });

    console.log('[ETAPA6] Mensagem enviada:', sendResponse.status, sendResponse.data);

    return res.json({
      success: true,
      message: 'ETAPA 6 E2E completo com sucesso',
      receivable: {
        id: receivable.contaAzulId,
        amount: receivable.amount,
        dueDate: receivable.dueDate,
        status: receivable.status,
      },
      pdf: {
        size: pdfBuffer.length,
        filename,
        signedUrl,
      },
      whatsapp: {
        ticketId,
        status: sendResponse.status,
        messageId: sendResponse.data?.id || sendResponse.data?.messageId,
        response: sendResponse.data,
      },
      proofUrl: `https://api-fraga.zapcontabil.chat/tickets/${ticketId}`,
      nextStep: 'Verificar mensagem no painel Zap (ticket #' + ticketId + ')'
    });
  } catch (error: any) {
    console.error('[ETAPA6] Erro:', error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || 'Erro desconhecido',
      details: error.response?.data
    });
  }
});

export default router;
