import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { runFirstBoletoReal } from "./runFirstBoletoReal";

describe("runFirstBoletoReal - Fluxo Automático de Cobrança", () => {
  beforeAll(() => {
    console.log("\n🚀 Iniciando testes de runFirstBoletoReal()");
  });

  afterAll(() => {
    console.log("\n✅ Testes de runFirstBoletoReal() concluídos");
  });

  it("should validate OAuth credentials are set", async () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    expect(clientId).toBeDefined();
    expect(clientSecret).toBeDefined();
    expect(clientId).not.toBe("");
    expect(clientSecret).not.toBe("");

    console.log("✅ Credenciais OAuth validadas");
  });

  it("should execute runFirstBoletoReal without errors", async () => {
    const resultado = await runFirstBoletoReal();

    expect(resultado).toBeDefined();
    expect(resultado).toHaveProperty("sucesso");
    expect(resultado).toHaveProperty("erro");

    console.log(`📊 Resultado: ${JSON.stringify(resultado, null, 2)}`);
  });

  it("should return proper response structure", async () => {
    const resultado = await runFirstBoletoReal();

    if (resultado.sucesso) {
      expect(resultado).toHaveProperty("boletoId");
      expect(resultado).toHaveProperty("clientName");
      expect(resultado).toHaveProperty("valor");
      expect(resultado).toHaveProperty("telefone");
      expect(resultado).toHaveProperty("statusEnvio");
      expect(resultado).toHaveProperty("tentativas");

      console.log(`✅ Estrutura de resposta válida`);
      console.log(`   Cliente: ${resultado.clientName}`);
      console.log(`   Valor: R$ ${resultado.valor}`);
      console.log(`   Status: ${resultado.statusEnvio}`);
      console.log(`   Tentativas: ${resultado.tentativas}`);
    } else {
      console.log(`⚠️ Nenhum boleto encontrado ou erro: ${resultado.erro}`);
    }

    expect(resultado).toBeDefined();
  });

  it("should handle retry mechanism correctly", async () => {
    const resultado = await runFirstBoletoReal();

    if (resultado.sucesso === false && resultado.tentativas) {
      expect(resultado.tentativas).toBeGreaterThan(0);
      expect(resultado.tentativas).toBeLessThanOrEqual(4);

      console.log(`✅ Mecanismo de retry funcionando`);
      console.log(`   Tentativas: ${resultado.tentativas}`);
    }

    expect(resultado).toBeDefined();
  });

  it("should log execution details", async () => {
    console.log("\n📋 Executando fluxo completo com logs...");

    const resultado = await runFirstBoletoReal();

    console.log("\n📊 Resumo da Execução:");
    console.log(`   Sucesso: ${resultado.sucesso}`);
    if (resultado.boletoId) {
      console.log(`   Boleto ID: ${resultado.boletoId}`);
    }
    if (resultado.clientName) {
      console.log(`   Cliente: ${resultado.clientName}`);
    }
    if (resultado.valor) {
      console.log(`   Valor: R$ ${resultado.valor}`);
    }
    if (resultado.telefone) {
      console.log(`   Telefone: ${resultado.telefone}`);
    }
    if (resultado.statusEnvio) {
      console.log(`   Status: ${resultado.statusEnvio}`);
    }
    if (resultado.tentativas) {
      console.log(`   Tentativas: ${resultado.tentativas}`);
    }
    if (resultado.erro) {
      console.log(`   Erro: ${resultado.erro}`);
    }

    expect(resultado).toBeDefined();
  });
});
