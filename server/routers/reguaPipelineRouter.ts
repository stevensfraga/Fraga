/**
 * Pipeline da Régua — Router tRPC
 *
 * Endpoints:
 *   reguaPipeline.pipeline  — cards agrupados por stage
 *   reguaPipeline.blocked   — clientes bloqueados com motivos
 *   reguaPipeline.timeline  — timeline de envios recentes
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
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

const STAGE_ORDER = [
  "d_minus_3", "d_0", "d_plus_3", "d_plus_7", "d_plus_15",
  "d_plus_30", "d_plus_45", "d_plus_60", "d_plus_90", "d_plus_180", "d_plus_365",
];

export const reguaPipelineRouter = router({
  // ── Pipeline: cards agrupados por stage ─────────────────────────────────
  pipeline: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      // Buscar clientes com dívida em aberto e seu estágio atual
      const clientsWithDebt = await rawQuery(
        `SELECT 
           c.id AS clientId, c.name AS clientName, c.document,
           c.whatsappNumber, c.optOut, c.billingPausedUntil, c.negotiatedUntil,
           c.status AS clientStatus,
           r.openCount, r.totalDebt, r.maxDaysOverdue, r.oldestDueDate,
           ra.lastStage, ra.lastSentAt
         FROM clients c
         INNER JOIN (
           SELECT clientId,
                  COUNT(*) AS openCount,
                  SUM(CAST(amount AS DECIMAL(12,2))) AS totalDebt,
                  MAX(DATEDIFF(NOW(), dueDate)) AS maxDaysOverdue,
                  MIN(dueDate) AS oldestDueDate
           FROM receivables
           WHERE status IN ('pending', 'overdue') AND CAST(amount AS DECIMAL) > 0
           GROUP BY clientId
         ) r ON r.clientId = c.id
         LEFT JOIN (
           SELECT clientId,
                  stage AS lastStage,
                  MAX(sentAt) AS lastSentAt
           FROM regua_audit
           WHERE status = 'sent'
           GROUP BY clientId, stage
         ) ra ON ra.clientId = c.id
         ORDER BY r.totalDebt DESC`
      );

      // Agrupar por stage
      const stageMap: Record<string, any[]> = {};
      for (const stage of STAGE_ORDER) stageMap[stage] = [];

      for (const row of clientsWithDebt as any[]) {
        const days = Number(row.maxDaysOverdue) || 0;
        let stage = "d_plus_365";
        if (days <= -3) stage = "d_minus_3";
        else if (days <= 0) stage = "d_0";
        else if (days <= 3) stage = "d_plus_3";
        else if (days <= 7) stage = "d_plus_7";
        else if (days <= 15) stage = "d_plus_15";
        else if (days <= 30) stage = "d_plus_30";
        else if (days <= 45) stage = "d_plus_45";
        else if (days <= 60) stage = "d_plus_60";
        else if (days <= 90) stage = "d_plus_90";
        else if (days <= 180) stage = "d_plus_180";

        if (!stageMap[stage]) stageMap[stage] = [];
        stageMap[stage].push({
          clientId: row.clientId,
          clientName: row.clientName,
          document: row.document,
          whatsappNumber: row.whatsappNumber,
          optOut: !!row.optOut,
          billingPausedUntil: row.billingPausedUntil,
          negotiatedUntil: row.negotiatedUntil,
          clientStatus: row.clientStatus,
          openCount: Number(row.openCount),
          totalDebt: Number(row.totalDebt),
          maxDaysOverdue: Number(row.maxDaysOverdue),
          oldestDueDate: row.oldestDueDate,
          lastStage: row.lastStage,
          lastSentAt: row.lastSentAt,
        });
      }

      const stages = STAGE_ORDER.map(stage => ({
        stage,
        clients: stageMap[stage] || [],
        count: (stageMap[stage] || []).length,
        totalDebt: (stageMap[stage] || []).reduce((s: number, c: any) => s + c.totalDebt, 0),
      }));

      const totalClients = stages.reduce((s, st) => s + st.count, 0);
      const totalDebt = stages.reduce((s, st) => s + st.totalDebt, 0);

      return {
        stages,
        summary: { totalClients, totalDebt, stageCount: stages.filter(s => s.count > 0).length },
      };
    }),

  // ── Bloqueados com motivos ──────────────────────────────────────────────
  blocked: publicProcedure
    .input(z.object({ reason: z.string().optional() }))
    .query(async ({ input }) => {
      const rows = await rawQuery(
        `SELECT 
           c.id AS clientId, c.name AS clientName, c.document,
           c.whatsappNumber, c.optOut, c.billingPausedUntil, c.negotiatedUntil,
           c.status AS clientStatus,
           r.totalDebt, r.openCount, r.maxDaysOverdue
         FROM clients c
         INNER JOIN (
           SELECT clientId,
                  COUNT(*) AS openCount,
                  SUM(CAST(amount AS DECIMAL(12,2))) AS totalDebt,
                  MAX(DATEDIFF(NOW(), dueDate)) AS maxDaysOverdue
           FROM receivables
           WHERE status IN ('pending', 'overdue') AND CAST(amount AS DECIMAL) > 0
           GROUP BY clientId
         ) r ON r.clientId = c.id
         ORDER BY r.totalDebt DESC`
      );

      const blocked: any[] = [];
      const reasonCounts: Record<string, number> = {};

      for (const row of rows as any[]) {
        let reason: string | null = null;
        if (row.optOut) reason = "opt-out";
        else if (row.billingPausedUntil && new Date(row.billingPausedUntil) > new Date()) reason = "paused";
        else if (row.negotiatedUntil && new Date(row.negotiatedUntil) > new Date()) reason = "negotiated";
        else if (!row.whatsappNumber) reason = "no-whatsapp";
        else if (row.clientStatus !== "active") reason = "inactive";

        if (!reason) continue;
        if (input.reason && reason !== input.reason) continue;

        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        blocked.push({
          clientId: row.clientId, clientName: row.clientName, document: row.document,
          whatsappNumber: row.whatsappNumber, totalDebt: Number(row.totalDebt),
          openCount: Number(row.openCount), maxDaysOverdue: Number(row.maxDaysOverdue),
          blockReason: reason, optOut: !!row.optOut,
          billingPausedUntil: row.billingPausedUntil, negotiatedUntil: row.negotiatedUntil,
        });
      }

      return { blocked, total: blocked.length, byReason: reasonCounts };
    }),

  // ── Timeline de envios recentes ─────────────────────────────────────────
  timeline: publicProcedure
    .input(z.object({
      days: z.number().int().min(1).max(30).default(7),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const rows = await rawQuery(
        `SELECT 
           ra.id, ra.runId, ra.clientId, ra.stage, ra.status, ra.skipReason,
           ra.phoneE164, ra.totalDebt, ra.titlesCount, ra.maxDaysOverdue,
           ra.sentAt, ra.createdAt, ra.dryRun,
           c.name AS clientName, c.document
         FROM regua_audit ra
         LEFT JOIN clients c ON c.id = ra.clientId
         WHERE ra.createdAt >= DATE_SUB(NOW(), INTERVAL ${Number(input.days)} DAY)
         ORDER BY ra.createdAt DESC
         LIMIT ${Number(input.limit)}`
      );

      return {
        entries: rows.map((r: any) => ({
          id: r.id, runId: r.runId, clientId: r.clientId, clientName: r.clientName,
          document: r.document, stage: r.stage, status: r.status, skipReason: r.skipReason,
          phoneE164: r.phoneE164, totalDebt: Number(r.totalDebt || 0),
          titlesCount: r.titlesCount, maxDaysOverdue: r.maxDaysOverdue,
          sentAt: r.sentAt, createdAt: r.createdAt, dryRun: !!r.dryRun,
        })),
        total: rows.length,
      };
    }),
});
