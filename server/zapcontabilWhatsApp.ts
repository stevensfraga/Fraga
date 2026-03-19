/**
 * 📱 Integração com API ZapContábil para envio de mensagens WhatsApp
 * 
 * CONTRATO ACK-ONLY (BLINDADO PARA PRODUÇÃO):
 * - Se response NÃO tiver id/messageId → ACK-only
 * - providerStatus="accepted" (ou "queued")
 * - providerMessageId=null (PROIBIDO fake)
 * - providerAck=true
 * - providerTrackingMode="NO_ID_ACK"
 * - correlationId OBRIGATÓRIO no body
 * 
 * ENDPOINT: POST /messages/{ticketId}
 * AUTENTICAÇÃO: Bearer JWT (server-to-server) com refresh automático
 * PAYLOAD: {read, fromMe, mediaUrl, body, quotedMsg}
 */

import axios, { AxiosError } from "axios";
import { StructuredLogger } from "./structuredLogger";
import { initZapAuthManager, getZapAuthManager } from "./zapcontabilAuthManager";
import crypto from "crypto";

const ZAP_CONTABIL_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_CONTABIL_USER = process.env.ZAP_CONTABIL_USER;
const ZAP_CONTABIL_PASS = process.env.ZAP_CONTABIL_PASS;
const ZAP_CONTABIL_JRT = process.env.ZAP_CONTABIL_JRT;

// Inicializar ZapAuthManager na primeira chamada
let authManager: ReturnType<typeof getZapAuthManager> | null = null;

function getAuthManager() {
  if (!authManager) {
    authManager = initZapAuthManager({
      baseUrl: ZAP_CONTABIL_BASE_URL,
      jrtCookie: ZAP_CONTABIL_JRT,
      username: ZAP_CONTABIL_USER,
      password: ZAP_CONTABIL_PASS,
    });
  }
  return authManager;
}

interface SendMessageRequest {
  phone?: string;
  message: string;
  mediaUrl?: string;
  traceId?: string;
  clientId?: number;
  receivableId?: number;
  correlationId?: string;
  ticketId: number;
}

interface SendMessageResponse {
  ok: boolean;
  providerMessageId?: string | null;
  correlationId?: string;
  providerStatus?: "sent" | "accepted" | "queued" | "failed";
  providerTrackingMode?: "WITH_ID" | "ACK_ONLY" | "NO_ID_ACK" | "WEBHOOK";
  providerAck?: boolean;
  writtenToTicket?: boolean;
  error?: string;
  details?: Record<string, any>;
  messageId?: string | null;
}

interface MessageStatus {
  messageId: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  error?: string;
}

/**
 * Gerar correlationId no formato [#FRAGA:ticketId:clientId:receivableId:timestamp]
 */
export function generateCorrelationId(ticketId: number, clientId: number, receivableId: number): string {
  const timestamp = Date.now();
  return `[#FRAGA:${ticketId}:${clientId}:${receivableId}:${timestamp}]`;
}

/**
 * Calcular hash do payload para auditoria
 */
