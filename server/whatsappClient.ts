import axios from "axios";
import { ENV } from "./_core/env";

const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "https://api.zapcontabil.com/v1"; // Ajuste conforme seu provedor

/**
 * Cliente HTTP para integração com WhatsApp
 */
export const whatsappClient = axios.create({
  baseURL: WHATSAPP_API_URL,
  headers: {
    Authorization: `Bearer ${WHATSAPP_API_KEY}`,
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

/**
 * Enviar mensagem de texto via WhatsApp
 */
export async function sendWhatsAppText(
  phoneNumber: string,
  message: string,
  clientId?: number
) {
  try {
    const response = await whatsappClient.post("/messages/text", {
      phone: phoneNumber,
      message,
      clientId,
    });

    return {
      success: true,
      messageId: response.data.messageId || response.data.id,
      status: response.data.status || "sent",
      timestamp: new Date(),
    };
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    throw error;
  }
}

/**
 * Enviar mensagem com template
 */
export async function sendWhatsAppTemplate(
  phoneNumber: string,
  templateName: string,
  parameters: Record<string, string>
) {
  try {
    const response = await whatsappClient.post("/messages/template", {
      phone: phoneNumber,
      template: templateName,
      parameters,
    });

    return {
      success: true,
      messageId: response.data.messageId || response.data.id,
      status: response.data.status || "sent",
      timestamp: new Date(),
    };
  } catch (error) {
    console.error("Error sending WhatsApp template:", error);
    throw error;
  }
}

/**
 * Buscar status de uma mensagem
 */
export async function getMessageStatus(messageId: string) {
  try {
    const response = await whatsappClient.get(`/messages/${messageId}`);

    return {
      messageId,
      status: response.data.status,
      timestamp: response.data.timestamp,
      error: response.data.error,
    };
  } catch (error) {
    console.error("Error getting message status:", error);
    throw error;
  }
}

/**
 * Validar conexão com API de WhatsApp
 */
export async function validateWhatsAppConnection() {
  try {
    const response = await whatsappClient.get("/health");
    return {
      connected: true,
      status: response.data.status,
    };
  } catch (error) {
    console.error("Error validating WhatsApp connection:", error);
    return {
      connected: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
