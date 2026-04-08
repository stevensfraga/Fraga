/**
 * ENVIO REAL R7 COM PDF - SEQUÊNCIA COMPLETA
 * POST /api/test/r7/send-real
 * 
 * 1. Login programático
 * 2. Warm-up com GET /tickets
 * 3. POST /messages/{ticketId} com PDF + correlationId
 * 4. Auditoria no DB
 */

import { Router, Request, Response } from 'express';
import axios, { AxiosInstance } from 'axios';
import { getDb } from './db';
import { whatsappAudit } from '../drizzle/schema';
import crypto from 'crypto';

const router = Router();

// Criar instância axios com jar de cookies
const createAxiosWithCookies = () => {
  const jar: { [key: string]: string } = {};
  
  const instance = axios.create({
    withCredentials: true,
    validateStatus: () => true,
  });

  // Interceptor para capturar Set-Cookie
  instance.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      cookies.forEach((cookie) => {
        const [nameValue] = cookie.split(';');
        const [name, value] = nameValue.split('=');
        if (name && value) {
          jar[name.trim()] = value.trim();
        }
      });
    }
    return response;
  });

  // Interceptor para enviar cookies
  instance.interceptors.request.use((config) => {
    const cookieString = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieString) {
      config.headers.Cookie = cookieString;
    }
    return config;
  });

  return instance;
};

router.post('/r7/send-real', async (req: Request, res: Response) => {
  const { ticketId, clientId, receivableId, pdfPublicUrl, correlationId } = req.body;
  const logs: string[] = [];
  const startTime = Date.now();

  try {
    logs.push(`🚀 Iniciando envio real: ticketId=${ticketId}, receivableId=${receivableId}`);

    // Validar inputs
    if (!ticketId || !clientId || !receivableId || !pdfPublicUrl || !correlationId) {
      logs.push('❌ Parâmetros obrigatórios faltando');
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PARAMS',
        logs,
      });
    }

    // Obter credenciais
    const user = process.env.ZAP_CONTABIL_USER;
    const pass = process.env.ZAP_CONTABIL_PASS;

    if (!user || !pass) {
      logs.push('❌ Credenciais não configuradas');
      return res.status(401).json({
        ok: false,
        error: 'MISSING_CREDENTIALS',
        logs,
      });
    }

    // Criar axios com gerenciamento de cookies
    const axiosInstance = createAxiosWithCookies();
    const baseUrl = 'https://fraga.zapcontabil.chat';

    // STEP 1: Login na API (não no front)
    logs.push('🔐 Step 1: Login programático (API)...');
    const apiBaseUrl = 'https://api-fraga.zapcontabil.chat';
    const loginResponse = await axiosInstance.post(`${apiBaseUrl}/auth/login`, {
      email: user,
      password: pass,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
    });

    if (loginResponse.status !== 200) {
      logs.push(`❌ Login falhou: ${loginResponse.status}`);
      return res.status(401).json({
        ok: false,
        error: 'LOGIN_FAILED',
        httpStatus: loginResponse.status,
        logs,
      });
    }

    // Extrair Bearer Token
    const bearerToken = loginResponse.data?.token;
    if (!bearerToken) {
      logs.push('❌ Token não retornado no login');
      return res.status(401).json({
        ok: false,
        error: 'NO_TOKEN_RETURNED',
        logs,
      });
    }

    logs.push(`✅ Login OK, token: ${bearerToken.substring(0, 20)}...`);

    // STEP 2: Warm-up com GET /tickets (API)
    logs.push('🔄 Step 2: Warm-up /tickets (API)...');
    const warmupResponse = await axiosInstance.get(`${apiBaseUrl}/tickets?pageNumber=1&pageSize=10`, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });

    if (warmupResponse.status !== 200) {
      logs.push(`⚠️ Warm-up retornou ${warmupResponse.status}, continuando...`);
    } else {
      logs.push('✅ Warm-up OK');
    }

    // STEP 3: Preparar payload com mediaType e fileName
    const body = `Cobrança R7 - boleto em anexo.\n${correlationId}`;
    const payload = {
      read: true,
      fromMe: true,
      mediaUrl: pdfPublicUrl,
      mediaType: 'application/pdf',
      fileName: `boleto-r7-${receivableId}.pdf`,
      body,
      quotedMsg: null,
    };

    logs.push('📤 Step 3: Preparando payload...');

    // STEP 4: POST /messages/{ticketId} (API com Bearer Token)
    logs.push(`📡 Enviando POST /messages/${ticketId} (API)...`);
    const sendResponse = await axiosInstance.post(`${apiBaseUrl}/messages/${ticketId}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });

    const httpStatus = sendResponse.status;
    const responseData = sendResponse.data || {};

    logs.push(`📨 Response HTTP: ${httpStatus}`);
    logs.push(`📨 Response data: ${JSON.stringify(responseData).substring(0, 200)}`);

    // Determinar ACK
    const providerAck = httpStatus >= 200 && httpStatus < 300;
    const providerMessageId = responseData?.id || null;
    const providerTrackingMode = providerMessageId ? 'WITH_ID' : 'NO_ID_ACK';

    logs.push(`✅ providerAck=${providerAck}, trackingMode=${providerTrackingMode}`);

    // Calcular hash do payload
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    // STEP 5: Salvar auditoria
    logs.push('💾 Salvando auditoria...');
    const db = await getDb();
    if (!db) throw new Error('DB not available');

    const auditResult = await db.insert(whatsappAudit).values({
      clientId,
      receivableId,
      correlationId,
      pdfUrl: pdfPublicUrl,
      providerTrackingMode: providerTrackingMode as any,
      providerAck,
      messageId: providerMessageId,
      sentAt: new Date(),
      status: providerAck ? 'sent' : 'failed',
      phoneNumber: null,
      messageContent: body,
      payloadHash,
    });

    const auditId = (auditResult as any).insertId || (auditResult as any)[0]?.id || null;
    logs.push(`✅ Auditoria salva: auditId=${auditId}`);

    const latency = Date.now() - startTime;

    // STEP 6: Retornar prova completa
    return res.json({
      ok: providerAck,
      httpStatus,
      ticketId,
      clientId,
      receivableId,
      pdfPublicUrl,
      correlationId,
      providerAck,
      providerMessageId,
      providerTrackingMode,
      auditId,
      latencyMs: latency,
      providerResponse: responseData,
      logs,
    });
  } catch (err: any) {
    logs.push(`❌ Erro: ${err.message}`);
    const latency = Date.now() - startTime;
    return res.status(500).json({
      ok: false,
      error: 'SEND_FAILED',
      message: err.message,
      latencyMs: latency,
      logs,
    });
  }
});

export default router;
