/**
 * Pagamentos & Divergências — Router tRPC
 *
 * Endpoints:
 *   payments.recent       — pagamentos confirmados recentes
 *   payments.divergences  — divergências CA×DB (reconciliation_audit)
 *   payments.syncErrors   — erros de sincronização
 *   payments.retryFailed  — reprocessar reconciliação
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import mysql from "mysql2/promise";

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

export const paymentsRouter = router({
  // ── Pagamentos confirmados recentes ─────────────────────────────────────
  recent: publicProcedure
    .input(z.object({
      days: z.number().int().min(1).max(90).default(30),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const rows = await rawQuery(
        `SELECT 
           r.id, r.contaAzulId, r.clientId, r.amount, r.dueDate, r.paidDate,
           r.status, r.description, r.updatedAt,
           c.name AS clientName, c.document
         FROM receivables r
         LEFT JOIN clients c ON c.id = r.clientId
         WHERE r.status = 'paid'
           AND r.updatedAt >= DATE_SUB(NOW(), INTERVAL ${Number(input.days)} DAY)
         ORDER BY r.updatedAt DESC
         LIMIT ${Number(input.limit)}`
      );

      const [totals] = await rawQuery(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(CAST(amount AS DECIMAL(12,2))), 0) AS totalAmount
         FROM receivables
         WHERE status = 'paid'
           AND updatedAt >= DATE_SUB(NOW(), INTERVAL ${Number(input.days)} DAY)`
      );

      return {
        payments: rows.map((r: any) => ({
          id: r.id, contaAzulId: r.contaAzulId, clientId: r.clientId,
          clientName: r.clientName, document: r.document,
          amount: Number(r.amount), dueDate: r.dueDate, paidDate: r.paidDate,
          status: r.status, description: r.description, updatedAt: r.updatedAt,
        })),
        totals: {
          count: Number(totals?.count ?? 0),
          totalAmount: Number(totals?.totalAmount ?? 0),
        },
      };
    }),

  // ── Divergências CA×DB (reconciliation_audit) ──────────────────────────
  divergences: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const divergences = await rawQuery(
        `SELECT 
           ra.id, ra.runId, ra.caTotal, ra.caCount, ra.dbTotal, ra.dbCount,
           ra.diffValue, ra.diffPercent, ra.isAlerted,
           ra.orphanCount, ra.statusMismatchCount, ra.valueMismatchCount,
           ra.alertMessage, ra.status, ra.createdAt
         FROM reconciliation_audit ra
         WHERE ra.isAlerted = 1 OR ra.statusMismatchCount > 0 OR ra.valueMismatchCount > 0
         ORDER BY ra.createdAt DESC
         LIMIT ${Number(input.limit)}`
      );

      const [unresolvedCount] = await rawQuery(
        `SELECT COUNT(*) AS count FROM reconciliation_audit WHERE isAlerted = 1`
      );

      const staleReceivables = await rawQuery(
        `SELECT 
           r.id, r.contaAzulId, r.clientId, r.amount, r.dueDate, r.status AS dbStatus,
           r.updatedAt, c.name AS clientName, c.document
         FROM receivables r
         LEFT JOIN clients c ON c.id = r.clientId
         WHERE r.status IN ('pending', 'overdue')
           AND CAST(r.amount AS DECIMAL) > 0
           AND r.updatedAt < DATE_SUB(NOW(), INTERVAL 3 DAY)
         ORDER BY r.dueDate ASC
         LIMIT ${Number(input.limit)}`
      );

      return {
        divergences: divergences.map((d: any) => ({
          id: d.id, runId: d.runId, caTotal: Number(d.caTotal), caCount: Number(d.caCount),
          dbTotal: Number(d.dbTotal), dbCount: Number(d.dbCount),
          diffValue: Number(d.diffValue), diffPercent: Number(d.diffPercent),
          isAlerted: !!d.isAlerted, orphanCount: Number(d.orphanCount),
          statusMismatchCount: Number(d.statusMismatchCount),
          valueMismatchCount: Number(d.valueMismatchCount),
          alertMessage: d.alertMessage, status: d.status, createdAt: d.createdAt,
        })),
        unresolvedCount: Number(unresolvedCount?.count ?? 0),
        staleReceivables: staleReceivables.map((r: any) => ({
          id: r.id, contaAzulId: r.contaAzulId, clientId: r.clientId,
          clientName: r.clientName, document: r.document,
          amount: Number(r.amount), dueDate: r.dueDate,
          dbStatus: r.dbStatus, updatedAt: r.updatedAt,
        })),
      };
    }),

  // ── Erros de sincronização ──────────────────────────────────────────────
  syncErrors: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }))
    .query(async ({ input }) => {
      const cursors = await rawQuery(
        `SELECT id, syncType, lastSyncAt, lastStatus, lastResult, updatedAt
         FROM sync_cursor ORDER BY updatedAt DESC`
      );

      const errors = await rawQuery(
        `SELECT ra.id, ra.runId, ra.status, ra.errorMessage, ra.createdAt
         FROM reconciliation_audit ra
         WHERE ra.status = 'failed'
           AND ra.createdAt >= DATE_SUB(NOW(), INTERVAL ${Number(input.days)} DAY)
         ORDER BY ra.createdAt DESC
         LIMIT 50`
      );

      return {
        cursors: cursors.map((c: any) => ({
          id: c.id, syncType: c.syncType, lastSyncAt: c.lastSyncAt,
          lastStatus: c.lastStatus,
          lastResult: c.lastResult ? JSON.parse(c.lastResult) : null,
          updatedAt: c.updatedAt,
        })),
        errors: errors.map((e: any) => ({
          id: e.id, runId: e.runId, status: e.status,
          errorMessage: e.errorMessage, createdAt: e.createdAt,
        })),
      };
    }),

  // ── Último sync de pagamentos (para indicador de frescor) ───────────────────────
  lastSync: publicProcedure.query(async () => {
    const rows = await rawQuery(
      `SELECT lastSyncAt, lastStatus, lastResult, updatedAt
       FROM sync_cursor
       WHERE syncType = 'payments_lite'
       ORDER BY updatedAt DESC
       LIMIT 1`
    );
    if (!rows.length) return { lastSyncAt: null, lastStatus: null, minutesAgo: null };
    const row = rows[0] as any;
    const lastSyncAt = row.lastSyncAt ? new Date(row.lastSyncAt) : null;
    const minutesAgo = lastSyncAt
      ? Math.floor((Date.now() - lastSyncAt.getTime()) / 60000)
      : null;
    return {
      lastSyncAt,
      lastStatus: row.lastStatus,
      minutesAgo,
      lastResult: row.lastResult ? JSON.parse(row.lastResult) : null,
    };
  }),

  // ── Sync manual de pagamentos (botão "Atualizar agora") ─────────────────────
  syncNow: protectedProcedure.mutation(async () => {
    const { syncPaymentsJob } = await import('../syncPaymentsJob');
    const { getDb } = await import('../db');
    const { syncCursor: syncCursorTable } = await import('../../drizzle/schema');
    const { eq } = await import('drizzle-orm');

    const result = await syncPaymentsJob(360);

    // Persistir no syncCursor
    try {
      const db = await getDb();
      if (db) {
        const existing = await db.select().from(syncCursorTable)
          .where(eq(syncCursorTable.syncType, 'payments_lite'))
          .limit(1);
        const lastResult = JSON.stringify({
          checkedLocal: result.checkedLocal,
          resolvedCount: result.resolvedCount,
          updatedCount: result.updatedCount,
          windowDays: result.windowDays,
          durationMs: result.durationMs,
          error: result.error,
          triggeredBy: 'manual',
        });
        if (existing.length > 0) {
          await db.update(syncCursorTable)
            .set({ lastSyncAt: new Date(), lastStatus: result.success ? 'success' : 'failed', lastResult })
            .where(eq(syncCursorTable.syncType, 'payments_lite'));
        } else {
          await db.insert(syncCursorTable).values({
            syncType: 'payments_lite',
            lastSyncAt: new Date(),
            lastStatus: result.success ? 'success' : 'failed',
            lastResult,
          });
        }
      }
    } catch (_) {}

    return {
      success: result.success,
      checkedLocal: result.checkedLocal,
      updatedCount: result.updatedCount,
      resolvedCount: result.resolvedCount,
      durationMs: result.durationMs,
      error: result.error,
      syncedAt: new Date(),
    };
  }),

  // ── Reprocessar reconciliação ──────────────────────────────────────────────
  retryFailed: protectedProcedure
    .input(z.object({ receivableIds: z.array(z.number().int().positive()).min(1).max(50) }))
    .mutation(async ({ input }) => {
      const { runReconciliation } = await import("../services/reconciliationService");
      try {
        const reconcResult = await runReconciliation();
        const results = input.receivableIds.map(id => ({
          receivableId: id, success: true, message: "Reconciliação executada com sucesso",
        }));
        return {
          total: results.length, success: results.length, failed: 0, results,
          reconciliation: {
            runId: reconcResult.runId,
            statusMismatchCount: reconcResult.statusMismatchCount,
            status: reconcResult.status,
          },
        };
      } catch (err: any) {
        const results = input.receivableIds.map(id => ({
          receivableId: id, success: false, error: err.message || "Erro na reconciliação",
        }));
        return { total: results.length, success: 0, failed: results.length, results };
      }
    }),
});
