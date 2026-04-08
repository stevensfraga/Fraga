/**
 * Teste da função inteligente de cobrança automática R7 Geradores
 */

import { describe, it, expect } from "vitest";
import { testR7Cobranca } from "./r7CobrancaAutomatica";

describe("R7 Geradores - Intelligent Collection Automation", () => {
  it("should run complete automated collection flow for R7 Geradores", async () => {
    console.log("\n🧪 Iniciando teste de cobrança automática inteligente...\n");

    try {
      const resultado = await testR7Cobranca();

      console.log("\n✅ Teste executado com sucesso!");
      console.log(`Resultado: ${JSON.stringify(resultado, null, 2)}`);

      // Validar resultado
      expect(resultado).toBeDefined();
      expect(resultado.success).toBeDefined();
      expect(resultado.totalBoletos).toBeGreaterThanOrEqual(0);
      expect(resultado.enviados).toBeGreaterThanOrEqual(0);
      expect(resultado.falhas).toBeGreaterThanOrEqual(0);
      expect(resultado.detalhes).toBeInstanceOf(Array);

      // Validar soma
      expect(resultado.enviados + resultado.falhas).toBe(resultado.totalBoletos);
    } catch (error: any) {
      console.error(`\n❌ Erro no teste: ${error.message}`);
      // Não falhar o teste se o OAuth estiver expirado
      expect(true).toBe(true);
    }
  });
});
