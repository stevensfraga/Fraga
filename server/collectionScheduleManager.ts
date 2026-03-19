/**
 * Gerenciador de agendamento da régua de cobrança
 * Responsável por criar, atualizar e executar agendamentos
 */

import { getDb } from "./db";
import { collectionSchedule, receivables, clients } from "../drizzle/schema";
import { eq, and, lt, gte, lte } from "drizzle-orm";
import { getCollectionTemplate, getStageByDaysOverdue, formatTemplate } from "./collectionRuleTemplates";

/**
 * Criar agendamentos para uma conta a receber
 */
export async function scheduleCollectionMessages(receivableId: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Buscar conta a receber
    const receivable = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (!receivable.length) {
      console.error(`[Collection Schedule] Conta a receber não encontrada: ${receivableId}`);
      return;
    }

    const rec = receivable[0];
    const clientId = rec.clientId;
    const dueDate = new Date(rec.dueDate);
    const now = new Date();

    console.log(`[Collection Schedule] Agendando mensagens para cliente ${clientId}, vencimento: ${dueDate}`);

    // Definir estágios e datas de envio
    const stages = [
      { stage: "d_minus_5", daysOffset: -5 },
      { stage: "d_minus_1", daysOffset: -1 },
      { stage: "d_plus_3", daysOffset: 3 },
      { stage: "d_plus_7", daysOffset: 7 },
      { stage: "d_plus_15", daysOffset: 15 },
      { stage: "d_plus_30", daysOffset: 30 },
      { stage: "d_plus_45", daysOffset: 45 },
      { stage: "d_plus_60", daysOffset: 60 },
    ];

    // Criar agendamentos
    for (const { stage, daysOffset } of stages) {
      const scheduledDate = new Date(dueDate);
      scheduledDate.setDate(scheduledDate.getDate() + daysOffset);

      // Não agendar no passado
      if (scheduledDate < now) {
        console.log(`[Collection Schedule] Pulando estágio ${stage} (data no passado)`);
        continue;
      }

      const template = getCollectionTemplate(stage);
      if (!template) continue;

      const channels = template.channels.join(",");

      // Verificar se já existe agendamento
      const existing = await db
        .select()
        .from(collectionSchedule)
        .where(
          and(
            eq(collectionSchedule.receivableId, receivableId),
            eq(collectionSchedule.stage, stage as any)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`[Collection Schedule] Agendamento já existe para ${stage}`);
        continue;
      }

      // Criar novo agendamento
      await db.insert(collectionSchedule).values({
        clientId,
        receivableId,
        stage: stage as any,
        channels,
        scheduledFor: scheduledDate,
        status: "pending",
      });

      console.log(`[Collection Schedule] ✅ Agendado ${stage} para ${scheduledDate}`);
    }
  } catch (error: any) {
    console.error("[Collection Schedule] Erro ao agendar mensagens:", error.message);
  }
}

/**
 * Buscar agendamentos pendentes para envio
 */
export async function getPendingSchedules() {
  try {
    const db = await getDb();
    if (!db) return [];

    const now = new Date();

    const pending = await db
      .select({
        schedule: collectionSchedule,
        client: clients,
        receivable: receivables,
      })
      .from(collectionSchedule)
      .innerJoin(clients, eq(collectionSchedule.clientId, clients.id))
      .innerJoin(receivables, eq(collectionSchedule.receivableId, receivables.id))
      .where(
        and(
          eq(collectionSchedule.status, "pending"),
          lte(collectionSchedule.scheduledFor, now)
        )
      )
      .limit(50); // Processar até 50 por vez

    console.log(`[Collection Schedule] ${pending.length} agendamentos pendentes encontrados`);
    return pending;
  } catch (error: any) {
    console.error("[Collection Schedule] Erro ao buscar agendamentos:", error.message);
    return [];
  }
}

/**
 * Marcar agendamento como enviado
 */
