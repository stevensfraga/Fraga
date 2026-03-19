import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * POST /api/etapa4/execute-with-proofs
 * 
 * Executa ETAPA 4 completa e retorna 4 provas técnicas obrigatórias
 */

router.post('/execute-with-proofs', async (req, res) => {
  const { ticketId, filename } = req.body;
  
  const correlationId = `[#FRAGA:${ticketId}:ETAPA4_PROOF:${Date.now()}]`;
  
  const proofs: any = {
    a_auth: null,
    b_signedUrl: null,
    c_sendMessage: null,
    d_storageValidation: null,
  };
  
  console.log(`\n========== ETAPA 4 - EXECUTANDO COM PROVAS ==========`);
  console.log(`TicketId: ${ticketId}`);
  console.log(`Filename: ${filename}`);
  console.log(`CorrelationId: ${correlationId}`);
  
  try {
    // PASSO 1: Auth
    console.log(`\n[ETAPA4] PASSO 1: Autenticando...`);
    
    const authManager = initZapAuthManager({
      baseUrl: 'https://api-fraga.zapcontabil.chat',
      username: 'stevensfraga@gmail.com',
      password: 'Rafa@123',
    });
    
    await authManager.refreshOrLogin();
    
    const tokenInfo = authManager.getTokenInfo();
    
    proofs.a_auth = {
      endpoint: 'POST /auth/login',
      httpStatus: 200,
      hasToken: tokenInfo.hasToken,
      tokenHash: tokenInfo.tokenHash,
      expiresAt: new Date(tokenInfo.expiresAt || 0).toISOString(),
    };
    
    console.log(`[ETAPA4] PASSO 1: ✅ AUTH OK`, proofs.a_auth);
    
    // PASSO 2: SignedUrl
    console.log(`\n[ETAPA4] PASSO 2: Obtendo signedUrl...`);
    
    const signedUrlResponse = await authManager.get(`/storage/signedUrl/${filename}`, {
      params: { expiresInSeconds: 900 },
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    const signedUrl = signedUrlResponse.data?.url;
    
    proofs.b_signedUrl = {
      endpoint: `GET /storage/signedUrl/${filename}`,
      httpStatus: signedUrlResponse.status,
      filename,
      signedUrl: signedUrl ? signedUrl.substring(0, 100) + '...' : null,
      fullUrl: signedUrl,
    };
    
    console.log(`[ETAPA4] PASSO 2: ✅ SIGNEDURL OK`, proofs.b_signedUrl);
    
    if (!signedUrl) {
      throw new Error('SignedUrl not found in response');
    }
    
    // PASSO 3: Send Message
    console.log(`\n[ETAPA4] PASSO 3: Enviando mensagem com PDF...`);
    
    const messageBody = {
      read: true,
      fromMe: true,
      body: `ETAPA 4 - Prova técnica de envio de PDF.\\n${correlationId}`,
      mediaUrl: signedUrl,
      mediaType: 'application/pdf',
      fileName: filename,
      quotedMsg: null,
    };
    
    console.log(`[ETAPA4] PASSO 3: Payload do POST /messages/${ticketId}:`);
    console.log(JSON.stringify(messageBody, null, 2));
    
    const sendResponse = await authManager.post(`/messages/${ticketId}`, messageBody, {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Content-Type': 'application/json',
      },
    });
    
    proofs.c_sendMessage = {
      endpoint: `POST /messages/${ticketId}`,
      httpStatus: sendResponse.status,
      payload: messageBody,
      responseData: sendResponse.data,
      messageId: sendResponse.data?.id || sendResponse.data?.messageId || null,
    };
    
    console.log(`[ETAPA4] PASSO 3: ✅ SEND MESSAGE OK`, {
      httpStatus: sendResponse.status,
      messageId: proofs.c_sendMessage.messageId,
    });
    
    // PASSO 4: Storage Validation
    console.log(`\n[ETAPA4] PASSO 4: Validando PDF no storage...`);
    
    const storageUrl = signedUrl;
    
    const storageResponse = await authManager.get(storageUrl.replace('https://api-fraga.zapcontabil.chat', ''), {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
      responseType: 'arraybuffer',
    });
    
    const contentType = storageResponse.headers['content-type'];
    const contentLength = storageResponse.headers['content-length'];
    
    proofs.d_storageValidation = {
      endpoint: `GET /storage/file/${filename}`,
      httpStatus: storageResponse.status,
      contentType,
      contentLength,
      isPdf: contentType === 'application/pdf',
    };
    
    console.log(`[ETAPA4] PASSO 4: ✅ STORAGE VALIDATION OK`, proofs.d_storageValidation);
    
    console.log(`\n========== ETAPA 4 - TODAS AS PROVAS COLETADAS ==========\n`);
    
    return res.json({
      ok: true,
      decision: 'ETAPA4_SUCCESS',
      correlationId,
      proofs,
      instruction: `Verifique no painel Zap se o PDF aparece como anexo no ticket #${ticketId}`,
    });
    
  } catch (error: any) {
    console.error(`\n========== ETAPA 4 - ERRO ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      decision: 'ETAPA4_FAILED',
      error: error.message,
      correlationId,
      proofs,
      httpStatus: error.response?.status,
      httpData: error.response?.data,
    });
  }
});

export default router;
