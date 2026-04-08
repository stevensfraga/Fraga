/**
 * Gerador 5: Webhooks de Teste
 * Cria 20 registros de webhooks recebidos do Conta Azul
 */

import { getDb } from "../db";
import { contaAzulWebhooks, receivables } from "../../drizzle/schema";

export async function generateTestWebhooks() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log("[Test Generator 5] 🚀 Gerando 20 webhooks de teste...");

    // Buscar contas a receber
    const allReceivables = await db.select().from(receivables).limit(20);

    if (allReceivables.length === 0) {
      throw new Error("Nenhuma conta a receber encontrada. Execute o Gerador 2 primeiro!");
    }

    const webhooksToInsert = [];
    const today = new Date();

    for (let i = 0; i < 20; i++) {
      const receivable = allReceivables[i];
      const eventDate = new Date(today);
      eventDate.setDate(eventDate.getDate() - Math.floor(Math.random() * 30));

      const isProcessed = Math.random() > 0.2; // 80% processados
      const amountPaid = parseFloat(receivable.amount);

      webhooksToInsert.push({
        webhookId: `webhook-${i}`,
        eventType: "payment.received",
        payload: JSON.stringify({
          id: `boleto-${i}`,
          amount: amountPaid,
          status: "paid",
          paidAt: eventDate.toISOString(),
        }),
        receivableId: receivable.id,
        clientId: receivable.clientId,
        amountPaid: amountPaid.toString(),
        paymentDate: eventDate,
        status: isProcessed ? ("processed" as const) : ("received" as const),
        error: isProcessed ? null : "Erro ao processar webhook",
        processedAt: isProcessed ? new Date() : null,
        createdAt: eventDate,
      });
    }

    await db.insert(contaAzulWebhooks).values(webhooksToInsert);
    console.log("[Test Generator 5] ✅ 20 webhooks criados com sucesso!");
    return webhooksToInsert.length;
  } catch (error: any) {
    console.error("[Test Generator 5] ❌ Erro:", error.message);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateTestWebhooks()
    .then((count) => {
      console.log(`\n✅ Gerador 5 concluído: ${count} webhooks criados`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro no gerador 5:", error);
      process.exit(1);
    });
}
