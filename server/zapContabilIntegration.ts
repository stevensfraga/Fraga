import axios from "axios";
import { isBusinessHours, formatNextSendTime } from "./businessHoursValidator";

/**
 * Integração com ZapContábil para envio de mensagens WhatsApp
 * API: https://api-fraga.zapcontabil.chat
 * Documentação: https://api-fraga.zapcontabil.chat/api-docs/
 * ⚠️ RESTRIÇÃO: Apenas envia mensagens entre 8h-18h, segunda a sexta
 */

const ZAP_API_URL = "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.WHATSAPP_API_KEY || "";

interface SendMessageParams {
  phone: string;
  message: string;
  clientName: string;
  clientId: string;
  forceSend?: boolean; // Ignora sentimento, régua e agendamento
}

interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
  postponed?: boolean;
  nextSendTime?: string;
}

/**
 * Enviar mensagem via ZapContábil
 * Verifica horário comercial antes de enviar
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<SendMessageResponse> {
  try {
    // Validar horário comercial (a menos que forceSend=true)
    const now = new Date();
    if (!isBusinessHours(now) && !params.forceSend) {
      const nextTime = formatNextSendTime(now);
      console.log(`[ZapContábil] ⏰ Fora do horário comercial. ${nextTime}`);
      return {
        success: false,
        error: `Mensagem agendada. Será enviada no próximo horário comercial (8h-18h, seg-sex)`,
        timestamp: new Date(),
        postponed: true,
        nextSendTime: nextTime,
      };
    }

    if (!ZAP_API_KEY) {
      console.warn("[ZapContábil] API key não configurada");
      return {
        success: false,
        error: "API key do ZapContábil não configurada",
        timestamp: new Date(),
      };
    }

    // Formatar número para padrão internacional
    const formattedPhone = formatPhoneNumber(params.phone);

    console.log(`[ZapContábil] Enviando mensagem para ${formattedPhone}`);
    console.log(`[ZapContábil] Mensagem: ${params.message}`);

    // Endpoint correto: POST /api/send/{numeroEnviar}
    const endpoint = `${ZAP_API_URL}/api/send/${formattedPhone}`;

    const response = await axios.post(
      endpoint,
      {
        body: params.message,
        connectionFrom: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        timeout: 10000,
      }
    );

    console.log(
      `[ZapContábil] Response status: ${response.status}`,
      response.data
    );

    if (response.status === 200 || response.data.success) {
      console.log(
        `[ZapContábil] Mensagem enviada com sucesso para ${params.clientName}`
      );

      return {
        success: true,
        messageId: response.data.messageId || response.data.id || "sent",
        timestamp: new Date(),
      };
    } else {
      throw new Error(response.data.error || "Erro desconhecido");
    }
  } catch (error: any) {
    console.error(
      "[ZapContábil] Erro ao enviar mensagem:",
      error.message,
      error.response?.data
    );

    // Se for erro de DNS ou conexão, retornar erro mais específico
    if (error.code === "ENOTFOUND") {
      return {
        success: false,
        error: `Não foi possível conectar ao servidor ZapContábil (${error.hostname})`,
        timestamp: new Date(),
      };
    }

    return {
      success: false,
      error: error.message || "Falha ao enviar mensagem WhatsApp",
      timestamp: new Date(),
    };
  }
}

/**
 * Obter status de uma mensagem
 */
export async function getMessageStatus(
  messageId: string
): Promise<{ status: string; timestamp: Date }> {
  try {
    if (!ZAP_API_KEY) {
      return { status: "unknown", timestamp: new Date() };
    }

    const response = await axios.get(
      `${ZAP_API_URL}/api/messages/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
        },
        timeout: 5000,
      }
    );

    return {
      status: response.data.status || "unknown",
      timestamp: new Date(),
    };
  } catch (error) {
    console.error("[ZapContábil] Erro ao obter status:", error);
    return { status: "error", timestamp: new Date() };
  }
}

/**
 * Formatar número de telefone para padrão internacional
 */
function formatPhoneNumber(phone: string): string {
  // Remove caracteres não numéricos
  const cleaned = phone.replace(/\D/g, "");

  // Se começar com 0, remove
  let formatted = cleaned.startsWith("0") ? cleaned.slice(1) : cleaned;

  // Se não começar com 55 (Brasil), adiciona
  if (!formatted.startsWith("55")) {
    formatted = `55${formatted}`;
  }

  return formatted;
}

/**
 * Webhook para receber respostas de clientes
 */
export function handleWebhookMessage(data: any) {
  try {
    const { phone, message, messageId, timestamp, type } = data;

    console.log(`[ZapContábil Webhook] Mensagem recebida de ${phone}`);

    return {
      success: true,
      phone,
      message,
      messageId,
      timestamp,
      type,
    };
  } catch (error) {
    console.error("[ZapContábil Webhook] Erro ao processar webhook:", error);
    return { success: false, error: "Erro ao processar webhook" };
  }
}
