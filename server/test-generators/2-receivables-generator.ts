/**
 * Gerador 2: Contas a Receber de Teste
 * Cria 100 contas a receber com diferentes status de atraso
 */

import { getDb } from "../db";
import { receivables, clients } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export async function generateTestReceivables() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log("[Test Generator 2] 🚀 Gerando 100 contas a receber de teste...");

    // Buscar clientes criados
    const allClients = await db.select().from(clients).limit(50);

    if (allClients.length === 0) {
      throw new Error("Nenhum cliente encontrado. Execute o Gerador 1 primeiro!");
    }

    const receivablesToInsert = [];
    const today = new Date();

    for (let i = 0; i < 100; i++) {
      const client = allClients[i % allClients.length];
      const amount = (Math.random() * 50000 + 1000).toFixed(2);
      
      // Distribuir entre diferentes status de atraso
      let daysOverdue = 0;
      let status: "pending" | "paid" | "cancelled" = "pending";
      
      const random = Math.random();
      if (random < 0.2) {
        daysOverdue = 0; // A vencer
        status = "pending";
      } else if (random < 0.4) {
        daysOverdue = Math.floor(Math.random() * 15); // 0-15 dias
        status = "pending";
      } else if (random < 0.6) {
        daysOverdue = Math.floor(Math.random() * 15 + 15); // 15-30 dias
        status = "pending";
      } else if (random < 0.75) {
        daysOverdue = Math.floor(Math.random() * 30 + 30); // 30-60 dias
        status = "pending";
      } else if (random < 0.9) {
        daysOverdue = Math.floor(Math.random() * 60 + 60); // 60+ dias
        status = "pending";
      } else {
        status = "paid"; // 10% já pagos
      }

      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() - daysOverdue);

      receivablesToInsert.push({
        clientId: client.id,
        contaAzulId: `boleto-${i}`,
        amount: amount.toString(),
        dueDate,
        monthsOverdue: Math.floor(daysOverdue / 30),
        status,
        boletoUrl: `https://boleto.contaazul.com/boleto-${i}`,
        createdAt: new Date(),
      });
    }

    await db.insert(receivables).values(receivablesToInsert);
    console.log("[Test Generator 2] ✅ 100 contas a receber criadas com sucesso!");
    return receivablesToInsert.length;
  } catch (error: any) {
    console.error("[Test Generator 2] ❌ Erro:", error.message);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateTestReceivables()
    .then((count) => {
      console.log(`\n✅ Gerador 2 concluído: ${count} contas a receber criadas`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro no gerador 2:", error);
      process.exit(1);
    });
}
