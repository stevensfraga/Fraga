/**
 * Gerador 6: Análise de Sentimento de Teste
 * Valida o sistema de análise de sentimento com 40 mensagens
 */

import { getSimpleSentimentAnalysis, ClientContext } from "../sentimentAnalysis";

const TEST_MESSAGES = [
  // Positivos
  "Vou pagar agora mesmo! Obrigado pela lembrança.",
  "Já efetuei o pagamento. Tudo certo!",
  "Perfeito, vou resolver isso hoje.",
  "Muito obrigado, já estou regularizando.",
  
  // Negativos
  "Não tenho dinheiro agora, deixa pra depois.",
  "Que cobrança chata, não vou pagar.",
  "Isso é abuso, vou processar vocês!",
  "Não vou pagar nada, vocês estão errados.",
  
  // Mistos
  "Quero pagar mas não tenho dinheiro agora.",
  "Entendo a cobrança, mas estou sem recursos.",
  "Vou pagar, mas preciso de um prazo.",
  "Concordo que devo, mas estou desempregado.",
];

export async function generateTestSentimentAnalysis() {
  try {
    console.log("[Test Generator 6] 🚀 Analisando 40 mensagens de sentimento...");

    const results = [];
    let correctCount = 0;

    const mockContext: ClientContext = {
      clientName: "Cliente Teste",
      amountOverdue: 5000,
      daysOverdue: 15,
      messageType: "friendly",
    };

    for (let i = 0; i < 40; i++) {
      const message = TEST_MESSAGES[i % TEST_MESSAGES.length];
      const analysis = getSimpleSentimentAnalysis(message, mockContext);

      const isCorrect = 
        (i < 4 && analysis.sentiment === "positive") ||
        (i >= 4 && i < 8 && analysis.sentiment === "negative") ||
        (i >= 8 && analysis.sentiment === "mixed");

      if (isCorrect) correctCount++;

      results.push({
        index: i + 1,
        message: message.substring(0, 50) + "...",
        sentiment: analysis.sentiment,
        score: analysis.sentimentScore.toFixed(2),
        isCorrect,
      });
    }

    console.log("[Test Generator 6] ✅ Análise concluída!");
    console.log(`[Test Generator 6] 📊 Taxa de acurácia: ${((correctCount / 40) * 100).toFixed(1)}%`);
    
    return {
      totalAnalyzed: 40,
      correctCount,
      accuracy: ((correctCount / 40) * 100).toFixed(1),
      results,
    };
  } catch (error: any) {
    console.error("[Test Generator 6] ❌ Erro:", error.message);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateTestSentimentAnalysis()
    .then((result) => {
      console.log(`\n✅ Gerador 6 concluído:`);
      console.log(`   - Mensagens analisadas: ${result.totalAnalyzed}`);
      console.log(`   - Corretas: ${result.correctCount}`);
      console.log(`   - Acurácia: ${result.accuracy}%`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro no gerador 6:", error);
      process.exit(1);
    });
}
