import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * GET /api/etapa4/discovery-messages
 * 
 * Descobrir endpoint real de listagem de mensagens
 * Testar 10 rotas e retornar a que funciona
 */

router.get('/discovery-messages', async (req, res) => {
  console.log(`\n========== ETAPA 4 - DISCOVERY MESSAGES ==========`);
  
  try {
    // Auth com hardcode temporário
    const authManager = initZapAuthManager({
      baseUrl: 'https://api-fraga.zapcontabil.chat',
      username: 'stevensfraga@gmail.com',
      password: 'Rafa@123', // TEMPORÁRIO
    });
    
    await authManager.refreshOrLogin();
    console.log(`Auth OK`);
    
    // Testar 10 rotas candidatas
    const candidates = [
      '/tickets/8019/messages',
      '/messages?ticketId=8019',
      '/tickets/8019/chat/messages',
      '/tickets/8019/contacts/messages',
      '/tickets/8019/history',
      '/tickets/8019/events',
      '/messages/8019',
      '/api/messages/8019',
      '/chat/messages?ticketId=8019',
      '/ticket/8019/messages',
    ];
    
    const results = [];
    
    for (const endpoint of candidates) {
      try {
        console.log(`Testing: ${endpoint}`);
        
        const response = await authManager.get(endpoint, {
          headers: {
            'Origin': 'https://fraga.zapcontabil.chat',
            'Referer': 'https://fraga.zapcontabil.chat/',
          },
          timeout: 5000,
        });
        
        const data = response.data;
        const isArray = Array.isArray(data);
        const hasMessages = isArray && data.length > 0;
        const firstItem = hasMessages ? data[0] : null;
        
        results.push({
          endpoint,
          status: response.status,
          isArray,
          length: isArray ? data.length : 0,
          hasMessages,
          firstItemKeys: firstItem ? Object.keys(firstItem) : [],
          sample: firstItem ? JSON.stringify(firstItem).substring(0, 200) : null,
        });
        
        console.log(`  → Status: ${response.status}, IsArray: ${isArray}, Length: ${isArray ? data.length : 0}`);
        
      } catch (error: any) {
        results.push({
          endpoint,
          status: error.response?.status || 0,
          error: error.message,
        });
        console.log(`  → Error: ${error.message}`);
      }
    }
    
    // Encontrar o endpoint que retorna array com mensagens
    const validEndpoint = results.find(r => r.hasMessages);
    
    console.log(`\n========== RESULTS ==========`);
    console.log(`Valid endpoint found: ${validEndpoint ? validEndpoint.endpoint : 'NONE'}`);
    console.log(`==========================================\n`);
    
    return res.json({
      ok: !!validEndpoint,
      validEndpoint: validEndpoint?.endpoint || null,
      results,
    });
    
  } catch (error: any) {
    console.error(`\n========== ERROR ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/etapa4/extract-pdf-structure
 * 
 * Extrair estrutura de mensagem com PDF anexado
 */

router.get('/extract-pdf-structure', async (req, res) => {
  const { endpoint } = req.query;
  
  if (!endpoint) {
    return res.status(400).json({
      ok: false,
      error: 'Missing endpoint parameter',
    });
  }
  
  console.log(`\n========== ETAPA 4 - EXTRACT PDF STRUCTURE ==========`);
  console.log(`Endpoint: ${endpoint}`);
  
  try {
    // Auth
    const authManager = initZapAuthManager({
      baseUrl: 'https://api-fraga.zapcontabil.chat',
      username: 'stevensfraga@gmail.com',
      password: 'Rafa@123', // TEMPORÁRIO
    });
    
    await authManager.refreshOrLogin();
    
    // Buscar mensagens
    const response = await authManager.get(endpoint as string, {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    const messages = Array.isArray(response.data) ? response.data : [];
    
    console.log(`Total messages: ${messages.length}`);
    
    // Encontrar mensagem com PDF
    const pdfMessage = messages.find((msg: any) => {
      const hasPdf = 
        msg.mediaUrl?.includes('.pdf') ||
        msg.media?.includes('.pdf') ||
        msg.fileName?.includes('.pdf') ||
        msg.attachment?.includes('.pdf') ||
        msg.document?.includes('.pdf') ||
        (msg.medias && msg.medias.length > 0) ||
        (msg.attachments && msg.attachments.length > 0);
      
      return hasPdf;
    });
    
    if (!pdfMessage) {
      return res.json({
        ok: false,
        error: 'No message with PDF found',
        totalMessages: messages.length,
        sampleMessage: messages[0] ? JSON.stringify(messages[0], null, 2) : null,
      });
    }
    
    console.log(`\n========== PDF MESSAGE FOUND ==========`);
    console.log(JSON.stringify(pdfMessage, null, 2));
    console.log(`==========================================\n`);
    
    // Extrair campos relevantes
    const relevantFields = {
      id: pdfMessage.id,
      body: pdfMessage.body,
      mediaUrl: pdfMessage.mediaUrl,
      media: pdfMessage.media,
      medias: pdfMessage.medias,
      fileName: pdfMessage.fileName,
      mediaType: pdfMessage.mediaType,
      attachment: pdfMessage.attachment,
      attachments: pdfMessage.attachments,
      document: pdfMessage.document,
      file: pdfMessage.file,
      files: pdfMessage.files,
    };
    
    return res.json({
      ok: true,
      pdfMessage: relevantFields,
      fullMessage: pdfMessage,
      allKeys: Object.keys(pdfMessage),
    });
    
  } catch (error: any) {
    console.error(`\n========== ERROR ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

export default router;
