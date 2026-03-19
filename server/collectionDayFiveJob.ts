/**
 * Job agendado para rodar cobrança automática no dia 5 de cada mês
 * Envia primeira rodada de mensagens de cobrança
 */

import * as cron from "node-cron";
import { getDb } from "./db";
import { clients, receivables, collectionSchedule } from "../drizzle/schema";
import type { InsertCollectionSchedule } from "../drizzle/schema";
import { eq, and, lte } from "drizzle-orm";
import { getStageByDaysOverdue } from "./collectionRuleTemplates";

// Armazenar referência do job para poder cancelar se necessário
let collectionDayFiveJob: ReturnType<typeof cron.schedule> | null = null;

/**
 * Inicializar job de cobrança do dia 5
 * Executa no dia 5 de cada mês às 8:00 AM
 */
export function initializeCollectionDayFiveJob() {
  // Cancelar job anterior se existir
  if (collectionDayFiveJob) {
    collectionDayFiveJob.stop();
    console.log("[Collection Day 5] Job anterior cancelado");
  }

  // Agendar novo job: dia 5 de cada mês às 8:00 AM
  // Formato cron: minuto hora dia mes dia-semana
  // 0 8 5 * * = 8:00 AM no dia 5 de cada mês
  collectionDayFiveJob = cron.schedule("0 8 5 * *", async () => {
    console.log("[Collection Day 5] ⏰ Iniciando cobrança automática do dia 5...");
    try {
      await runCollectionDayFive();
    } catch (error: any) {
      console.error("[Collection Day 5] ❌ Erro na cobrança:", error.message);
    }
  });

  console.log(
    "[Collection Day 5] ✅ Job de cobrança inicializado (dia 5 às 8:00 AM)"
  );
  return collectionDayFiveJob;
}

/**
 * Executar cobrança do dia 5
 */
export async function runCollectionDayFive(): Promise<{
  success: boolean;
  clientsProcessed: number;
  schedulesCreated: number;
  error?: string;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log(
      "[Collection Day 5] 🔄 Processando clientes para cobrança automática..."
    );

    // Buscar todas as contas a receber pendentes
    const pendingReceivables = await db
      .select()
      .from(receivables)
      .where(eq(receivables.status, "pending"));

    let clientsProcessed = 0;
    let schedulesCreated = 0;

    for (const receivable of pendingReceivables) {
      try {
        // Buscar cliente
        const clientResult = await db
          .select()
          .from(clients)
          .where(eq(clients.id, receivable.clientId))
          .limit(1);

        if (!clientResult.length) {
          console.warn(
            `[Collection Day 5] ⚠️ Cliente não encontrado para conta a receber ${receivable.id}`
          );
          continue;
        }

        const client = clientResult[0];

        // Verificar se já existe agendamento para esta conta a receber
        const existingSchedule = await db
          .select()
          .from(collectionSchedule)
          .where(eq(collectionSchedule.receivableId, receivable.id))
          .limit(1);

        if (existingSchedule.length > 0) {
          console.log(
            `[Collection Day 5] ℹ️ Agendamento já existe para ${client.name}`
          );
          continue;
        }

        // Calcular dias de atraso
        const now = new Date();
        const dueDate = new Date(receivable.dueDate);
        const daysOverdue = Math.floor(
          (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Determinar estágio inicial
        const stage = getStageByDaysOverdue(daysOverdue);

        // Criar agendamento inicial
        const scheduledFor = new Date();
        scheduledFor.setDate(scheduledFor.getDate() + 5); // D-5

        await db.insert(collectionSchedule).values({
          clientId: client.id,
          receivableId: receivable.id,
          stage: stage as any,
          channels: "whatsapp,email",
          status: "pending",
          scheduledFor: scheduledFor,
        });

        clientsProcessed++;
        schedulesCreated++;

        console.log(
          `[Collection Day 5] ✅ Agendamento criado para ${client.name} (estágio: ${stage})`
        );
      } catch (error: any) {
        console.error(
          `[Collection Day 5] ❌ Erro ao processar conta a receber ${receivable.id}:`,
          error.message
        );
      }
    }

    console.log(
      `[Collection Day 5] ✅ Cobrança concluída: ${clientsProcessed} clientes, ${schedulesCreated} agendamentos`
    );

    return {
      success: true,
      clientsProcessed,
      schedulesCreated,
    };
  } catch (error: any) {
    console.error(
      "[Collection Day 5] ❌ Erro ao executar cobrança:",
      error.message
    );
    return {
      success: false,
      clientsProcessed: 0,
      schedulesCreated: 0,
      error: error.message,
    };
  }
}

/**
 * Parar job de cobrança
 */
export function stopCollectionDayFiveJob() {
  if (collectionDayFiveJob) {
    collectionDayFiveJob.stop();
    collectionDayFiveJob = null;
    console.log("[Collection Day 5] ⏹️ Job de cobrança parado");
  }
}

/**
 * Obter status do job
 */
export function getCollectionDayFiveJobStatus() {
  return {
    isRunning: collectionDayFiveJob !== null,
    nextExecution: collectionDayFiveJob ? "Dia 5 do mês às 8:00 AM" : "Não agendado",
  };
}

/**
 * Executar cobrança manual
 */
export async function triggerManualCollectionDayFive(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.log(
      "[Collection Day 5] 🔄 Cobrança manual acionada para dia 5..."
    );
    const result = await runCollectionDayFive();

    return {
      success: result.success,
      message: `Cobrança concluída: ${result.clientsProcessed} clientes processados, ${result.schedulesCreated} agendamentos criados`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Erro na cobrança: ${error.message}`,
    };
  }
}
