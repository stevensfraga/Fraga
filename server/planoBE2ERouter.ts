import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * POST /api/test/r7/send-from-existing-zap-file
 * 
 * PLANO B E2E: Envia PDF já existente no storage Zap via WhatsApp
 * 
 * Body:
 * - ticketId: ID do ticket no Zap (ex: 8019)
 * - clientId: ID do cliente no banco (ex: 30004)
 * - receivableId: ID da conta a receber (ex: 60001)
 * - filename: Nome do arquivo no storage Zap (ex: R7GERADORESLTDA_9peIejdj.pdf)
 * - correlationId: ID de correlação (opcional, será gerado se não fornecido)
 * 
 * Output:
 * - ok: boolean
 * - decision: string
 * - signedUrl: string (URL assinada do PDF)
 * - messageId: string (ID da mensagem enviada, se disponível)
 * - correlationId: string
 */

router.post('/send-from-existing-zap-file', async (req, res) => {
  const { ticketId, clientId, receivableId, filename, correlationId: inputCorrelationId } = req.body;
  
  const timestamp = Date.now();
  const correlationId = inputCorrelationId || `[#FRAGA:${ticketId}:${clientId}:${receivableId}:PLANO_B_REAL_${timestamp}]`;
  
  console.log(`[PlanoBE2E] Iniciando envio E2E correlationId: ${correlationId}`);
  
  try {
    // Validar inputs obrigatórios
    if (!ticketId || !filename) {
      return res.status(400).json({
        ok: false,
        decision: 'MISSING_REQUIRED_FIELDS',
        error: 'ticketId e filename são obrigatórios',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    // PASSO 1: Autenticar no Zap
    console.log(`[PlanoBE2E] PASSO 1: Autenticando no Zap...`);
    
    const baseUrl = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
    const username = process.env.ZAP_CONTABIL_USER || 'stevensfraga@gmail.com'; // TEMPORÁRIO
    const password = process.env.ZAP_CONTABIL_PASS || 'Rafa@123'; // TEMPORÁRIO
    
    if (!username || !password) {
      return res.status(500).json({
        ok: false,
        decision: 'MISSING_CREDENTIALS',
        error: 'ZAP_CONTABIL_USER e ZAP_CONTABIL_PASS não configurados',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    const authManager = initZapAuthManager({
      baseUrl,
      username,
      password,
    });
    
    await authManager.refreshOrLogin();
    
    const tokenInfo = authManager.getTokenInfo();
    console.log(`[PlanoBE2E] Autenticação OK`, {
      hasToken: tokenInfo.hasToken,
      expiresAt: new Date(tokenInfo.expiresAt || 0).toISOString(),
      tokenHash: tokenInfo.tokenHash, // Log apenas hash, não token completo
    });
    
    // PASSO 2: Obter signedUrl do PDF
    console.log(`[PlanoBE2E] PASSO 2: Obtendo signedUrl para ${filename}...`);
    
    const signedUrlResponse = await authManager.get(`/storage/signedUrl/${filename}`, {
      params: {
        expiresInSeconds: 900,
      },
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Accept': 'application/json',
      },
    });
    
    const signedUrl = signedUrlResponse.data?.url;
    
    if (!signedUrl) {
      return res.status(500).json({
        ok: false,
        decision: 'SIGNED_URL_NOT_FOUND',
        error: 'SignedUrl não retornada pela API',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    console.log(`[PlanoBE2E] SignedUrl obtida:`, {
      url: signedUrl.substring(0, 100) + '...',
    });
    
    // PASSO 3: Enviar mensagem com PDF anexado
    console.log(`[PlanoBE2E] PASSO 3: Enviando mensagem no ticket ${ticketId}...`);
    
    const messageBody = {
      read: true,
      fromMe: true,
      body: `Cobrança R7 - boleto em anexo.\n${correlationId}`,
      mediaUrl: signedUrl,
      mediaType: 'application/pdf',
      fileName: filename,
      quotedMsg: null,
    };
    
    console.log(`\n========== REQUEST BODY (PLANO B) ==========`);
    console.log(JSON.stringify(messageBody, null, 2));
    console.log(`SignedUrl: ${signedUrl.substring(0, 100)}...`);
    console.log(`==========================================\n`);
    
    const sendResponse = await authManager.post(`/messages/${ticketId}`, messageBody, {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
       console.log(`\n========== RESPONSE (PLANO B) ==========`);
    console.log(`Status: ${sendResponse.status}`);
    console.log(`Data:`, JSON.stringify(sendResponse.data, null, 2));
    console.log(`==========================================\n`);
    
    console.log(`[PlanoBE2E] Mensagem enviada com sucesso!`, {
      status: sendResponse.status,
      decision: 'PLANO_B_SUCCESS',
      dataKeys: Object.keys(sendResponse.data || {}),
    });
    
    return res.json({
      ok: true,
      decision: 'PLANO_B_SUCCESS',
      signedUrl,
      storageUrl: signedUrl,
      messageId: sendResponse.data?.id || sendResponse.data?.messageId || 'N/A',
      messageResponse: sendResponse.data,
      correlationId,
      timestamp: new Date().toISOString(),
      logs: {
        step1_auth: 'OK',
        step2_signedUrl: 'OK',
        step3_sendMessage: 'OK',
      },
    });
    
  } catch (error: any) {
    console.error('[PlanoBE2E] Erro fatal:', error);
    
    const errorDetails: any = {
      ok: false,
      decision: 'FATAL_ERROR',
      error: error.message,
      correlationId,
      timestamp: new Date().toISOString(),
    };
    
    if (error.response) {
      errorDetails.httpStatus = error.response.status;
      errorDetails.httpData = error.response.data;
      errorDetails.url = error.config?.url;
    }
    
    return res.status(500).json(errorDetails);
  }
});

export default router;
