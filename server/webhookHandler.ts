/**
 * Handler para webhooks do Zap Contábil
 * Processa mensagens recebidas e analisa sentimento
 */

import { analyzeSentiment } from "./sentimentAnalysis";
import { getDb } from "./db";
import { collectionMessages } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { processBoletoFromWebhook } from "./boletoHandler";
import { processBoletoViaPlanB } from "./boletoHandlerPlanB";
import { sendWhatsAppMessage } from "./zapContabilIntegration";
// import { registerFollowUp, cancelFollowUp } from "./followUpJob";
import {
  getRandomMessage,
  juliaGreetings,
  createContextualFollowUp,
  generateNaturalDelay,
} from "./humanMessages";

interface ZapWebhookMessage {
  id: string;
  body: string;
  type: string;
  subtype: string;
  isMedia: boolean;
  myContact: boolean;
  contactId: number;
  ticketId: number;
  timestamp?: number;
  fromMe?: boolean;
  from?: string;
  to?: string;
  contact?: {
    id: number;
    name: string;
    number: string;
  };
}

interface ZapWebhookPayload {
  message: ZapWebhookMessage;
  connection?: {
    id: number;
    name: string;
  };
  event?: string;
}

/**
 * Processar mensagem recebida e analisar sentimento
 */
export async function processReceivedMessage(payload: any) {
  console.log("[Webhook] Payload recebido:", JSON.stringify(payload, null, 2));

  if (!payload || !payload.message) {
    console.error("[Webhook] Payload inválido:", payload);
    throw new Error("Payload inválido: message não encontrada");
  }

  const message = payload.message as ZapWebhookMessage;

  // Ignorar mensagens enviadas por nós
  if (message.myContact || message.fromMe) {
    console.log("[Webhook] Ignorando mensagem enviada por nós");
    return { ignored: true, reason: "Mensagem enviada por nós" };
  }

  // Ignorar mensagens de mídia por enquanto
  if (message.isMedia) {
    console.log("[Webhook] Ignorando mensagem de mídia");
    return { ignored: true, reason: "Mensagem de mídia" };
  }

  const clientName = message.contact?.name || "Cliente Desconhecido";
  const clientNumber = message.contact?.number || message.from || "";

    console.log(`[Webhook] Mensagem de ${clientName}: ${message.body}`);

  try {
    // Verificar se é opção 7 (Setor Financeiro)
    const isOption7 = message.body.trim() === "7";
    
    if (isOption7) {
      console.log("[Webhook] Cliente escolheu opção 7 - Setor Financeiro");
      try {
        // Enviar mensagem de apresentação (natural e variada)
        const greeting = getRandomMessage(juliaGreetings);
        await sendWhatsAppMessage({
          phone: clientNumber,
          message: greeting,
          clientName: clientName,
          clientId: "unknown",
        });
        
        // TODO: Implementar follow-up automático
      } catch (error) {
        console.error("[Webhook] Erro ao processar opção 7:", error);
      }
    }
    
    // TODO: Cancelar follow-up se cliente respondeu
    
    // Verificar se é pedido de boleto e processar (detector de intenção)
    const bodyLower = message.body.toLowerCase();
    const isBoletoRequest = 
      bodyLower.includes("boleto") ||
      bodyLower.includes("segunda via") ||
      bodyLower.includes("2ª via") ||
      bodyLower.includes("2a via") ||
      bodyLower.includes("código de barras") ||
      bodyLower.includes("codigo de barras") ||
      bodyLower.includes("pix") ||
      bodyLower.includes("enviar boleto") ||
      bodyLower.includes("mandar boleto") ||
      bodyLower.includes("linha digitável") ||
      bodyLower.includes("linha digitavel");
    
    if (isBoletoRequest && !isOption7) {
      console.log("[Webhook] Detectado pedido de boleto, processando via PLANO B...");
      try {
        // Usar PLANO B (endpoint E2E com PDF já existente no storage Zap)
        const planBResult = await processBoletoViaPlanB(payload);
        console.log("[Webhook] Resultado PLANO B:", planBResult);
      } catch (boletoError) {
        console.error("[Webhook] Erro ao processar boleto via PLANO B:", boletoError);
        // Fallback: tentar método antigo
        try {
          await processBoletoFromWebhook(payload);
        } catch (fallbackError) {
          console.error("[Webhook] Fallback também falhou:", fallbackError);
        }
      }
    }

    // Analisar sentimento da resposta
    const analysis = await analyzeSentiment(message.body, {
      clientName,
      amountOverdue: 240, // TODO: buscar do banco de dados
      daysOverdue: 30, // TODO: calcular do banco de dados
      messageType: "friendly", // TODO: buscar do histórico
    });

    console.log(`[Webhook] Análise: ${analysis.sentiment}`);
    console.log(`[Webhook] Score: ${analysis.sentimentScore}`);
    console.log(`[Webhook] Ação sugerida: ${analysis.suggestedAction}`);

    // Salvar análise no banco de dados
    const db = await getDb();
    if (db) {
      try {
        // Procurar mensagem anterior para atualizar
        // TODO: Implementar busca por ticketId quando campo for adicionado ao schema
        const previousMessages: any[] = [];

        if (previousMessages.length > 0) {
          // Atualizar mensagem anterior com análise
          await db
            .update(collectionMessages)
            .set({
              sentiment: analysis.sentiment as any,
              sentimentScore: analysis.sentimentScore.toString() as any,
              sentimentAnalysis: analysis.sentimentExplanation,
              responseReceived: true,
              responseText: message.body,
              responseDate: new Date(),
            })
            .where(eq(collectionMessages.id, previousMessages[0].id));

          console.log(
            `[Webhook] Análise salva na mensagem ${previousMessages[0].id}`
          );
        } else {
          // Se não houver mensagem anterior, criar uma nova com a resposta
          await db.insert(collectionMessages).values({
            cnpj: message.from || 'unknown',
            messageType: "friendly",
            messageTemplate: message.body,
            messageSent: message.body,
            whatsappMessageId: message.id,
            status: "delivered",
            sentiment: analysis.sentiment as any,
            sentimentScore: parseFloat(analysis.sentimentScore.toString()) as any,
            sentimentAnalysis: analysis.sentimentExplanation,
            responseReceived: true,
            responseText: message.body,
            responseDate: new Date(),
            outcome: "pending",
            sentAt: new Date(),
          }).catch(err => {
            console.error('[Webhook] Erro ao salvar mensagem:', err);
          });

          console.log(
            `[Webhook] Nova mensagem de resposta criada para ${clientName}`
          );
        }
      } catch (dbError) {
        console.error("[Webhook] Erro ao salvar no banco:", dbError);
        // Continuar mesmo se falhar ao salvar
      }
    }

    return {
      success: true,
      analysis,
      clientInfo: {
        name: clientName,
        number: clientNumber,
        ticketId: message.ticketId,
      },
    };
  } catch (error) {
    console.error("[Webhook] Erro ao processar mensagem:", error);
    throw error;
  }
}
