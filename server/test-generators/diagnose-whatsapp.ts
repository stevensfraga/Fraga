/**
 * Diagnóstico de Integração WhatsApp - ZapContábil
 * Testa conexão com API, credenciais e envio de mensagem
 */

import axios from "axios";

async function diagnoseWhatsApp() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 DIAGNÓSTICO DE INTEGRAÇÃO WHATSAPP - ZAPCONTÁBIL");
  console.log("=".repeat(80));

  try {
    // 1. Verificar variáveis de ambiente
    console.log("\n1️⃣ Verificando variáveis de ambiente...");
    const ZAP_API_KEY = process.env.WHATSAPP_API_KEY;
    const ZAP_API_URL = "https://api-fraga.zapcontabil.chat";

    if (!ZAP_API_KEY) {
      console.log("❌ WHATSAPP_API_KEY não configurada");
      return;
    }

    console.log(`✅ WHATSAPP_API_KEY configurada`);
    console.log(`   Primeiros 20 caracteres: ${ZAP_API_KEY.substring(0, 20)}...`);
    console.log(`   Comprimento total: ${ZAP_API_KEY.length} caracteres`);

    // 2. Testar conexão com servidor
    console.log("\n2️⃣ Testando conexão com servidor ZapContábil...");
    console.log(`   URL: ${ZAP_API_URL}`);

    try {
      const healthCheck = await axios.get(`${ZAP_API_URL}/health`, {
        timeout: 5000,
      });
      console.log(`✅ Servidor respondendo (Status: ${healthCheck.status})`);
    } catch (error: any) {
      if (error.code === "ENOTFOUND") {
        console.log(`❌ Servidor não encontrado (DNS error)`);
        console.log(`   Verifique se a URL está correta: ${ZAP_API_URL}`);
      } else if (error.code === "ECONNREFUSED") {
        console.log(`❌ Conexão recusada`);
      } else {
        console.log(`⚠️ Erro ao conectar: ${error.message}`);
      }
    }

    // 3. Testar autenticação
    console.log("\n3️⃣ Testando autenticação...");

    try {
      const authTest = await axios.get(`${ZAP_API_URL}/api/me`, {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      });

      console.log(`✅ Autenticação bem-sucedida`);
      console.log(`   Resposta:`, authTest.data);
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.log(`❌ Autenticação falhou (401 Unauthorized)`);
        console.log(`   API Key pode estar inválida ou expirada`);
      } else if (error.response?.status === 404) {
        console.log(`⚠️ Endpoint /api/me não encontrado`);
        console.log(`   Pode ser que a API use outro endpoint para autenticação`);
      } else {
        console.log(`❌ Erro na autenticação: ${error.message}`);
        if (error.response?.data) {
          console.log(`   Resposta do servidor:`, error.response.data);
        }
      }
    }

    // 4. Testar envio de mensagem
    console.log("\n4️⃣ Testando envio de mensagem...");

    const testPhone = "5511987654321"; // Formato internacional
    const testMessage = "🧪 Teste de integração - Dashboard Fraga Contabilidade";

    console.log(`   Telefone: ${testPhone}`);
    console.log(`   Mensagem: ${testMessage}`);

    try {
      const sendResponse = await axios.post(
        `${ZAP_API_URL}/api/send/${testPhone}`,
        {
          body: testMessage,
          connectionFrom: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${ZAP_API_KEY}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          timeout: 10000,
        }
      );

      console.log(`✅ Mensagem enviada com sucesso!`);
      console.log(`   Status: ${sendResponse.status}`);
      console.log(`   Resposta:`, sendResponse.data);
    } catch (error: any) {
      if (error.response?.status === 400) {
        console.log(`❌ Erro 400 - Requisição inválida`);
        console.log(`   Resposta:`, error.response.data);
        console.log(`   Verifique o formato do telefone ou mensagem`);
      } else if (error.response?.status === 401) {
        console.log(`❌ Erro 401 - Não autorizado`);
        console.log(`   API Key pode estar inválida`);
      } else if (error.response?.status === 429) {
        console.log(`⚠️ Erro 429 - Rate limit atingido`);
        console.log(`   Aguarde antes de tentar novamente`);
      } else if (error.code === "ENOTFOUND") {
        console.log(`❌ Servidor não encontrado`);
      } else {
        console.log(`❌ Erro ao enviar: ${error.message}`);
        if (error.response?.data) {
          console.log(`   Resposta:`, error.response.data);
        }
      }
    }

    // 5. Resumo
    console.log("\n" + "=".repeat(80));
    console.log("📋 RESUMO DO DIAGNÓSTICO");
    console.log("=".repeat(80));
    console.log(`
✅ API Key configurada
⚠️ Verifique os erros acima para resolver problemas de conexão

Próximas ações:
1. Se houver erro de DNS: Verifique a URL do servidor
2. Se houver erro de autenticação: Verifique a API Key
3. Se houver erro de requisição: Verifique o formato da mensagem
4. Se tudo estiver OK: O WhatsApp deve estar funcionando
    `);
  } catch (error: any) {
    console.error("\n❌ ERRO FATAL:", error.message);
  }
}

// Executar diagnóstico
if (require.main === module) {
  diagnoseWhatsApp()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Erro:", error);
      process.exit(1);
    });
}

export { diagnoseWhatsApp };
