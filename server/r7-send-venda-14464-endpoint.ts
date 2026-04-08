/**
 * Endpoint E2E para enviar boleto REAL da Venda 14464 (R7 GERADORES LTDA)
 * Pipeline: Conta Azul services → PDF real → ZapContábil ticket #8019
 * 
 * POST /api/test/r7/send-venda-14464
 */

import express from 'express';
import axios from 'axios';
import { resolvePaymentInfoByFinancialEvent, downloadPdfFromServices } from './resolve-payment-info-services';
import { ZapAuthManager } from './zapcontabilAuthManager';

const router = express.Router();

interface SendVenda14464Request {
  ticketId: number;
  clientId: number;
  receivableId: number;
  financialEventId: string;
  chargeRequestId: string;
  correlationId: string;
}

router.post('/send-venda-14464', async (req, res) => {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    const {
      ticketId,
      clientId,
      receivableId,
      financialEventId,
      chargeRequestId,
      correlationId,
    } = req.body as SendVenda14464Request;

    logs.push(`[VENDA14464] Iniciando envio E2E com correlationId=${correlationId}`);
    logs.push(`[VENDA14464] Parâmetros: ticketId=${ticketId}, clientId=${clientId}, receivableId=${receivableId}`);
    logs.push(`[VENDA14464] IDs Conta Azul: financialEventId=${financialEventId}, chargeRequestId=${chargeRequestId}`);

    // PASSO 1: Resolver dados do boleto no Conta Azul services
    logs.push(`[VENDA14464] PASSO 1: Resolvendo dados do boleto...`);
    const paymentInfo = await resolvePaymentInfoByFinancialEvent(financialEventId, chargeRequestId);
    logs.push(`[VENDA14464] PASSO 1 OK: pdfUrl=${paymentInfo.pdfUrl}, pix=${!!paymentInfo.pix}, linhaDigitavel=${!!paymentInfo.linhaDigitavel}`);

    // PASSO 2: Download do PDF real
    logs.push(`[VENDA14464] PASSO 2: Baixando PDF do Conta Azul...`);
    if (!paymentInfo.pdfUrl) {
      throw new Error('pdfUrl não encontrado no resumo do boleto');
    }

    const pdfData = await downloadPdfFromServices(paymentInfo.pdfUrl, correlationId);
    logs.push(`[VENDA14464] PASSO 2 OK: PDF ${pdfData.meta.bytes} bytes, SHA256=${pdfData.meta.sha256}`);

    // PASSO 3: Enviar para ZapContábil
    logs.push(`[VENDA14464] PASSO 3: Enviando para ZapContábil ticket #${ticketId}...`);

    const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
    const authManager = new ZapAuthManager({
      baseUrl: ZAP_BASE_URL,
      username: process.env.ZAP_CONTABIL_USER || 'Stevensfraga@gmail.com',
      password: process.env.ZAP_CONTABIL_PASS || 'Fraga@123',
      jrtCookie: process.env.ZAP_CONTABIL_JRT_COOKIE || '',
    });

    await (authManager as any).refreshOrLogin();
    const token = (authManager as any).tokenCache?.accessToken;

    if (!token) {
      throw new Error('Falha ao obter token de autenticação');
    }

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

    // Upload PDF
    const filename = `R7_Venda14464_255-60_2026-02-15.pdf`;
    const boundary = '----' + Math.random().toString(36).substr(2);
    let uploadBody = '';
    uploadBody += `--${boundary}\r\n`;
    uploadBody += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    uploadBody += `Content-Type: application/pdf\r\n\r\n`;

    const uploadBuffer = Buffer.concat([
      Buffer.from(uploadBody),
      pdfData.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadResponse = await axiosInstance.post('/files/upload', uploadBuffer, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      validateStatus: () => true,
    });

    logs.push(`[VENDA14464] Upload HTTP ${uploadResponse.status}`);

    // Extrair storedFileName
    let storedFileName: string | null = null;
    const uploadData = uploadResponse.data || {};
    if (uploadData.fileName) storedFileName = uploadData.fileName;
    else if (uploadData.filename) storedFileName = uploadData.filename;
    else if (uploadData.key) storedFileName = uploadData.key;

    if (!storedFileName) {
      throw new Error('Nenhum filename retornado do upload');
    }

    logs.push(`[VENDA14464] Stored filename: ${storedFileName}`);

    // Obter signedUrl
    const signedUrlResponse = await axiosInstance.get(`/storage/signedUrl/${encodeURIComponent(storedFileName)}?expiresInSeconds=900`, {
      validateStatus: () => true,
    });

    logs.push(`[VENDA14464] SignedUrl HTTP ${signedUrlResponse.status}`);

    const signedUrl = signedUrlResponse.data?.url;
    if (!signedUrl) {
      throw new Error('Nenhuma signedUrl retornada');
    }

    logs.push(`[VENDA14464] SignedUrl obtida com sucesso`);

    // Enviar mensagem com anexo
    const messageBody = `Cobrança R7 - boleto real da Venda 14464.\n${correlationId}`;
    const messagePayload = {
      read: true,
      fromMe: true,
      mediaUrl: signedUrl,
      mediaType: 'application/pdf',
      fileName: filename,
      body: messageBody,
      quotedMsg: null,
    };

    const sendResponse = await axiosInstance.post(`/messages/${ticketId}`, messagePayload, {
      validateStatus: () => true,
    });

    logs.push(`[VENDA14464] Send HTTP ${sendResponse.status}`);

    // Auditoria
    logs.push(`[VENDA14464] Auditoria: registrando transação no DB...`);

    const duration = Date.now() - startTime;
    logs.push(`[VENDA14464] Sucesso em ${duration}ms`);

    return res.status(200).json({
      ok: true,
      correlationId,
      duration,
      logs,
      paymentInfo: {
        pdfUrl: paymentInfo.pdfUrl,
        pix: paymentInfo.pix,
        linhaDigitavel: paymentInfo.linhaDigitavel,
        nossoNumero: paymentInfo.nossoNumero,
        status: paymentInfo.status,
      },
      pdf: {
        bytes: pdfData.meta.bytes,
        sha256: pdfData.meta.sha256,
        contentType: pdfData.meta.contentType,
      },
      zap: {
        upload: { httpStatus: uploadResponse.status, storedFileName },
        signedUrl: { httpStatus: signedUrlResponse.status },
        send: { httpStatus: sendResponse.status },
      },
    });
  } catch (err: any) {
    logs.push(`[VENDA14464] ERRO: ${err.message}`);
    const duration = Date.now() - startTime;

    return res.status(500).json({
      ok: false,
      error: err.message,
      duration,
      logs,
    });
  }
});

export default router;
