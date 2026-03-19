/**
 * R7 Acceptance Test Endpoints
 * PASSO 2: send-real (texto)
 * PASSO 3: send-real-with-pdf (PDF com anexo)
 */

import express, { Router } from 'express';
import axios from 'axios';
import { ZapAuthManager } from './zapcontabilAuthManager';
import { simpleCache } from './utils/simpleCache';

const router: Router = express.Router();

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';

interface SendRealRequest {
  ticketId: number;
  body?: string;
  correlationId: string;
}

interface SendRealWithPdfRequest {
  ticketId: number;
  pdfUrlExterna?: string;
  fileName?: string;
  mediaType?: string;
  correlationId: string;
}

interface SendResponse {
  ok: boolean;
  httpStatus?: number;
  correlationId: string;
  storageFileName?: string;
  signedUrl?: string;
  providerResponse?: any;
  logs: string[];
  error?: string;
}

/**
 * POST /api/test/r7/send-real
 * Enviar mensagem de texto simples no ticket
 */
router.post('/send-real', async (req, res) => {
  const { ticketId, body, correlationId } = req.body as SendRealRequest;
  const response: SendResponse = {
    ok: false,
    correlationId,
    logs: [],
  };

  try {
    if (!ticketId || !correlationId) {
      response.error = 'Missing required fields: ticketId, correlationId';
      return res.status(400).json(response);
    }

    response.logs.push('[send-real] Iniciando...');

    // Autenticar com ZapAuthManager
    const authManager = new ZapAuthManager({
      baseUrl: ZAP_BASE_URL,
      username: process.env.ZAP_CONTABIL_USER || 'Stevensfraga@gmail.com',
      password: process.env.ZAP_CONTABIL_PASS || 'Fraga@123',
      jrtCookie: process.env.ZAP_CONTABIL_JRT_COOKIE || '',
    });

    await (authManager as any).refreshOrLogin();
    const token = (authManager as any).tokenCache?.accessToken;

    if (!token) {
      response.error = 'Failed to obtain authentication token';
      response.logs.push('[send-real] Authentication failed');
      return res.status(401).json(response);
    }

    response.logs.push('[send-real] Authenticated');

    // Criar axios instance
    const axiosInstance = axios.create({
      baseURL: ZAP_BASE_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
      timeout: 10000,
      withCredentials: true,
    });

    // Enviar mensagem
    const messageBody = body || `R7 - Mensagem de teste.\n${correlationId}`;
    const payload = {
      read: true,
      fromMe: true,
      body: messageBody,
      quotedMsg: null,
    };

    response.logs.push(`[send-real] Sending message to ticket ${ticketId}`);

    const sendResponse = await axiosInstance.post(`/messages/${ticketId}`, payload, {
      validateStatus: () => true,
    });

    response.httpStatus = sendResponse.status;
    response.providerResponse = sendResponse.data;

    if (sendResponse.status >= 200 && sendResponse.status < 300) {
      response.ok = true;
      response.logs.push(`[send-real] Message sent with HTTP ${sendResponse.status}`);
    } else {
      response.error = `HTTP ${sendResponse.status}`;
      response.logs.push(`[send-real] Failed with HTTP ${sendResponse.status}`);
    }

    return res.json(response);
  } catch (error: any) {
    response.error = error.message;
    response.logs.push(`[send-real] Error: ${error.message}`);
    return res.status(500).json(response);
  }
});

/**
 * POST /api/test/r7/send-real-with-pdf
 * Enviar mensagem com PDF anexado
 */
