import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * POST /api/etapa4/execute-real-upload
 * 
 * ETAPA 4 FINAL: Reproduz exatamente o fluxo REAL_UPLOAD que funcionou
 * 
 * Body:
 * - ticketId: ID do ticket no Zap (ex: 8019)
 * - filename: Nome do arquivo no storage Zap (ex: R7GERADORESLTDA_9peIejdj.pdf)
 */

router.post('/execute-real-upload', async (req, res) => {
  const { ticketId, filename } = req.body;
  
  const correlationId = `[#FRAGA:${ticketId}:ETAPA4_REAL_UPLOAD:${Date.now()}]`;
  
  console.log(`\n========== ETAPA 4 REAL_UPLOAD - INICIANDO ==========`);
  console.log(`TicketId: ${ticketId}`);
  console.log(`Filename: ${filename}`);
  console.log(`CorrelationId: ${correlationId}`);
  
  try {
    // Auth
    console.log(`\n[ETAPA4] Auth...`);
    
    const authManager = initZapAuthManager({
      baseUrl: 'https://api-fraga.zapcontabil.chat',
      username: 'stevensfraga@gmail.com',
      password: 'Rafa@123',
    });
    
    await authManager.refreshOrLogin();
    
    const tokenInfo = authManager.getTokenInfo();
    console.log(`[ETAPA4] Auth OK - Token: ${tokenInfo.tokenHash}`);
    
    // PASSO 1: Obter signedUrl do PDF existente
    console.log(`\n[ETAPA4] PASSO 1: Obtendo signedUrl...`);
    
    const signedUrlResponse = await authManager.get(`/storage/signedUrl/${filename}`, {
      params: { expiresInSeconds: 900 },
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    const signedUrl = signedUrlResponse.data?.url;
    
    if (!signedUrl) {
      throw new Error('SignedUrl not found');
    }
    
    console.log(`[ETAPA4] SignedUrl: ${signedUrl.substring(0, 80)}...`);
    
    // PASSO 2: Upload para Zap storage interno (igual REAL_UPLOAD)
    console.log(`\n[ETAPA4] PASSO 2: Upload para Zap storage...`);
    
    const uploadResponse = await authManager.post('/storage/upload', {
      url: signedUrl,
      fileName: filename,
    }, {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`\n========== UPLOAD RESPONSE COMPLETA ==========`);
    console.log(`HTTP Status: ${uploadResponse.status}`);
    console.log(`Response RAW:`, JSON.stringify(uploadResponse.data, null, 2));
    console.log(`Response Keys:`, Object.keys(uploadResponse.data || {}));
    console.log(`Response Type:`, typeof uploadResponse.data);
    console.log(`Is Array:`, Array.isArray(uploadResponse.data));
    console.log(`==========================================\n`);
    
    // NÃO FILTRAR - retornar tudo para análise
    const uploadResult = uploadResponse.data;
    
    // PASSO 3: Enviar mensagem com mediaUrl (igual REAL_UPLOAD)
    console.log(`\n[ETAPA4] PASSO 3: Enviando mensagem...`);
    
    const messageBody = {
      body: `ETAPA 4 - Reprodução REAL_UPLOAD.\\n${correlationId}`,
      uploadResult: uploadResult, // Enviar resultado completo do upload
      mediaType: 'application/pdf',
      fileName: filename,
    };
    
    console.log(`[ETAPA4] Message payload:`, JSON.stringify(messageBody, null, 2));
    
    const sendResponse = await authManager.post(`/messages/${ticketId}`, messageBody, {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`[ETAPA4] Send response:`, JSON.stringify(sendResponse.data, null, 2));
    
    console.log(`\n========== ETAPA 4 REAL_UPLOAD - SUCESSO ==========\n`);
    
    return res.json({
      ok: true,
      decision: 'ETAPA4_REAL_UPLOAD_SUCCESS',
      correlationId,
      steps: {
        step1_signedUrl: { httpStatus: signedUrlResponse.status, url: signedUrl.substring(0, 100) + '...' },
        step2_upload: { httpStatus: uploadResponse.status, uploadResult: uploadResult },
        step3_send: { httpStatus: sendResponse.status, messageId: sendResponse.data?.id || sendResponse.data?.messageId },
      },
      instruction: `Verifique no painel Zap se o PDF aparece com preview no ticket #${ticketId}`,
    });
    
  } catch (error: any) {
    console.error(`\n========== ETAPA 4 REAL_UPLOAD - ERRO ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      decision: 'ETAPA4_REAL_UPLOAD_FAILED',
      error: error.message,
      correlationId,
      httpStatus: error.response?.status,
      httpData: error.response?.data,
    });
  }
});

export default router;