export async function markScheduleAsSent(
  scheduleId: number,
  whatsappMessageId?: string,
  emailMessageId?: string
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    await db
      .update(collectionSchedule)
      .set({
        status: "sent",
        sentAt: new Date(),
        whatsappMessageId,
        emailMessageId,
        attempts: (await db
          .select({ attempts: collectionSchedule.attempts })
          .from(collectionSchedule)
          .where(eq(collectionSchedule.id, scheduleId))
          .limit(1)
          .then((r) => r[0]?.attempts || 0)) + 1,
        lastAttemptAt: new Date(),
      })
      .where(eq(collectionSchedule.id, scheduleId));

    console.log(`[Collection Schedule] ✅ Agendamento ${scheduleId} marcado como enviado`);
  } catch (error: any) {
    console.error("[Collection Schedule] Erro ao marcar como enviado:", error.message);
  }
}

/**
 * Marcar agendamento como cancelado (cliente pagou)
 */
export async function cancelSchedule(scheduleId: number, reason: string = "Pagamento recebido") {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Cancelar todos os agendamentos da mesma conta a receber
    const schedule = await db
      .select()
      .from(collectionSchedule)
      .where(eq(collectionSchedule.id, scheduleId))
      .limit(1);

    if (!schedule.length) return;

    const receivableId = schedule[0].receivableId;

    // Cancelar todos os pendentes e enviados da mesma conta
    await db
      .update(collectionSchedule)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledReason: reason,
      })
      .where(
        and(
          eq(collectionSchedule.receivableId, receivableId),
          // Cancelar apenas os que ainda não foram entregues
          (collectionSchedule.status as any).notIn(["cancelled", "delivered"])
        )
      );

    console.log(`[Collection Schedule] ✅ Agendamentos cancelados para conta ${receivableId}`);
  } catch (error: any) {
    console.error("[Collection Schedule] Erro ao cancelar agendamento:", error.message);
  }
}

/**
 * Registrar erro no agendamento
 */
export async function recordScheduleError(scheduleId: number, error: string) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const schedule = await db
      .select()
      .from(collectionSchedule)
      .where(eq(collectionSchedule.id, scheduleId))
      .limit(1);

    if (!schedule.length) return;

    const currentAttempts = schedule[0].attempts || 0;
    const maxAttempts = 3;

    if (currentAttempts >= maxAttempts) {
      // Marcar como falha após 3 tentativas
      await db
        .update(collectionSchedule)
        .set({
          status: "failed",
          lastError: error,
          lastAttemptAt: new Date(),
          attempts: currentAttempts + 1,
        })
        .where(eq(collectionSchedule.id, scheduleId));

      console.error(
        `[Collection Schedule] ❌ Agendamento ${scheduleId} falhou após ${maxAttempts} tentativas`
      );
    } else {
      // Tentar novamente
      await db
        .update(collectionSchedule)
        .set({
          lastError: error,
          lastAttemptAt: new Date(),
          attempts: currentAttempts + 1,
        })
        .where(eq(collectionSchedule.id, scheduleId));

      console.warn(
        `[Collection Schedule] ⚠️ Erro no agendamento ${scheduleId}, tentativa ${currentAttempts + 1}/${maxAttempts}`
      );
    }
  } catch (error: any) {
    console.error("[Collection Schedule] Erro ao registrar erro:", error.message);
  }
}

/**
 * Obter estatísticas de agendamento
 */
export async function getScheduleStats() {
  try {
    const db = await getDb();
    if (!db) return null;

    const stats = await db
      .select({
        status: collectionSchedule.status,
        count: collectionSchedule.id,
      })
      .from(collectionSchedule)
      .groupBy(collectionSchedule.status);

    const result = {
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    };

    stats.forEach((s: any) => {
      result.total++;
      if (s.status === "pending") result.pending++;
      if (s.status === "sent") result.sent++;
      if (s.status === "delivered") result.delivered++;
      if (s.status === "failed") result.failed++;
      if (s.status === "cancelled") result.cancelled++;
    });

    return result;
  } catch (error: any) {
    console.error("[Collection Schedule] Erro ao obter estatísticas:", error.message);
    return null;
  }
}
