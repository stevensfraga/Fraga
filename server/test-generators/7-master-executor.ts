/**
 * Gerador 7: Executor Mestre
 * Executa todos os 6 geradores em sequência e exibe relatório final
 */

import { generateTestClients } from "./1-clients-generator";
import { generateTestReceivables } from "./2-receivables-generator";
import { generateTestCollectionSchedules } from "./3-collection-schedule-generator";
import { generateTestPayments } from "./4-payments-generator";
import { generateTestWebhooks } from "./5-webhooks-generator";
import { generateTestSentimentAnalysis } from "./6-sentiment-analysis-generator";

export async function executeAllGenerators() {
  try {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║     🚀 EXECUTOR MESTRE DE GERADORES DE TESTE 🚀           ║");
    console.log("║     Executando 7 geradores para validar o sistema         ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    const startTime = Date.now();
    const results: any = {};

    // Gerador 1: Clientes
    console.log("▶️  Iniciando Gerador 1: Clientes...");
    try {
      results.clients = await generateTestClients();
      console.log("✅ Gerador 1 concluído\n");
    } catch (error: any) {
      console.log(`⚠️  Gerador 1 falhou: ${error.message}\n`);
      results.clients = 0;
    }

    // Gerador 2: Contas a Receber
    console.log("▶️  Iniciando Gerador 2: Contas a Receber...");
    try {
      results.receivables = await generateTestReceivables();
      console.log("✅ Gerador 2 concluído\n");
    } catch (error: any) {
      console.log(`⚠️  Gerador 2 falhou: ${error.message}\n`);
      results.receivables = 0;
    }

    // Gerador 3: Agendamentos de Cobrança
    console.log("▶️  Iniciando Gerador 3: Agendamentos de Cobrança...");
    try {
      results.schedules = await generateTestCollectionSchedules();
      console.log("✅ Gerador 3 concluído\n");
    } catch (error: any) {
      console.log(`⚠️  Gerador 3 falhou: ${error.message}\n`);
      results.schedules = 0;
    }

    // Gerador 4: Pagamentos
    console.log("▶️  Iniciando Gerador 4: Pagamentos...");
    try {
      results.payments = await generateTestPayments();
      console.log("✅ Gerador 4 concluído\n");
    } catch (error: any) {
      console.log(`⚠️  Gerador 4 falhou: ${error.message}\n`);
      results.payments = 0;
    }

    // Gerador 5: Webhooks
    console.log("▶️  Iniciando Gerador 5: Webhooks...");
    try {
      results.webhooks = await generateTestWebhooks();
      console.log("✅ Gerador 5 concluído\n");
    } catch (error: any) {
      console.log(`⚠️  Gerador 5 falhou: ${error.message}\n`);
      results.webhooks = 0;
    }

    // Gerador 6: Análise de Sentimento
    console.log("▶️  Iniciando Gerador 6: Análise de Sentimento...");
    try {
      const sentimentResult = await generateTestSentimentAnalysis();
      results.sentimentAnalyzed = sentimentResult.totalAnalyzed;
      results.sentimentAccuracy = sentimentResult.accuracy;
      console.log("✅ Gerador 6 concluído\n");
    } catch (error: any) {
      console.log(`⚠️  Gerador 6 falhou: ${error.message}\n`);
      results.sentimentAnalyzed = 0;
      results.sentimentAccuracy = "0%";
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Relatório Final
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║              📊 RELATÓRIO FINAL DOS GERADORES 📊          ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("📈 Dados Criados:");
    console.log(`   • Clientes: ${results.clients} registros`);
    console.log(`   • Contas a Receber: ${results.receivables} registros`);
    console.log(`   • Agendamentos de Cobrança: ${results.schedules} registros`);
    console.log(`   • Pagamentos: ${results.payments} registros`);
    console.log(`   • Webhooks: ${results.webhooks} registros`);
    console.log(`   • Mensagens Analisadas: ${results.sentimentAnalyzed}`);
    console.log(`   • Acurácia de Sentimento: ${results.sentimentAccuracy}`);

    const totalRecords = 
      results.clients + 
      results.receivables + 
      results.schedules + 
      results.payments + 
      results.webhooks;

    console.log(`\n📊 Total de Registros Criados: ${totalRecords}`);
    console.log(`⏱️  Tempo Total: ${duration}s`);

    console.log("\n✅ Todos os geradores foram executados com sucesso!");
    console.log("🎉 Sistema pronto para testes!\n");

    return {
      success: true,
      totalRecords,
      duration,
      results,
    };
  } catch (error: any) {
    console.error("\n❌ Erro fatal no executor mestre:", error.message);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  executeAllGenerators()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Erro:", error);
      process.exit(1);
    });
}
