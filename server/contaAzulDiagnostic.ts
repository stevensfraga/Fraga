/**
 * Diagnóstico de 401 - Testar endpoints e logar erros completos
 */

import axios from "axios";
import { getValidAccessToken } from "./contaAzulOAuthManager";

/**
 * Fazer ping na API e logar erro completo
 */
export async function diagnosePingError() {
  try {
    const token = await getValidAccessToken();
    
    console.log("\n═══════════════════════════════════════════════════════════════════");
    console.log("[CA Diagnostic] Iniciando diagnóstico de 401");
    console.log("═══════════════════════════════════════════════════════════════════\n");

    // Teste 1: api-v2.contaazul.com
    console.log("[CA Diagnostic] Teste 1: api-v2.contaazul.com/v1");
    await testEndpoint(
      "https://api-v2.contaazul.com/v1/customers?limit=1",
      token,
      "api-v2"
    );

    // Teste 2: api.contaazul.com
    console.log("\n[CA Diagnostic] Teste 2: api.contaazul.com/v1");
    await testEndpoint(
      "https://api.contaazul.com/v1/customers?limit=1",
      token,
      "api"
    );

    console.log("\n═══════════════════════════════════════════════════════════════════");
    console.log("[CA Diagnostic] Diagnóstico concluído");
    console.log("═══════════════════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("[CA Diagnostic] Erro ao obter token:", error);
  }
}

/**
 * Testar um endpoint específico
 */
async function testEndpoint(url: string, token: string, label: string) {
  try {
    console.log(`  URL: ${url}`);
    console.log(`  Authorization header length: ${("Bearer " + token).length}`);
    console.log(`  Token length: ${token.length}`);
    console.log(`  Token (primeiros 20 chars): ${token.substring(0, 20)}...`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log(`  ✅ Status: ${response.status}`);
    console.log(`  ✅ Resposta OK - ${label} funciona!`);
  } catch (error: any) {
    console.log(`  ❌ Erro detectado:`);
    console.log(`     Status: ${error.response?.status}`);
    console.log(`     WWW-Authenticate: ${error.response?.headers?.["www-authenticate"] || "não informado"}`);
    console.log(`     Error data:`, JSON.stringify(error.response?.data, null, 2));
    
    // Análise do erro
    if (error.response?.status === 401) {
      const wwwAuth = error.response?.headers?.["www-authenticate"] || "";
      if (wwwAuth.includes("insufficient_scope")) {
        console.log(`     📌 DIAGNÓSTICO: Scopes insuficientes para a API`);
      } else if (wwwAuth.includes("invalid_token")) {
        console.log(`     📌 DIAGNÓSTICO: Token inválido para este host`);
      } else {
        console.log(`     📌 DIAGNÓSTICO: Autenticação falhou (motivo desconhecido)`);
      }
    }
  }
}

// Executar diagnóstico se chamado diretamente
if (require.main === module) {
  diagnosePingError().catch(console.error);
}
