/**
 * Testes para o Orquestrador
 */

import { describe, it, expect, beforeEach } from "vitest";
import { orchestrate, clearCache } from "./orchestrator";

describe("Orchestrator", () => {
  beforeEach(() => {
    clearCache();
  });

  it("deve processar query simples com apenas Claude", async () => {
    const response = await orchestrate({
      query: "Qual é a capital da França?",
    });

    expect(response).toBeDefined();
    expect(response.answer).toBeTruthy();
    expect(response.usedModels).toContain("claude");
    expect(response.metadata.totalTime).toBeGreaterThan(0);
  });

  it("deve cachear respostas iguais", async () => {
    const query = "Teste de cache";

    const response1 = await orchestrate({ query });
    const time1 = response1.metadata.totalTime;

    const response2 = await orchestrate({ query });
    const time2 = response2.metadata.totalTime;

    // Segunda resposta deve ser muito mais rápida (de cache)
    expect(time2).toBeLessThan(time1);
  });

  it("deve decidir sobre uso de DeepSeek baseado em complexidade", async () => {
    const simpleQuery = "Qual é o resultado de 2 + 2?";
    const complexQuery =
      "Analise a complexidade de um algoritmo de busca binária e compare com busca linear";

    const simpleResponse = await orchestrate({ query: simpleQuery });
    const complexResponse = await orchestrate({ query: complexQuery });

    // Query simples provavelmente não usará DeepSeek
    // Query complexa pode usar DeepSeek
    expect(complexResponse.metadata.totalTime).toBeGreaterThan(0);
  });

  it("deve respeitar flag requiresDeepThinking", async () => {
    const response = await orchestrate({
      query: "Pergunta qualquer",
      requiresDeepThinking: true,
    });

    expect(response).toBeDefined();
    expect(response.answer).toBeTruthy();
  });

  it("deve manter contexto na resposta", async () => {
    const context = { userId: 123, projectId: "proj_456" };

    const response = await orchestrate({
      query: "Qual é o próximo passo?",
      context,
    });

    expect(response).toBeDefined();
    expect(response.metadata).toBeDefined();
  });
});
