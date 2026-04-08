/**
 * R7 Acceptance Test Endpoints - FIXED
 * PASSO 2: send-real (texto)
 * PASSO 3: send-real-with-pdf (PDF com anexo) - FIX DEFINITIVO
 */

import express, { Router } from 'express';
import axios from 'axios';
import { ZapAuthManager } from './zapcontabilAuthManager';
import generateLargePdf from './utils/pdfGenerator';
import { discoverUploadEndpointReal } from './discover-upload-real-validator';

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

interface UploadInfo {
  httpStatus?: number;
  uploadEndpoint?: string;
  fieldName?: string;
  storedFileName?: string;
  rawResponseKeys?: string[];
  rawResponse?: any;
  error?: string;
}

interface SignedUrlInfo {
  httpStatus?: number;
  requestUrl?: string;
  urlReturned?: string;
  error?: string;
}

interface SendInfo {
  httpStatus?: number;
  providerAck?: any;
  error?: string;
}

interface SendResponse {
  ok: boolean;
  upload?: UploadInfo;
  signedUrl?: SignedUrlInfo;
  send?: SendInfo;
  correlationId: string;
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

    response.send = {
      httpStatus: sendResponse.status,
      providerAck: sendResponse.data,
    };

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
 * Enviar mensagem com PDF anexado - FIX DEFINITIVO
 */
router.post('/send-real-with-pdf', async (req, res) => {
  const { ticketId, pdfUrlExterna, fileName, mediaType, correlationId } = req.body as SendRealWithPdfRequest;
  const response: SendResponse = {
    ok: false,
    correlationId,
    logs: [],
    upload: {},
    signedUrl: {},
    send: {},
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

    // 1. Criar PDF de teste
    let pdfBuffer: Buffer;
    if (pdfUrlExterna) {
      response.logs.push(`[send-real-with-pdf] Downloading PDF from ${pdfUrlExterna}`);
      const pdfResponse = await axios.get(pdfUrlExterna, { responseType: 'arraybuffer' });
      pdfBuffer = Buffer.from(pdfResponse.data);
    } else {
      response.logs.push('[send-real-with-pdf] Creating test PDF > 5KB');
      pdfBuffer = generateLargePdf();
    }

    response.logs.push(`[send-real-with-pdf] PDF size: ${pdfBuffer.length} bytes`);

    // 2. PASSO A - Upload PDF para storage interno
    response.logs.push('[send-real-with-pdf] PASSO A: Uploading PDF to storage');
    
    const uploadEndpoint = '/files/upload'; // Do discovery
    const fieldName = 'file';
    const boundary = '----' + Math.random().toString(36).substr(2);
    const uploadFileName = fileName || `boleto-r7-${Date.now()}.pdf`;

    let uploadBody = '';
    uploadBody += `--${boundary}\r\n`;
    uploadBody += `Content-Disposition: form-data; name="${fieldName}"; filename="${uploadFileName}"\r\n`;
    uploadBody += `Content-Type: application/pdf\r\n\r\n`;

    const uploadBuffer = Buffer.concat([
      Buffer.from(uploadBody),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    response.upload!.uploadEndpoint = uploadEndpoint;
    response.upload!.fieldName = fieldName;

    response.logs.push(`[send-real-with-pdf] Upload endpoint: ${uploadEndpoint}`);
    response.logs.push(`[send-real-with-pdf] Field name: ${fieldName}`);

    const uploadResponse = await axiosInstance.post(uploadEndpoint, uploadBuffer, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      validateStatus: () => true,
    });

    response.upload!.httpStatus = uploadResponse.status;
    response.upload!.rawResponseKeys = Object.keys(uploadResponse.data || {});
    response.upload!.rawResponse = uploadResponse.data;

    response.logs.push(`[send-real-with-pdf] Upload HTTP ${uploadResponse.status}`);
    response.logs.push(`[send-real-with-pdf] Upload response keys: ${response.upload!.rawResponseKeys!.join(', ')}`);
    response.logs.push(`[send-real-with-pdf] Upload response: ${JSON.stringify(uploadResponse.data).substring(0, 200)}`);

    if (uploadResponse.status >= 200 && uploadResponse.status < 300) {
      response.logs.push('[send-real-with-pdf] Upload successful');
    } else {
      response.upload!.error = `Upload failed with HTTP ${uploadResponse.status}`;
      response.logs.push(`[send-real-with-pdf] Upload failed`);
      response.error = 'Upload failed';
      return res.json(response);
    }

    // PASSO D - Validar se upload endpoint é "real"
    const uploadData = uploadResponse.data || {};
    if (Object.keys(uploadData).length === 0 || (uploadData.status && uploadData.version && !uploadData.filename && !uploadData.key)) {
      response.upload!.error = 'UPLOAD_ENDPOINT_NOT_REAL: Response looks like healthcheck, not upload';
      response.logs.push('[send-real-with-pdf] PASSO D: Upload endpoint is NOT real (healthcheck response)');
      response.error = 'Upload endpoint is not real';
      return res.json(response);
    }

    // PASSO B - Extrair storedFileName REAL da resposta
    let storedFileName: string | null = null;

    // Tentativas (em ordem)
    if (uploadData.fileName) storedFileName = uploadData.fileName;
    else if (uploadData.filename) storedFileName = uploadData.filename;
    else if (uploadData.name) storedFileName = uploadData.name;
    else if (uploadData.key) storedFileName = uploadData.key;
    else if (uploadData.path) storedFileName = uploadData.path;
    else if (uploadData.url && typeof uploadData.url === 'string') {
      // Extrair filename do path /storage/file/...
      const match = uploadData.url.match(/\/storage\/file\/([^?]+)/);
      if (match) storedFileName = match[1];
    }

    if (!storedFileName) {
      response.upload!.error = 'UPLOAD_NO_FILENAME: Could not extract filename from upload response';
      response.logs.push('[send-real-with-pdf] PASSO B: No filename found in upload response');
      response.error = 'Upload response missing filename';
      return res.status(502).json(response);
    }

    response.upload!.storedFileName = storedFileName;
    response.logs.push(`[send-real-with-pdf] PASSO B: Extracted storedFileName: ${storedFileName}`);

    // PASSO C - Chamar signedUrl com filename REAL (URL-encoded)
    response.logs.push('[send-real-with-pdf] PASSO C: Getting signed URL');
    
    const encodedFileName = encodeURIComponent(storedFileName);
    const signedUrlEndpoint = `/storage/signedUrl/${encodedFileName}?expiresInSeconds=900`;
    
    response.signedUrl!.requestUrl = signedUrlEndpoint;
    response.logs.push(`[send-real-with-pdf] SignedUrl request: ${signedUrlEndpoint}`);

    const signedUrlResponse = await axiosInstance.get(signedUrlEndpoint, {
      validateStatus: () => true,
    });

    response.signedUrl!.httpStatus = signedUrlResponse.status;
    response.logs.push(`[send-real-with-pdf] SignedUrl HTTP ${signedUrlResponse.status}`);

    if (signedUrlResponse.status >= 200 && signedUrlResponse.status < 300) {
      response.signedUrl!.urlReturned = signedUrlResponse.data?.url;
      response.logs.push(`[send-real-with-pdf] SignedUrl obtained`);
      
      if (!response.signedUrl!.urlReturned) {
        response.signedUrl!.error = 'SignedUrl response missing url field';
        response.logs.push('[send-real-with-pdf] SignedUrl response missing url field');
        response.error = 'SignedUrl response invalid';
        return res.json(response);
      }
    } else {
      response.signedUrl!.error = `SignedUrl failed with HTTP ${signedUrlResponse.status}`;
      response.logs.push(`[send-real-with-pdf] SignedUrl failed: ${JSON.stringify(signedUrlResponse.data).substring(0, 200)}`);
      response.error = 'SignedUrl failed';
      return res.json(response);
    }

    // Enviar mensagem com anexo
    response.logs.push(`[send-real-with-pdf] Sending message with attachment to ticket ${ticketId}`);
    
    const messagePayload = {
      read: true,
      fromMe: true,
      mediaUrl: response.signedUrl!.urlReturned,
      mediaType: mediaType || 'application/pdf',
      fileName: uploadFileName,
      body: `R7 - Segue boleto em anexo.\n${correlationId}`,
      quotedMsg: null,
    };

    const sendResponse = await axiosInstance.post(`/messages/${ticketId}`, messagePayload, {
      validateStatus: () => true,
    });

    response.send!.httpStatus = sendResponse.status;
    response.send!.providerAck = sendResponse.data;

    if (sendResponse.status >= 200 && sendResponse.status < 300) {
      response.ok = true;
      response.logs.push(`[send-real-with-pdf] Message sent with HTTP ${sendResponse.status}`);
    } else {
      response.send!.error = `HTTP ${sendResponse.status}`;
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
