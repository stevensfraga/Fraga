import axios from "axios";

/**
 * Tipos de mensagens de cobrança
 */
export const messageTemplates = {
  friendly: {
    subject: "Cobrança Amigável (0-30 dias)",
    template: (clientName: string, amount: string, dueDate: string) => `
Oi ${clientName}! 👋

Tudo bem?

Passando só para confirmar se o boleto referente a **R$ ${amount}** (vencimento ${dueDate}) já foi programado.

Qualquer coisa me avisa! 😊

Fraga Contabilidade
    `.trim(),
  },
  administrative: {
    subject: "Cobrança Administrativa (31-90 dias)",
    template: (
      clientName: string,
      amount: string,
      months: number,
      dueDate: string
    ) => `
Olá ${clientName},

Identificamos valores em aberto referentes aos últimos ${months} mês(es):
💰 **R$ ${amount}** (vencimento ${dueDate})

Para manter os serviços ativos, precisamos regularizar essa situação.

Podemos seguir com:
✅ Pagamento integral
✅ Parcelamento em até 3x

Qual opção prefere?

Fraga Contabilidade
    `.trim(),
  },
  formal: {
    subject: "Notificação Formal (90+ dias)",
    template: (clientName: string, amount: string, deadline: string) => `
${clientName},

Conforme contrato, informamos que há débito em aberto:
💰 **R$ ${amount}**

Sem a regularização até **${deadline}**, os serviços serão suspensos conforme cláusula contratual.

Favor regularizar imediatamente.

Fraga Contabilidade
    `.trim(),
  },
};

/**
 * Interface para envio de mensagem WhatsApp
 */
export interface WhatsAppMessage {
  to: string;
  message: string;
  clientName: string;
  clientId: number;
  messageType: "friendly" | "administrative" | "formal";
}

/**
 * Enviar mensagem via WhatsApp (Zap Contábil ou similar)
 * Você precisa configurar a API do seu provedor
 */
export async function sendWhatsAppMessage(
  message: WhatsAppMessage,
  apiKey: string,
  apiUrl: string
) {
  try {
    // Exemplo para Zap Contábil ou similar
    const response = await axios.post(
      apiUrl,
      {
        phone: message.to,
        message: message.message,
        clientId: message.clientId,
        messageType: message.messageType,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

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
 * Gerar mensagem personalizada
 */
export function generateMessage(
  type: "friendly" | "administrative" | "formal",
  clientName: string,
  amount: string,
  monthsOverdue?: number,
  dueDate?: string
): string {
  if (type === "friendly") {
    return messageTemplates.friendly.template(clientName, amount, dueDate || "");
  } else if (type === "administrative") {
    return messageTemplates.administrative.template(
      clientName,
      amount,
      monthsOverdue || 1,
      dueDate || ""
    );
  } else {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 7);
    return messageTemplates.formal.template(
      clientName,
      amount,
      deadline.toLocaleDateString("pt-BR")
    );
  }
}

/**
 * Validar número de WhatsApp
 */
export function validateWhatsAppNumber(phone: string): boolean {
  // Remover caracteres não numéricos
  const cleaned = phone.replace(/\D/g, "");

  // Validar formato brasileiro (11 dígitos)
  if (cleaned.length === 11 && cleaned.startsWith("55")) {
    return true;
  }

  // Validar formato internacional
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return true;
  }

  return false;
}

/**
 * Formatar número para WhatsApp
 */
export function formatWhatsAppNumber(phone: string): string {
  // Remover caracteres não numéricos
  let cleaned = phone.replace(/\D/g, "");

  // Se não tem código de país, adicionar 55 (Brasil)
  if (!cleaned.startsWith("55")) {
    // Se tem 11 dígitos, é número brasileiro
    if (cleaned.length === 11) {
      cleaned = "55" + cleaned;
    }
  }

  return cleaned;
}
