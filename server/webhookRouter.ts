/**
 * Router para webhooks do Zap Contábil
 * Recebe mensagens de resposta de clientes e integra com análise de sentimento
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { analyzeSentiment, saveSentimentAnalysis } from "./sentimentAnalysis";
import { getDb } from "./db";
import { collectionMessages } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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
 * Extrair informações do cliente da mensagem
 */
function extractClientInfo(message: ZapWebhookMessage) {
  return {
    contactId: message.contactId,
    ticketId: message.ticketId,
    contactName: message.contact?.name || "Cliente Desconhecido",
    contactNumber: message.contact?.number || message.from || "",
  };
}

/**
 * Processar mensagem recebida e analisar sentimento
 */
async function processReceivedMessage(payload: any) {
  console.log("[Webhook] Payload:", payload);
  
  if (!payload || !payload.message) {
    console.error("[Webhook] Payload inválido:", payload);
    throw new Error("Payload inválido: message não encontrada");
  }
  
  const message = payload.message as ZapWebhookMessage;

  // Ignorar mensagens enviadas por nós
  if (message.myContact || message.fromMe) {
    console.log("[Webhook] Ignorando mensagem enviada por nós");
    return;
  }

  // Ignorar mensagens de mídia por enquanto
  if (message.isMedia) {
    console.log("[Webhook] Ignorando mensagem de mídia");
    return;
  }

  const clientInfo = extractClientInfo(message);

  console.log(`[Webhook] Mensagem recebida de ${clientInfo.contactName}`);
  console.log(`[Webhook] Conteúdo: ${message.body}`);

  try {
    // Analisar sentimento da resposta
    const analysis = await analyzeSentiment(message.body, {
      clientName: clientInfo.contactName,
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
      // Procurar mensagem anterior para atualizar
      // TODO: Implementar busca por ticketId quando campo for adicionado ao schema
      const previousMessages: any[] = [];

      if (previousMessages.length > 0) {
        // Atualizar mensagem anterior com análise
        await db
          .update(collectionMessages)
          .set({
            sentiment: analysis.sentiment,
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
      }
    }

    return {
      success: true,
      analysis,
      clientInfo,
    };
  } catch (error) {
    console.error("[Webhook] Erro ao processar mensagem:", error);
    throw error;
  }
}

export const webhookRouter = router({
  /**
   * Endpoint para receber webhooks do Zap Contábil
   * POST /api/trpc/webhook.receiveMessage
   */
  receiveMessage: publicProcedure
    .input(z.any())
    .mutation(async ({ input }) => {
      try {
        console.log("[Webhook] Processando mensagem...");
        const result = await processReceivedMessage(input);
        return {
          success: true,
          message: "Mensagem processada com sucesso",
          data: result,
        };
      } catch (error) {
        console.error("[Webhook] Erro:", error);
        return {
          success: false,
          message: error instanceof Error ? error.message : "Erro desconhecido",
        };
      }
    }),

  /**
   * Endpoint para testar webhook (GET)
   */
  test: publicProcedure.query(() => {
    return {
      success: true,
      message: "Webhook está funcionando!",
      timestamp: new Date(),
    };
  }),

  /**
   * Endpoint para receber webhook com GET (alguns serviços usam GET)
   */
  testGet: publicProcedure
    .input((input: any) => input)
    .query(({ input }) => {
      console.log("[Webhook] GET request recebido:", input);
      return {
        success: true,
        message: "Webhook GET está funcionando!",
        receivedData: input,
      };
    }),
});
