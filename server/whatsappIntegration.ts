import axios from "axios";

interface WhatsAppMessage {
  phoneNumber: string;
  customerName: string;
  amount: number;
  dueDate: string;
  bankSlipUrl?: string;
  invoiceNumber?: string;
}

interface WhatsAppResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send collection message via WhatsApp
 */
export async function sendCollectionMessage(
  message: WhatsAppMessage
): Promise<WhatsAppResponse> {
  try {
    const apiKey = process.env.WHATSAPP_API_KEY;
    if (!apiKey) {
      console.error("[WhatsApp] API key not configured");
      return { success: false, error: "WhatsApp API key not configured" };
    }

    // Format phone number (remove special characters, ensure country code)
    const formattedPhone = formatPhoneNumber(message.phoneNumber);

    // Build message content
    const messageContent = buildCollectionMessage(message);

    // Send via WhatsApp API
    const response = await axios.post(
      "https://api.whatsapp.com/send",
      {
        phone: formattedPhone,
        message: messageContent,
        link: message.bankSlipUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    console.log(`[WhatsApp] ✅ Mensagem enviada para ${formattedPhone}`);
    return { success: true, messageId: response.data.messageId };
  } catch (error) {
    console.error("[WhatsApp] ❌ Erro ao enviar mensagem:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Format phone number for WhatsApp API
 * Expects format: +55 11 99999-9999 or similar
 */
function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // If doesn't start with country code, assume Brazil (55)
  if (!digits.startsWith("55")) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Build collection message content
 */
function buildCollectionMessage(message: WhatsAppMessage): string {
  const formattedAmount = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(message.amount);

  const formattedDate = new Date(message.dueDate).toLocaleDateString("pt-BR");

  let content = `Olá ${message.customerName}! 👋\n\n`;
  content += `Você tem uma cobrança pendente:\n\n`;
  content += `💰 Valor: ${formattedAmount}\n`;
  content += `📅 Vencimento: ${formattedDate}\n`;

  if (message.invoiceNumber) {
    content += `📄 Número: ${message.invoiceNumber}\n`;
  }

  content += `\n`;

  if (message.bankSlipUrl) {
    content += `🔗 Boleto: ${message.bankSlipUrl}\n\n`;
  }

  content += `Por favor, efetue o pagamento assim que possível.\n`;
  content += `Dúvidas? Entre em contato conosco! 📞`;

  return content;
}

/**
 * Send bulk collection messages
 */
export async function sendBulkCollectionMessages(
  messages: WhatsAppMessage[]
): Promise<WhatsAppResponse[]> {
  console.log(`[WhatsApp] Enviando ${messages.length} mensagens em lote...`);

  const results = await Promise.all(
    messages.map((msg) => sendCollectionMessage(msg))
  );

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(
    `[WhatsApp] ✅ ${successful} enviadas, ❌ ${failed} falharam`
  );

  return results;
}