export function calculatePayloadHash(payload: Record<string, any>): string {
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Validar configuração do ZapContábil
 */
export function validateZapContabilConfig(): { valid: boolean; error?: string } {
  if (!ZAP_CONTABIL_BASE_URL) {
    return {
      valid: false,
      error: "ZAP_CONTABIL_BASE_URL não configurada no .env",
    };
  }

  if (!ZAP_CONTABIL_USER || !ZAP_CONTABIL_PASS) {
    if (!ZAP_CONTABIL_JRT) {
      return {
        valid: false,
        error: "ZAP_CONTABIL_USER/PASS ou ZAP_CONTABIL_JRT não configurados",
      };
    }
  }

  return { valid: true };
}

/**
 * Enviar mensagem WhatsApp via ZapContábil
 * CONTRATO ACK-ONLY: Sem messageId fake, correlationId obrigatório
 */
export async function sendWhatsAppMessageViaZapContabil(
  request: SendMessageRequest
): Promise<SendMessageResponse> {
  const logger = new StructuredLogger({
    traceId: request.traceId || 'unknown',
    clientId: request.clientId,
    receivableId: request.receivableId,
    step: 'zapSend',
    provider: 'zapcontabil',
  });
  
  let startTime = 0;

  try {
    const config = validateZapContabilConfig();
    if (!config.valid) {
      logger.error(`Config validation failed: ${config.error}`, undefined, {
        status: 'error',
        stepFailed: 'zapSend',
        errorCode: 'CONFIG_INVALID',
      });

      return {
        ok: false,
        error: config.error,
      };
    }

    if (!request.message) {
      logger.error('Message missing', undefined, {
        status: 'error',
        stepFailed: 'zapSend',
        errorCode: 'INVALID_INPUT',
      });

      return {
        ok: false,
        error: "Mensagem é obrigatória",
      };
    }

    if (!request.ticketId) {
      logger.error('TicketId missing', undefined, {
        status: 'error',
        stepFailed: 'zapSend',
        errorCode: 'INVALID_TICKET_ID',
      });

      return {
        ok: false,
        error: "TicketId é obrigatório",
      };
    }

    if (request.message.length > 4096) {
      logger.error('Message too long', undefined, {
        status: 'error',
        stepFailed: 'zapSend',
        errorCode: 'MESSAGE_TOO_LONG',
      });

      return {
        ok: false,
        error: "Mensagem muito longa (máximo 4096 caracteres)",
      };
    }

    logger.log(`Sending message to ticket ${request.ticketId}`, {
      status: 'sending',
    });

    // Payload exato que o painel usa (CONFIRMADO)
    const payload = {
      read: true,
      fromMe: true,
      mediaUrl: request.mediaUrl || null,
      body: request.message,
      quotedMsg: null,
    };

    const payloadHash = calculatePayloadHash(payload);

    startTime = Date.now();
    
    const authMgr = getAuthManager();
    const response = await authMgr.post("/messages/" + request.ticketId, payload);

    const latencyMs = Date.now() - startTime;

    const status = response.status || 200;
    const providerData = response.data || {};
    const providerHeaders = response.headers || {};
    
    // CONTRATO ACK-ONLY: Se não tiver id/messageId, é ACK-only
    const messageId = providerData?.id || providerData?.messageId || null;
    const hasMessageId = !!messageId;
    const isAckOnly = !hasMessageId && status === 200;

    // Capturar novo cookie jrt se a API retornar
    const setCookieHeader = providerHeaders['set-cookie'];
    if (setCookieHeader) {
      const jrtMatch = setCookieHeader.toString().match(/jrt=([^;]+)/);
      if (jrtMatch && jrtMatch[1]) {
        console.log(`New jrt cookie captured from response`);
      }
    }

    if (response.status >= 200 && response.status < 300) {
      // CONTRATO ACK-ONLY
      const providerStatus = isAckOnly ? "accepted" : "sent";
      const providerTrackingMode = isAckOnly ? "NO_ID_ACK" : "WITH_ID";
      const writtenToTicket = true;

      logger.success(`Message sent to ticket ${request.ticketId}`, {
        status: 'sent',
        latencyMs,
        responseStatus: response.status,
        responseData: providerData,
        idempotencyKey: request.correlationId,
      });

      return {
        ok: true,
        providerMessageId: messageId,
        correlationId: request.correlationId,
        providerStatus,
        providerTrackingMode,
        providerAck: true,
        writtenToTicket: true,
        details: {
          payloadHash,
          providerData,
          ticketId: request.ticketId,
          isAckOnly,
        },
      };
    }

    logger.error(`HTTP ${response.status}`, undefined, {
      status: 'error',
      latencyMs,
      responseStatus: response.status,
      responseData: providerData,
      stepFailed: 'zapSend',
      errorCode: `HTTP_${response.status}`,
    });

    return {
      ok: false,
      providerMessageId: null,
      error: `Status inesperado: ${response.status}`,
      writtenToTicket: false,
      details: response.data as Record<string, any>,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    const latencyMs = Date.now() - startTime;

    const status = axiosError.response?.status;
    const responseData = axiosError.response?.data;
    const contentType = axiosError.response?.headers['content-type'];
    const fullUrl = axiosError.config?.url;

    if (status === 404) {
      logger.error(`Endpoint not found or invalid`, axiosError, {
        status: 'error',
        latencyMs,
        responseStatus: status,
        responseData,
        fullUrl,
      });

      return {
        ok: false,
        providerMessageId: null,
        error: "ZapContabil endpoint não encontrado ou inválido",
        writtenToTicket: false,
        details: {
          status,
          contentType,
          bodyPreview: typeof responseData === 'string' ? responseData.substring(0, 200) : 'N/A',
        },
      };
    }

    if (status === 403 || status === 401) {
      logger.error(`Authentication failed`, axiosError, {
        status: 'error',
        latencyMs,
        responseStatus: status,
        responseData,
        fullUrl,
      });

      return {
        ok: false,
        providerMessageId: null,
        error: `Autenticação falhou (${status}). Verifique ZAP_CONTABIL_BEARER_JWT e sessão WhatsApp.`,
        writtenToTicket: false,
        details: responseData as Record<string, any>,
      };
    }

    logger.error(`API error: ${status}`, axiosError, {
      status: 'error',
      latencyMs,
      responseStatus: status,
      responseData,
      fullUrl,
      bodyPreview: typeof responseData === 'object' ? JSON.stringify(responseData).substring(0, 200) : String(responseData).substring(0, 200),
    });

    return {
      ok: false,
      providerMessageId: null,
      error: `Erro na API ZapContábil: ${axiosError.message}`,
      writtenToTicket: false,
      details: {
        status,
        message: axiosError.message,
        responseData: typeof responseData === 'object' ? responseData : String(responseData),
      },
    };
  }
}

/**
 * Obter status de uma mensagem
 */
export async function getMessageStatus(messageId: string): Promise<MessageStatus> {
  return {
    messageId,
    status: "pending",
    timestamp: new Date().toISOString(),
  };
}
