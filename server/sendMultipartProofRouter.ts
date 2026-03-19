import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';
import FormData from 'form-data';

const router = express.Router();

/**
 * POST /api/test/r7/send-multipart-proof
 * 
 * ETAPA 4 DEFINITIVA: Envia PDF via multipart/form-data
 * 
 * Body:
 * - ticketId: ID do ticket no Zap (ex: 8019)
 * - filename: Nome do arquivo no storage Zap (ex: R7GERADORESLTDA_9peIejdj.pdf)
 */

router.post('/send-multipart-proof', async (req, res) => {
  const { ticketId, filename } = req.body;
  
  const correlationId = `[#FRAGA:${ticketId}:ETAPA4_MULTIPART:${Date.now()}]`;
  
  console.log(`\n========== ETAPA 4 MULTIPART - INICIANDO ==========`);
  console.log(`TicketId: ${ticketId}`);
  console.log(`Filename: ${filename}`);
  console.log(`CorrelationId: ${correlationId}`);
  
  try {
    // PASSO 1: Auth
    console.log(`\n[Multipart] PASSO 1: Autenticando...`);
    
    const authManager = initZapAuthManager({
      baseUrl: 'https://api-fraga.zapcontabil.chat',
      username: 'stevensfraga@gmail.com',
      password: 'Rafa@123',
    });
    
    await authManager.refreshOrLogin();
    
    const tokenInfo = authManager.getTokenInfo();
    console.log(`[Multipart] Auth OK - Token: ${tokenInfo.tokenHash}`);
    
    // PASSO 2: Baixar PDF do storage
    console.log(`\n[Multipart] PASSO 2: Baixando PDF do storage...`);
    
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
    
    console.log(`[Multipart] SignedUrl obtida: ${signedUrl.substring(0, 80)}...`);
    
    // Baixar PDF
    const pdfResponse = await authManager.get(signedUrl.replace('https://api-fraga.zapcontabil.chat', ''), {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
      responseType: 'arraybuffer',
    });
    
    const pdfBuffer = Buffer.from(pdfResponse.data);
    
    console.log(`[Multipart] PDF baixado - Size: ${pdfBuffer.length} bytes`);
    
    // PASSO 3: Enviar via multipart/form-data
    console.log(`\n[Multipart] PASSO 3: Enviando via multipart/form-data...`);
    
    const formData = new FormData();
    formData.append('file', pdfBuffer, {
      filename: filename,
      contentType: 'application/pdf',
    });
    formData.append('body', `ETAPA 4 MULTIPART - Prova definitiva.\\n${correlationId}`);
    formData.append('read', 'true');
    formData.append('fromMe', 'true');
    
    console.log(`[Multipart] FormData preparado:`);
    console.log(`  - file: ${filename} (${pdfBuffer.length} bytes)`);
    console.log(`  - body: ${correlationId}`);
    console.log(`  - read: true`);
    console.log(`  - fromMe: true`);
    
    const sendResponse = await authManager.post(`/messages/${ticketId}`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    console.log(`\n[Multipart] PASSO 3: ✅ ENVIADO`);
    console.log(`  - HTTP Status: ${sendResponse.status}`);
    console.log(`  - Response:`, JSON.stringify(sendResponse.data, null, 2));
    
    console.log(`\n========== ETAPA 4 MULTIPART - SUCESSO ==========\n`);
    
    return res.json({
      ok: true,
      decision: 'ETAPA4_MULTIPART_SUCCESS',
      correlationId,
      httpStatus: sendResponse.status,
      responseData: sendResponse.data,
      pdfSize: pdfBuffer.length,
      instruction: `Verifique no painel Zap se o PDF aparece como anexo visual no ticket #${ticketId}`,
    });
    
  } catch (error: any) {
    console.error(`\n========== ETAPA 4 MULTIPART - ERRO ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      decision: 'ETAPA4_MULTIPART_FAILED',
      error: error.message,
      correlationId,
      httpStatus: error.response?.status,
      httpData: error.response?.data,
    });
  }
});

export default router;
