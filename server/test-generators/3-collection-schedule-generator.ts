/**
 * Gerador 3: Agendamentos de Cobrança de Teste
 * Cria 50 agendamentos em diferentes estágios
 */

import { getDb } from "../db";
import { collectionSchedule, receivables, clients } from "../../drizzle/schema";

const STAGES = ["d_minus_5", "d_minus_1", "d_plus_3", "d_plus_7", "d_plus_15", "d_plus_30", "d_plus_45", "d_plus_60"];

export async function generateTestCollectionSchedules() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log("[Test Generator 3] 🚀 Gerando 50 agendamentos de cobrança de teste...");

    // Buscar contas a receber com clientes
    const allReceivables = await db.select().from(receivables).limit(50);

    if (allReceivables.length === 0) {
      throw new Error("Nenhuma conta a receber encontrada. Execute o Gerador 2 primeiro!");
    }

    const schedulesToInsert = [];
    const today = new Date();

    for (let i = 0; i < 50; i++) {
      const receivable = allReceivables[i];
      const stage = STAGES[Math.floor(Math.random() * STAGES.length)];
      
      // Calcular data de envio baseado no estágio
      let daysToAdd = 0;
      switch (stage) {
        case "d_minus_5": daysToAdd = -5; break;
        case "d_minus_1": daysToAdd = -1; break;
        case "d_plus_3": daysToAdd = 3; break;
        case "d_plus_7": daysToAdd = 7; break;
        case "d_plus_15": daysToAdd = 15; break;
        case "d_plus_30": daysToAdd = 30; break;
        case "d_plus_45": daysToAdd = 45; break;
        case "d_plus_60": daysToAdd = 60; break;
      }

      const scheduledFor = new Date(today);
      scheduledFor.setDate(scheduledFor.getDate() + daysToAdd);

      const isSent = Math.random() > 0.3; // 70% já enviados

      schedulesToInsert.push({
        clientId: receivable.clientId,
        receivableId: receivable.id,
        stage: stage as any,
        channels: Math.random() > 0.5 ? "whatsapp,email" : "whatsapp",
        scheduledFor,
        sentAt: isSent ? new Date() : null,
        status: isSent ? ("sent" as const) : ("pending" as const),
        whatsappMessageId: isSent ? `msg-${i}` : null,
        emailMessageId: isSent ? `email-${i}` : null,
        attempts: isSent ? 1 : 0,
        createdAt: new Date(),
      });
    }

    await db.insert(collectionSchedule).values(schedulesToInsert);
    console.log("[Test Generator 3] ✅ 50 agendamentos de cobrança criados com sucesso!");
    return schedulesToInsert.length;
  } catch (error: any) {
    console.error("[Test Generator 3] ❌ Erro:", error.message);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateTestCollectionSchedules()
    .then((count) => {
      console.log(`\n✅ Gerador 3 concluído: ${count} agendamentos criados`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro no gerador 3:", error);
      process.exit(1);
    });
}
