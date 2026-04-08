/**
 * Router: syncSchedule
 *
 * Endpoints:
 * - status: retorna cron, timezone, nextRunAt, lastAttemptAt, lastStatus, lastResult, isLate
 * - runNow: dispara sync manual (protectedProcedure)
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { calcNextRunAt, getSyncSchedulerMeta, runSyncNow } from "../syncScheduler";

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDb();
  if (!db) return [];
  const [rows] = await (db as any).execute(sql, params);
  return rows as T[];
}

export const syncScheduleRouter = router({
  // ── Status do agendamento ────────────────────────────────────────────────
  status: publicProcedure.query(async () => {
    // Buscar último registro da sync_cursor (tipo receivables_full)
    const cursors = await rawQuery(
      `SELECT id, syncType, lastSyncAt, nextSyncAt, lastStatus, lastResult, updatedAt
       FROM sync_cursor
       WHERE syncType = 'receivables_full'
       ORDER BY updatedAt DESC
       LIMIT 1`
    );

    const cursor = cursors[0] || null;

    // Metadados do scheduler em memória
    const meta = getSyncSchedulerMeta();

    // Calcular nextRunAt: preferir nextSyncAt do banco, senão calcular
    const nextRunAt: Date = cursor?.nextSyncAt
      ? new Date(cursor.nextSyncAt)
      : meta.nextRunAt;

    // Verificar se está atrasado (passou 15 min do horário previsto sem execução)
    const now = new Date();
    const lastAttemptAt: Date | null = cursor?.updatedAt ? new Date(cursor.updatedAt) : null;

    // Calcular se está atrasado: se o nextRunAt já passou há mais de 15 min e não houve execução depois
    const expectedAt = cursor?.nextSyncAt ? new Date(cursor.nextSyncAt) : null;
    const isLate = expectedAt
      ? now > expectedAt &&
        now.getTime() - expectedAt.getTime() > 15 * 60 * 1000 &&
        (!lastAttemptAt || lastAttemptAt < expectedAt)
      : false;

    // Parse do lastResult
    let lastResult: Record<string, unknown> | null = null;
    if (cursor?.lastResult) {
      try {
        lastResult = JSON.parse(cursor.lastResult);
      } catch {
        lastResult = { raw: cursor.lastResult };
      }
    }

    return {
      // Configuração do scheduler
      cronExpr: meta.cronExpr,
      timezone: meta.timezone,
      schedulerActive: meta.schedulerActive,
      isSyncRunning: meta.isRunning,

      // Próxima execução
      nextRunAt,

      // Última execução
      lastAttemptAt,
      lastStatus: (cursor?.lastStatus as "success" | "partial" | "failed" | null) ?? null,
      lastResult,
      lastError: lastResult?.error as string | undefined,

      // Alerta de atraso
      isLate,
      lateByMs: isLate && expectedAt ? now.getTime() - expectedAt.getTime() : 0,
    };
  }),

  // ── Histórico das últimas 10 execuções ───────────────────────────────────
  history: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      // Como sync_cursor só tem 1 linha por syncType, vamos buscar do regua_audit como referência
      // Para o sync, usamos a tabela sync_cursor e complementamos com logs de execução
      // Buscar todos os registros de sync_cursor ordenados por updatedAt
      const rows = await rawQuery(
        `SELECT id, syncType, lastSyncAt, lastStatus, lastResult, updatedAt
         FROM sync_cursor
         ORDER BY updatedAt DESC
         LIMIT ${Number(input.limit)}`
      );

      return rows.map((r: any) => {
        let result: Record<string, unknown> | null = null;
        try {
          result = r.lastResult ? JSON.parse(r.lastResult) : null;
        } catch {
          result = null;
        }
        return {
          id: r.id,
          syncType: r.syncType,
          executedAt: r.updatedAt ? new Date(r.updatedAt) : null,
          status: r.lastStatus,
          clientsSynced: result?.clientsSynced as number | undefined,
          receivablesSynced: result?.receivablesSynced as number | undefined,
          durationMs: result?.durationMs as number | undefined,
          error: result?.error as string | undefined,
        };
      });
    }),

  // ── Trigger manual (admin) ───────────────────────────────────────────────
  runNow: protectedProcedure.mutation(async () => {
    const result = await runSyncNow();
    return result;
  }),
});
