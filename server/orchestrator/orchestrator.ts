/**
 * ORQUESTRADOR CLAUDE ↔ DEEPSEEK
 * Coordenação automática inteligente de LLMs
 */

import Anthropic from "@anthropic-ai/sdk";
import { OrchestratorRequest, OrchestratorResponse, ModelDecision } from "./types";

const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Cache em memória para respostas
const responseCache = new Map<string, OrchestratorResponse>();
const CACHE_TTL = 3600000; // 1 hora

/**
 * FASE 1: Claude analisa a requisição e decide se precisa DeepSeek
 */
async function analyzeAndDecideModel(query: string): Promise<ModelDecision> {
  const response = await claude.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 300,
    system: `Você é um gerenciador inteligente de modelos de IA. Analise a pergunta e decida:
    
    Retorne APENAS um JSON:
    {
      "useDeepSeek": boolean,
      "reason": "explicação breve",
      "confidence": número entre 0 e 1
    }
    
    Use DeepSeek (R1 reasoning) se:
    - Requer análise profunda ou raciocínio complexo
    - Envolve matemática ou lógica
    - Precisa decomposição de problemas
    - Análise de dados complexos`,
    messages: [{ role: "user", content: query }],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";
  return JSON.parse(content);
}

/**
 * FASE 2: Claude chama DeepSeek se necessário
 */
async function callDeepSeek(query: string): Promise<string> {
  // Aqui você integraria com a API do DeepSeek
  // Por enquanto, retornamos um placeholder
  console.log("[DEEPSEEK] Processando:", query);

  // Simulação de call ao DeepSeek R1
  return `[DeepSeek R1 Response] Análise profunda de: ${query}`;
}

/**
 * FASE 3: Claude compila a resposta final
 */
async function compileResponse(
  originalQuery: string,
  claudeAnalysis: string,
  deepseekAnalysis?: string
): Promise<string> {
  const context = deepseekAnalysis
    ? `Claude Analysis: ${claudeAnalysis}\n\nDeepSeek R1 Analysis: ${deepseekAnalysis}`
    : claudeAnalysis;

  const response = await claude.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    system:
      "Você é um sintetizador de respostas. Combine as análises e apresente uma resposta clara e estruturada.",
    messages: [
      {
        role: "user",
        content: `Pergunta original: ${originalQuery}\n\nMateriais para síntese:\n${context}`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

/**
 * ORQUESTRADOR PRINCIPAL
 */
export async function orchestrate(
  request: OrchestratorRequest
): Promise<OrchestratorResponse> {
  const startTime = Date.now();
  const cacheKey = `${request.query}:${JSON.stringify(request.context || {})}`;

  // Verificar cache
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.metadata.totalTime < CACHE_TTL) {
    console.log("[CACHE HIT]", cacheKey);
    return cached;
  }

  const usedModels: string[] = ["claude"];
  let deepseekResponse: string | undefined;
  let claudeTime = 0;
  let deepseekTime = 0;

  try {
    // FASE 1: Claude decide
    console.log("[ORQUESTRADOR] Analisando requisição...");
    const decision = await analyzeAndDecideModel(request.query);
    console.log("[DECISÃO]", decision);

    // FASE 2: Executar Claude
    const claudeStart = Date.now();
    const claudeResponse = await claude.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 800,
      messages: [{ role: "user", content: request.query }],
    });
    claudeTime = Date.now() - claudeStart;

    const claudeAnalysis =
      claudeResponse.content[0].type === "text"
        ? claudeResponse.content[0].text
        : "";

    // FASE 2B: Chamar DeepSeek se necessário
    if (decision.useDeepSeek && decision.confidence > 0.7) {
      usedModels.push("deepseek-r1");
      console.log("[ORQUESTRADOR] Escalando para DeepSeek...");
      const deepseekStart = Date.now();
      deepseekResponse = await callDeepSeek(request.query);
      deepseekTime = Date.now() - deepseekStart;
    }

    // FASE 3: Compilar resposta final
    console.log("[ORQUESTRADOR] Compilando resposta final...");
    const finalAnswer = await compileResponse(
      request.query,
      claudeAnalysis,
      deepseekResponse
    );

    const totalTime = Date.now() - startTime;

    const response: OrchestratorResponse = {
      answer: finalAnswer,
      usedModels,
      reasoning: decision.reason,
      metadata: {
        totalTime,
        claudeTime,
        deepseekTime: deepseekTime || undefined,
        fallbackUsed: false,
      },
    };

    // Cachear resposta
    responseCache.set(cacheKey, response);

    return response;
  } catch (error) {
    console.error("[ORQUESTRADOR ERROR]", error);

    // Fallback: apenas Claude
    const fallbackResponse = await claude.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 800,
      messages: [{ role: "user", content: request.query }],
    });

    return {
      answer:
        fallbackResponse.content[0].type === "text"
          ? fallbackResponse.content[0].text
          : "Erro ao processar",
      usedModels: ["claude"],
      reasoning: "Fallback mode - erro na orquestração",
      metadata: {
        totalTime: Date.now() - startTime,
        fallbackUsed: true,
      },
    };
  }
}

export function clearCache(): void {
  responseCache.clear();
  console.log("[CACHE] Limpo");
}

export function getCacheStats() {
  return {
    size: responseCache.size,
    entries: Array.from(responseCache.entries()).map(([key, value]) => ({
      key,
      totalTime: value.metadata.totalTime,
    })),
  };
}
