import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { responseAnalysisHistory, collectionMessages } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Tipos de sentimento detectados
 */
export type Sentiment = "positive" | "negative" | "neutral" | "mixed";
export type SuggestedAction =
  | "send_payment_link"
  | "schedule_call"
  | "offer_discount"
  | "escalate_to_manager"
  | "wait_and_retry"
  | "mark_as_paid"
  | "send_agreement";
export type SuggestedNextTone = "friendly" | "administrative" | "formal" | "escalate";

/**
 * Resultado da análise de sentimento
 */
export interface SentimentAnalysisResult {
  sentiment: Sentiment;
  sentimentScore: number; // 0.00 a 1.00
  sentimentExplanation: string;
  suggestedAction: SuggestedAction;
  actionConfidence: number; // 0.00 a 1.00
  suggestedNextTone: SuggestedNextTone;
  reasoning: string;
}

/**
 * Contexto do cliente para análise
 */
export interface ClientContext {
  clientName: string;
  amountOverdue: number;
  daysOverdue: number;
  previousResponses?: string[];
  messageType: "friendly" | "administrative" | "formal";
}

/**
 * Analisar sentimento de resposta do cliente usando LLM
 */
export async function analyzeSentiment(
  responseText: string,
  context: ClientContext
): Promise<SentimentAnalysisResult> {
  const systemPrompt = `Você é um especialista em análise de sentimento e cobrança de dívidas. 
Analise a resposta do cliente em português e determine:
1. O sentimento (positivo, negativo, neutro ou misto)
2. A confiança na análise (0.00 a 1.00)
3. A ação sugerida para o próximo passo
4. O tom recomendado para a próxima mensagem

Contexto do cliente:
- Nome: ${context.clientName}
- Valor em atraso: R$ ${context.amountOverdue.toFixed(2)}
- Dias em atraso: ${context.daysOverdue}
- Tipo de mensagem anterior: ${context.messageType}
${context.previousResponses ? `- Respostas anteriores: ${context.previousResponses.join("; ")}` : ""}

Responda em JSON com a seguinte estrutura:
{
  "sentiment": "positive|negative|neutral|mixed",
  "sentimentScore": 0.00-1.00,
  "sentimentExplanation": "explicação breve",
  "suggestedAction": "send_payment_link|schedule_call|offer_discount|escalate_to_manager|wait_and_retry|mark_as_paid|send_agreement",
  "actionConfidence": 0.00-1.00,
  "suggestedNextTone": "friendly|administrative|formal|escalate",
  "reasoning": "explicação do raciocínio"
}`;

  const userPrompt = `Analise esta resposta do cliente: "${responseText}"`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sentiment_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              sentiment: {
                type: "string",
                enum: ["positive", "negative", "neutral", "mixed"],
              },
              sentimentScore: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              sentimentExplanation: {
                type: "string",
              },
              suggestedAction: {
                type: "string",
                enum: [
                  "send_payment_link",
                  "schedule_call",
                  "offer_discount",
                  "escalate_to_manager",
                  "wait_and_retry",
                  "mark_as_paid",
                  "send_agreement",
                ],
              },
              actionConfidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              suggestedNextTone: {
                type: "string",
                enum: ["friendly", "administrative", "formal", "escalate"],
              },
              reasoning: {
                type: "string",
              },
            },
            required: [
              "sentiment",
              "sentimentScore",
              "sentimentExplanation",
              "suggestedAction",
              "actionConfidence",
              "suggestedNextTone",
              "reasoning",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0].message.content;
    if (!content || typeof content !== "string") {
      throw new Error("Invalid response from LLM");
    }

    const result = JSON.parse(content) as SentimentAnalysisResult;
    return result;
  } catch (error) {
    console.error("Erro ao analisar sentimento:", error);
    // Fallback para análise simples se LLM falhar
    return getSimpleSentimentAnalysis(responseText, context);
  }
}

/**
 * Análise simples de sentimento (fallback)
 */
