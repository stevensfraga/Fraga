/**
 * Handler para envio automático de boletos
 * Detecta quando cliente pede boleto e envia via WhatsApp
 */

import axios from "axios";
import { sendWhatsAppMessage } from "./zapContabilIntegration";

interface BoletoRequest {
  clientName: string;
  clientCnpj: string;
  clientPhone: string;
  messageContent: string;
}

interface ContaAzulBoleto {
  id: string;
  numero: string;
  valor: number;
  dataVencimento: string;
  linkBoleto: string;
  pdf?: string;
}

/**
 * Palavras-chave para detectar pedido de boleto
 */
const boletoKeywords = [
  "boleto",
  "segunda via",
  "2ª via",
  "cópia do boleto",
  "qual é o boleto",
  "envia o boleto",
  "manda o boleto",
  "preciso do boleto",
  "qual boleto",
  "qual é o código",
  "código de barras",
  "código barras",
];

/**
 * Detectar se mensagem é um pedido de boleto
 */
export function detectBoletoRequest(messageContent: string): boolean {
  const lowerMessage = messageContent.toLowerCase();
  return boletoKeywords.some((keyword) => lowerMessage.includes(keyword));
}

/**
 * Buscar boleto do Conta Azul
 */
async function fetchBoletoFromContaAzul(
  clientCnpj: string
): Promise<ContaAzulBoleto | null> {
  try {
    const apiUrl = process.env.CONTA_AZUL_API_URL || "https://api.contaazul.com";
    const token = process.env.CONTA_AZUL_API_TOKEN;

    if (!token) {
      console.error("[Boleto] Token do Conta Azul não configurado");
      return null;
    }

    // Buscar contas a receber do cliente
    const response = await axios.get(
      `${apiUrl}/v1/contas-receber`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        params: {
          filtro: {
            cliente: clientCnpj,
            status: "aberto", // Apenas boletos abertos
          },
        },
        timeout: 10000,
      }
    );

    const boletos = response.data.data || [];

    if (boletos.length === 0) {
      console.log(`[Boleto] Nenhum boleto aberto encontrado para ${clientCnpj}`);
      return null;
    }

    // Retornar o boleto mais antigo (primeiro a vencer)
    const boleto = boletos[0];

    return {
      id: boleto.id,
      numero: boleto.numero,
      valor: boleto.valor,
      dataVencimento: boleto.dataVencimento,
      linkBoleto: boleto.linkBoleto || `${apiUrl}/boleto/${boleto.id}`,
      pdf: boleto.pdf,
    };
  } catch (error) {
    console.error("[Boleto] Erro ao buscar boleto do Conta Azul:", error);
    return null;
  }
}

/**
 * Enviar boleto via WhatsApp
 */
export async function sendBoletoViaWhatsApp(request: BoletoRequest): Promise<boolean> {
  try {
    console.log(`[Boleto] Processando pedido de boleto de ${request.clientName}`);

    // Detectar se é pedido de boleto
    if (!detectBoletoRequest(request.messageContent)) {
      console.log("[Boleto] Mensagem não é um pedido de boleto");
      return false;
    }

    // Buscar boleto do Conta Azul
    const boleto = await fetchBoletoFromContaAzul(request.clientCnpj);

    if (!boleto) {
      console.log("[Boleto] Boleto não encontrado");
      // Enviar mensagem informando que não há boleto aberto
      await sendWhatsAppMessage({
        phone: request.clientPhone,
        message: `Olá ${request.clientName}! 👋\n\nVerifiquei e não encontrei boletos em aberto em nossa base. Caso tenha dúvidas, entre em contato conosco.\n\nObrigado!`,
        clientName: request.clientName,
        clientId: request.clientCnpj,
      });
      return false;
    }

    // Formatar valor
    const valorFormatado = boleto.valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    // Preparar mensagem com boleto
    const mensagem = `Olá ${request.clientName}! 👋\n\nSegue o boleto solicitado:\n\n💰 Valor: ${valorFormatado}\n📅 Vencimento: ${boleto.dataVencimento}\n📌 Número: ${boleto.numero}\n\n🔗 Link do boleto:\n${boleto.linkBoleto}\n\nVocê pode clicar no link acima para visualizar ou baixar o boleto em PDF.\n\nQualquer dúvida, estou à disposição!\n\nObrigado!`;

    // Enviar mensagem via WhatsApp
    const result = await sendWhatsAppMessage({
      phone: request.clientPhone,
      message: mensagem,
      clientName: request.clientName,
      clientId: request.clientCnpj,
    });

    if (result.success) {
      console.log(
        `[Boleto] Boleto enviado com sucesso para ${request.clientName}`
      );
      return true;
    } else {
      console.error(`[Boleto] Erro ao enviar boleto: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error("[Boleto] Erro ao processar pedido de boleto:", error);
    return false;
  }
}

/**
 * Processar boleto a partir do webhook
 */
export async function processBoletoFromWebhook(payload: any): Promise<boolean> {
  try {
    const message = payload.message;
    const clientName = message.contact?.name || "Cliente";
    const clientPhone = message.contact?.number || message.from;

    // TODO: Buscar CNPJ do cliente no banco de dados
    // Por enquanto, usar um valor padrão
    const clientCnpj = "21918918000194"; // R7 Geradores para teste

    return await sendBoletoViaWhatsApp({
      clientName,
      clientCnpj,
      clientPhone,
      messageContent: message.body,
    });
  } catch (error) {
    console.error("[Boleto] Erro ao processar boleto do webhook:", error);
    return false;
  }
}