router.post('/send-real-with-pdf', async (req, res) => {
  const { ticketId, pdfUrlExterna, fileName, mediaType, correlationId } = req.body as SendRealWithPdfRequest;
  const response: SendResponse = {
    ok: false,
    correlationId,
    logs: [],
  };

  try {
    if (!ticketId || !correlationId) {
      response.error = 'Missing required fields: ticketId, correlationId';
      return res.status(400).json(response);
    }

    response.logs.push('[send-real-with-pdf] Iniciando...');

    // Autenticar com ZapAuthManager
    const authManager = new ZapAuthManager({
      baseUrl: ZAP_BASE_URL,
      username: process.env.ZAP_CONTABIL_USER || 'Stevensfraga@gmail.com',
      password: process.env.ZAP_CONTABIL_PASS || 'Fraga@123',
      jrtCookie: process.env.ZAP_CONTABIL_JRT_COOKIE || '',
    });

    await (authManager as any).refreshOrLogin();
    const token = (authManager as any).tokenCache?.accessToken;

    if (!token) {
      response.error = 'Failed to obtain authentication token';
      response.logs.push('[send-real-with-pdf] Authentication failed');
      return res.status(401).json(response);
    }

    response.logs.push('[send-real-with-pdf] Authenticated');

    // Criar axios instance
    const axiosInstance = axios.create({
      baseURL: ZAP_BASE_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
      timeout: 10000,
      withCredentials: true,
    });

    // 1. Criar PDF de teste (se não fornecido)
    let pdfBuffer: Buffer;
    if (pdfUrlExterna) {
      response.logs.push(`[send-real-with-pdf] Downloading PDF from ${pdfUrlExterna}`);
      const pdfResponse = await axios.get(pdfUrlExterna, { responseType: 'arraybuffer' });
      pdfBuffer = Buffer.from(pdfResponse.data);
    } else {
      // PDF simples de teste
      response.logs.push('[send-real-with-pdf] Creating test PDF');
      pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/Resources<<>>>>endobj xref 0 4 0000000000 65535 f 0000000009 00000 n 0000000058 00000 n 0000000115 00000 n trailer<</Size 4/Root 1 0 R>>startxref 190 %%EOF');
    }

    response.logs.push(`[send-real-with-pdf] PDF size: ${pdfBuffer.length} bytes`);

    // 2. Upload PDF para storage interno
    response.logs.push('[send-real-with-pdf] Uploading PDF to storage');
    
    const uploadEndpoint = '/files/upload'; // Do discovery
    const boundary = '----' + Math.random().toString(36).substr(2);
    const uploadFileName = fileName || `boleto-r7-${Date.now()}.pdf`;

    let uploadBody = '';
    uploadBody += `--${boundary}\r\n`;
    uploadBody += `Content-Disposition: form-data; name="file"; filename="${uploadFileName}"\r\n`;
    uploadBody += `Content-Type: application/pdf\r\n\r\n`;

    const uploadBuffer = Buffer.concat([
      Buffer.from(uploadBody),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadResponse = await axiosInstance.post(uploadEndpoint, uploadBuffer, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      validateStatus: () => true,
    });

    response.logs.push(`[send-real-with-pdf] Upload HTTP ${uploadResponse.status}`);

    if (uploadResponse.status >= 200 && uploadResponse.status < 300) {
      response.logs.push('[send-real-with-pdf] Upload successful');
    } else {
      response.error = `Upload failed with HTTP ${uploadResponse.status}`;
      response.logs.push(`[send-real-with-pdf] Upload failed: ${JSON.stringify(uploadResponse.data)}`);
      response.httpStatus = uploadResponse.status;
      return res.json(response);
    }

    // 3. Extrair filename do response
    const storageFileName = uploadResponse.data?.filename || uploadResponse.data?.key || uploadResponse.data?.id || uploadFileName;
    response.storageFileName = storageFileName;
    response.logs.push(`[send-real-with-pdf] Storage filename: ${storageFileName}`);

    // 4. Obter signedUrl
    response.logs.push('[send-real-with-pdf] Getting signed URL');
    const signedUrlResponse = await axiosInstance.get(`/storage/signedUrl/${storageFileName}?expiresInSeconds=900`, {
      validateStatus: () => true,
    });

    if (signedUrlResponse.status >= 200 && signedUrlResponse.status < 300) {
      response.signedUrl = signedUrlResponse.data?.url;
      response.logs.push(`[send-real-with-pdf] Signed URL obtained`);
    } else {
      response.error = `SignedUrl failed with HTTP ${signedUrlResponse.status}`;
      response.logs.push(`[send-real-with-pdf] SignedUrl failed: ${JSON.stringify(signedUrlResponse.data)}`);
      response.httpStatus = signedUrlResponse.status;
      return res.json(response);
    }

    // 5. Enviar mensagem com anexo
    response.logs.push(`[send-real-with-pdf] Sending message with attachment to ticket ${ticketId}`);
    
    const messagePayload = {
      read: true,
      fromMe: true,
      mediaUrl: response.signedUrl,
      mediaType: mediaType || 'application/pdf',
      fileName: uploadFileName,
      body: `R7 - Segue boleto em anexo.\n${correlationId}`,
      quotedMsg: null,
    };

    const sendResponse = await axiosInstance.post(`/messages/${ticketId}`, messagePayload, {
      validateStatus: () => true,
    });

    response.httpStatus = sendResponse.status;
    response.providerResponse = sendResponse.data;

    if (sendResponse.status >= 200 && sendResponse.status < 300) {
      response.ok = true;
      response.logs.push(`[send-real-with-pdf] Message sent with HTTP ${sendResponse.status}`);
    } else {
      response.error = `HTTP ${sendResponse.status}`;
      response.logs.push(`[send-real-with-pdf] Failed with HTTP ${sendResponse.status}`);
    }

    return res.json(response);
  } catch (error: any) {
    response.error = error.message;
    response.logs.push(`[send-real-with-pdf] Error: ${error.message}`);
    return res.status(500).json(response);
  }
});

export default router;