export function getSimpleSentimentAnalysis(
  responseText: string,
  context: ClientContext
): SentimentAnalysisResult {
  const text = responseText.toLowerCase();

  // Palavras-chave para sentimentos
  const positiveKeywords = [
    "vou pagar",
    "quero pagar",
    "vou enviar",
    "já pago",
    "pagamento",
    "acordo",
    "combinado",
    "ok",
    "tudo bem",
    "sem problema",
    "pode deixar",
    "amanhã",
    "semana",
    "mês",
  ];
  const negativeKeywords = [
    "não tenho",
    "não posso",
    "não vou",
    "sem dinheiro",
    "quebrado",
    "falido",
    "não pago",
    "nunca",
    "impossível",
    "chato",
    "irritado",
  ];
  const neutralKeywords = [
    "qual",
    "quando",
    "quanto",
    "como",
    "por que",
    "informação",
    "dados",
    "detalhes",
  ];

  let sentiment: Sentiment = "neutral";
  let score = 0.5;
  let explanation = "";

  const positiveCount = positiveKeywords.filter((kw) =>
    text.includes(kw)
  ).length;
  const negativeCount = negativeKeywords.filter((kw) =>
    text.includes(kw)
  ).length;
  const neutralCount = neutralKeywords.filter((kw) =>
    text.includes(kw)
  ).length;

  // Verificar primeiro se há sentimentos mistos
  if (positiveCount > 0 && negativeCount > 0) {
    sentiment = "mixed";
    score = 0.5;
    explanation = "Cliente mostrou sentimentos mistos";
  } else if (positiveCount > negativeCount && positiveCount > 0) {
    sentiment = "positive";
    score = 0.7 + positiveCount * 0.05;
    explanation = "Cliente mostrou disposição para pagar";
  } else if (negativeCount > positiveCount && negativeCount > 0) {
    sentiment = "negative";
    score = 0.3 - negativeCount * 0.05;
    explanation = "Cliente mostrou resistência ao pagamento";
  } else if (neutralCount > 0) {
    sentiment = "neutral";
    score = 0.5;
    explanation = "Cliente fez perguntas sobre o pagamento";
  }

  // Determinar ação sugerida
  let suggestedAction: SuggestedAction = "wait_and_retry";
  let actionConfidence = 0.6;
  let suggestedNextTone: SuggestedNextTone = "friendly";

  if (sentiment === "positive") {
    suggestedAction = "send_payment_link";
    actionConfidence = 0.8;
    suggestedNextTone = "friendly";
  } else if (sentiment === "negative") {
    if (context.messageType === "friendly") {
      suggestedAction = "schedule_call";
      suggestedNextTone = "administrative";
    } else if (context.messageType === "administrative") {
      suggestedAction = "escalate_to_manager";
      suggestedNextTone = "formal";
    } else {
      suggestedAction = "escalate_to_manager";
      suggestedNextTone = "escalate";
    }
    actionConfidence = 0.7;
  } else if (sentiment === "neutral") {
    suggestedAction = "offer_discount";
    actionConfidence = 0.6;
    suggestedNextTone = "friendly";
  } else if (sentiment === "mixed") {
    if (context.messageType === "friendly") {
      suggestedAction = "offer_discount";
      suggestedNextTone = "administrative";
    } else if (context.messageType === "administrative") {
      suggestedAction = "schedule_call";
      suggestedNextTone = "formal";
    } else {
      suggestedAction = "escalate_to_manager";
      suggestedNextTone = "escalate";
    }
    actionConfidence = 0.65;
  }

  return {
    sentiment,
    sentimentScore: Math.min(1, Math.max(0, score)),
    sentimentExplanation: explanation,
    suggestedAction,
    actionConfidence,
    suggestedNextTone,
    reasoning: `Análise simples baseada em palavras-chave: ${positiveCount} positivas, ${negativeCount} negativas, ${neutralCount} neutras`,
  };
}

/**
 * Salvar análise de sentimento no banco de dados
 */
export async function saveSentimentAnalysis(
  messageId: number,
  responseText: string,
  analysis: SentimentAnalysisResult
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Atualizar a mensagem com sentimento
    await db
      .update(collectionMessages)
      .set({
        sentiment: analysis.sentiment,
        sentimentScore: analysis.sentimentScore.toString() as any,
        sentimentAnalysis: analysis.sentimentExplanation,
      })
      .where(eq(collectionMessages.id, messageId));

    // Salvar análise detalhada no histórico
    await db.insert(responseAnalysisHistory).values({
      messageId,
      responseText,
      sentiment: analysis.sentiment,
      sentimentScore: analysis.sentimentScore.toString() as any,
      sentimentExplanation: analysis.sentimentExplanation,
      suggestedAction: analysis.suggestedAction,
      actionConfidence: analysis.actionConfidence.toString() as any,
      suggestedNextTone: analysis.suggestedNextTone,
      aiModel: "gpt-4",
    });
  } catch (error) {
    console.error("Erro ao salvar análise de sentimento:", error);
    throw error;
  }
}

/**
 * Obter histórico de análises de um cliente
 */
export async function getClientSentimentHistory(clientId: number) {
  try {
    const db = await getDb();
    if (!db) return [];

    const messages = await db.select().from(collectionMessages).where(eq(collectionMessages.clientId, clientId)).orderBy(desc(collectionMessages.createdAt)).limit(100);

    return (messages as any[])
      .filter((msg: any) => msg.sentiment && msg.sentiment !== "pending")
      .map((msg: any) => ({
        id: msg.id,
        sentiment: msg.sentiment,
        score: msg.sentimentScore,
        explanation: msg.sentimentAnalysis,
        responseText: msg.responseText,
        date: msg.responseDate,
      }));
  } catch (error) {
    console.error("Erro ao obter histórico de sentimento:", error);
    return [];
  }
}

/**
 * Calcular tendência de sentimento
 */
export async function getSentimentTrend(clientId: number) {
  const history = await getClientSentimentHistory(clientId) || [];

  if (history.length === 0) {
    return null;
  }

  const sentimentCounts = {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  };

  const scores: number[] = [];

  history.forEach((item: any) => {
    if (item.sentiment && item.sentiment in sentimentCounts) {
      sentimentCounts[item.sentiment as Sentiment]++;
    }
    if (item.score) {
      scores.push(parseFloat(item.score as unknown as string));
    }
  });

  const avgScore = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b) / scores.length : 0.5;
  const sortedEntries = Object.entries(sentimentCounts).sort(
    ([, a], [, b]) => (b as number) - (a as number)
  );
  const dominantSentiment = (sortedEntries[0]?.[0] || "neutral") as Sentiment;

  return {
    dominantSentiment,
    averageScore: avgScore,
    counts: sentimentCounts,
    trend: avgScore > 0.6 ? "improving" : avgScore < 0.4 ? "declining" : "stable",
  };
}
