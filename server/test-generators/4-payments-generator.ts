/**
 * Gerador 4: Pagamentos de Teste
 * Cria 30 registros de pagamento processados
 */

import { getDb } from "../db";
import { paymentHistory, receivables, clients } from "../../drizzle/schema";

export async function generateTestPayments() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log("[Test Generator 4] 🚀 Gerando 30 pagamentos de teste...");

    // Buscar contas a receber
    const allReceivables = await db.select().from(receivables).limit(30);

    if (allReceivables.length === 0) {
      throw new Error("Nenhuma conta a receber encontrada. Execute o Gerador 2 primeiro!");
    }

    const paymentsToInsert = [];
    const today = new Date();

    for (let i = 0; i < 30; i++) {
      const receivable = allReceivables[i];
      
      // Alguns pagamentos são parciais
      const isPaid = Math.random() > 0.3; // 70% pagos
      const amountPaid = isPaid 
        ? parseFloat(receivable.amount)
        : Math.random() * parseFloat(receivable.amount) * 0.5;

      const paymentDate = new Date(today);
      paymentDate.setDate(paymentDate.getDate() - Math.floor(Math.random() * 30));

      paymentsToInsert.push({
        receivableId: receivable.id,
        clientId: receivable.clientId,
        amountPaid: amountPaid.toString(),
        paymentDate,
        paymentMethod: ["boleto", "pix", "transferencia", "cartao"][Math.floor(Math.random() * 4)],
        collectionScheduleCancelled: isPaid,
        cancelledSchedules: isPaid ? Math.floor(Math.random() * 5) : 0,
        notificationSent: isPaid,
        notificationMethod: isPaid ? (Math.random() > 0.5 ? "whatsapp" : "email") : null,
        createdAt: new Date(),
      });
    }

    await db.insert(paymentHistory).values(paymentsToInsert);
    console.log("[Test Generator 4] ✅ 30 pagamentos criados com sucesso!");
    return paymentsToInsert.length;
  } catch (error: any) {
    console.error("[Test Generator 4] ❌ Erro:", error.message);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateTestPayments()
    .then((count) => {
      console.log(`\n✅ Gerador 4 concluído: ${count} pagamentos criados`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro no gerador 4:", error);
      process.exit(1);
    });
}
