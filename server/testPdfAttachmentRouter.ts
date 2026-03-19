import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * POST /api/test/pdf-attachment-debug
 * 
 * Testar diferentes formatos de anexo PDF
 * Logar request/response completos para descobrir formato correto
 */

router.post('/pdf-attachment-debug', async (req, res) => {
  const { ticketId, filename, variant } = req.body;
  
  const correlationId = `[#FRAGA:${ticketId}:PDF_DEBUG:${variant}:${Date.now()}]`;
  
  console.log(`\n========== PDF ATTACHMENT DEBUG ==========`);
  console.log(`Variant: ${variant}`);
  console.log(`TicketId: ${ticketId}`);
  console.log(`Filename: ${filename}`);
  console.log(`CorrelationId: ${correlationId}`);
  
  try {
    // Auth
    const authManager = initZapAuthManager({
      baseUrl: process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat',
      username: process.env.ZAP_CONTABIL_USER!,
      password: process.env.ZAP_CONTABIL_PASS!,
    });
    
    await authManager.refreshOrLogin();
    
    // Get signedUrl
    const signedUrlResponse = await authManager.get(`/storage/signedUrl/${filename}`, {
      params: { expiresInSeconds: 900 },
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });
    
    const signedUrl = signedUrlResponse.data?.url;
    
    if (!signedUrl) {
      return res.status(500).json({
        ok: false,
        error: 'SignedUrl not found',
        correlationId,
      });
    }
    
    console.log(`SignedUrl obtained: ${signedUrl.substring(0, 80)}...`);
    
    // Testar diferentes variantes de payload
    let messageBody: any;
    
    switch (variant) {
      case 'v1_mediaUrl':
        messageBody = {
          read: true,
          fromMe: true,
          body: `PDF Debug V1 (mediaUrl).\n${correlationId}`,
          mediaUrl: signedUrl,
          mediaType: 'application/pdf',
          fileName: filename,
          quotedMsg: null,
        };
        break;
        
      case 'v2_media':
        messageBody = {
          read: true,
          fromMe: true,
          body: `PDF Debug V2 (media).\n${correlationId}`,
          media: signedUrl,
          mediaType: 'application/pdf',
          fileName: filename,
          quotedMsg: null,
        };
        break;
        
      case 'v3_attachment':
        messageBody = {
          read: true,
          fromMe: true,
          body: `PDF Debug V3 (attachment).\n${correlationId}`,
          attachment: signedUrl,
          attachmentType: 'application/pdf',
          attachmentName: filename,
          quotedMsg: null,
        };
        break;
        
      case 'v4_document':
        messageBody = {
          read: true,
          fromMe: true,
          body: `PDF Debug V4 (document).\n${correlationId}`,
          document: signedUrl,
          documentType: 'application/pdf',
          documentName: filename,
          quotedMsg: null,
        };
        break;
        
      case 'v5_file':
        messageBody = {
          read: true,
          fromMe: true,
          body: `PDF Debug V5 (file).\n${correlationId}`,
          file: signedUrl,
          fileType: 'application/pdf',
          fileName: filename,
          quotedMsg: null,
        };
        break;
        
      default:
        return res.status(400).json({
          ok: false,
          error: 'Invalid variant. Use: v1_mediaUrl, v2_media, v3_attachment, v4_document, v5_file',
        });
    }
    
    console.log(`\n========== REQUEST BODY (${variant}) ==========`);
    console.log(JSON.stringify(messageBody, null, 2));
    console.log(`==========================================\n`);
    
    // Send message
    const sendResponse = await authManager.post(`/messages/${ticketId}`, messageBody, {
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`\n========== RESPONSE (${variant}) ==========`);
    console.log(`Status: ${sendResponse.status}`);
    console.log(`Data:`, JSON.stringify(sendResponse.data, null, 2));
    console.log(`==========================================\n`);
    
    return res.json({
      ok: true,
      variant,
      correlationId,
      requestBody: messageBody,
      responseStatus: sendResponse.status,
      responseData: sendResponse.data,
      signedUrl,
    });
    
  } catch (error: any) {
    console.error(`\n========== ERROR (${variant}) ==========`);
    console.error(error);
    console.error(`==========================================\n`);
    
    return res.status(500).json({
      ok: false,
      variant,
      error: error.message,
      correlationId,
    });
  }
});

export default router;
