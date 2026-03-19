import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * POST /api/test/zap/send-existing-file-multipart
 * 
 * ETAPA 4 FINAL: Envia PDF existente no storage Zap via multipart (REAL_UPLOAD)
 * 
 * Body:
 * - ticketId: ID do ticket no Zap (ex: 8019)
 * - filename: Nome do arquivo no storage Zap (ex: R7GERADORESLTDA_9peIejdj.pdf)
 * - correlationId: ID de correlação (opcional)
 */

router.post('/send-existing-file-multipart', async (req, res) => {
  const { ticketId, filename, correlationId: inputCorrelationId } = req.body;
  
  const correlationId = inputCorrelationId || `[#FRAGA:${ticketId}:ETAPA4_MULTIPART_FINAL:${Date.now()}]`;
  
  console.log(`\n========== ETAPA 4 MULTIPART FINAL - INICIANDO ==========`);
  console.log(`TicketId: ${ticketId}`);
  console.log(`Filename: ${filename}`);
  console.log(`CorrelationId: ${correlationId}`);
  
  try {
    // PASSO A: Login (igual r7-send-receivable.ts linhas 315-333)
    console.log(`\n[ETAPA4] PASSO A: Login programático...`);
    
    const loginRes = await fetch('https://api-fraga.zapcontabil.chat/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'stevensfraga@gmail.com',
        password: 'Rafa@123',
      }),
    });
    
    if (loginRes.status !== 200) {
      throw new Error(`Login failed: HTTP ${loginRes.status}`);
    }
    
    const loginData = await loginRes.json();
    const token = loginData.token;
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const jrtCookie = setCookie.split(';')[0] || '';
    
    console.log(`[ETAPA4] Login OK - Token: ${token.substring(0, 10)}...`);
    console.log(`[ETAPA4] Cookie: ${jrtCookie ? 'SIM' : 'NÃO'}`);
    
    // PASSO B: Warm-up (igual r7-send-receivable.ts linhas 336-350)
    console.log(`\n[ETAPA4] PASSO B: Warm-up GET /tickets...`);
    
    const warmupRes = await fetch('https://api-fraga.zapcontabil.chat/tickets?pageNumber=1&pageSize=10', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    if (warmupRes.status !== 200) {
      throw new Error(`Warm-up failed: HTTP ${warmupRes.status}`);
    }
    
    console.log(`[ETAPA4] Warm-up OK`);
    
    // PASSO C: Obter signedUrl
    console.log(`\n[ETAPA4] PASSO C: Obtendo signedUrl...`);
    
    const signedUrlRes = await fetch(`https://api-fraga.zapcontabil.chat/storage/signedUrl/${filename}?expiresInSeconds=900`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    const signedUrlData = await signedUrlRes.json();
    const signedUrl = signedUrlData?.url;
    
    if (!signedUrl) {
      throw new Error('SignedUrl not found');
    }
    
    console.log(`[ETAPA4] SignedUrl: ${signedUrl.substring(0, 80)}...`);
    
    // PASSO D: Download PDF
    console.log(`\n[ETAPA4] PASSO D: Baixando PDF...`);
    
    const pdfRes = await fetch(signedUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
      },
    });
    
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const contentType = pdfRes.headers.get('content-type') || '';
    
    console.log(`[ETAPA4] PDF baixado - Size: ${pdfBuffer.length} bytes, ContentType: ${contentType}`);
    
    // A3: Validar
    if (pdfBuffer.length < 1000) {
      throw new Error(`PDF muito pequeno: ${pdfBuffer.length} bytes`);
    }
    
    if (!contentType?.includes('application/pdf')) {
      throw new Error(`Content-Type inválido: ${contentType}`);
    }
    
    console.log(`[ETAPA4] ✅ PDF válido`);
    
    // PASSO E: Enviar via multipart (REAL_UPLOAD exato - linhas 356-362)
    console.log(`\n[ETAPA4] PASSO E: Enviando via multipart...`);
    
    const form = new FormData();
    form.append('fromMe', 'true');
    
    const pdfBytes = Buffer.isBuffer(pdfBuffer) ? new Uint8Array(pdfBuffer) : pdfBuffer;
    form.append('medias', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
    
    form.append('filename', filename);
    form.append('body', `Cobrança R7 - boleto em anexo.\\n${correlationId}`);
    form.append('mediaType', 'application/pdf');
    
    console.log(`[ETAPA4] FormData preparado:`);
    console.log(`  - fromMe: true`);
    console.log(`  - medias: Blob (${pdfBuffer.length} bytes) + filename: ${filename}`);
    console.log(`  - filename: ${filename}`);
    console.log(`  - body: ${correlationId}`);
    console.log(`  - mediaType: application/pdf`);
    
    // Enviar
    const sendResponse = await fetch(`https://api-fraga.zapcontabil.chat/messages/${ticketId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form,
    });
    
    const sendResponseText = await sendResponse.text();
    let sendResponseJson: any = {};
    try {
      sendResponseJson = JSON.parse(sendResponseText);
    } catch (e) {
      sendResponseJson = { raw: sendResponseText };
    }
    
    console.log(`[ETAPA4] Send HTTP Status: ${sendResponse.status}`);
    console.log(`[ETAPA4] Send Response:`, JSON.stringify(sendResponseJson, null, 2));
    
    if (sendResponse.status !== 200) {
      throw new Error(`Send failed: HTTP ${sendResponse.status}: ${JSON.stringify(sendResponseJson)}`);
    }
    
    console.log(`\n========== ETAPA 4 MULTIPART FINAL - SUCESSO ==========\n`);
    
    return res.json({
      ok: true,
      decision: 'ETAPA4_MULTIPART_FINAL_SUCCESS',
      correlationId,
      steps: {
        stepA_download: {
          signedUrl: signedUrl.substring(0, 100) + '...',
          pdfSize: pdfBuffer.length,
          contentType,
        },
        stepB_send: {
          httpStatus: sendResponse.status,
          responseData: sendResponseJson,
        },
      },
      instruction: `Verifique no painel Zap se o PDF aparece com PREVIEW no ticket #${ticketId}`,
    });
    
  } catch (error: any) {
    console.error(`\n========== ETAPA 4 MULTIPART FINAL - ERRO ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      decision: 'ETAPA4_MULTIPART_FINAL_FAILED',
      error: error.message,
      correlationId,
      httpStatus: error.response?.status,
      httpData: error.response?.data,
    });
  }
});

export default router;
