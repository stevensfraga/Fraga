/**
 * Régua de Cobrança — Router tRPC
 *
 * Endpoints:
 *   regua.status       — status atual (habilitada, quiet hours, candidatos, daily limit)
 *   regua.preview      — listar candidatos sem enviar (dryRun)
 *   regua.run          — executar régua (dryRun ou real)
 *   regua.history      — histórico de execuções (regua_audit)
 *   regua.auditByRun   — detalhes de uma execução específica
 *   regua.stats        — estatísticas por período (enviados, pulados, erros por etapa)
 *   regua.logs         — auditoria recente com filtros
 */

import { z } from 'zod';
import { router, protectedProcedure, publicProcedure } from '../_core/trpc';
import {
  runRegua,
  fetchReguaCandidates,
  consolidateCandidates,
  isQuietHours,
  isBusinessDay,
  getAllowedStages,
  getDailySentCount,
} from '../services/reguaCobrancaService';
import mysql from 'mysql2/promise';

export const reguaRouter = router({
  // ── Status da régua ──────────────────────────────────────────────────────
  status: publicProcedure.query(async () => {
    const enabled = process.env.REGUA_ENABLED !== 'false';
    const quietHours = isQuietHours();
    const quietHoursConfig = process.env.REGUA_QUIET_HOURS || '18:00-08:00';
    const businessDaysOnly = process.env.REGUA_BUSINESS_DAYS_ONLY !== 'false';
    const isWorkday = isBusinessDay();
    const dedupMinutes = parseInt(process.env.REGUA_DEDUP_MINUTES || '10080', 10);
    const rateLimitHours = parseInt(process.env.REGUA_RATE_LIMIT_HOURS || '12', 10);
    const dailyLimit = parseInt(process.env.REGUA_DAILY_LIMIT || '50', 10);
    const financeiroQueueId = parseInt(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO || '5', 10);
    const allowedStages = getAllowedStages();

    // Contar candidatos elegíveis
    let candidatesCount = 0;
    try {
      const candidates = await fetchReguaCandidates(500);
      const consolidated = consolidateCandidates(candidates);
      candidatesCount = consolidated.length;
    } catch (e) {
      // ignorar erro de contagem
    }

    // Contar envios do dia
    const dailySent = await getDailySentCount();
    const dailyRemaining = Math.max(0, dailyLimit - dailySent);

    return {
      enabled,
      quietHours,
      quietHoursConfig,
      businessDaysOnly,
      isWorkday,
      dedupMinutes,
      rateLimitHours,
      dailyLimit,
      dailySent,
      dailyRemaining,
      financeiroQueueId,
      allowedStages,
      candidatesCount,
      canRunNow: enabled && !quietHours && (!businessDaysOnly || isWorkday) && dailyRemaining > 0,
    };
  }),

  // ── Preview (dryRun) ─────────────────────────────────────────────────────
  preview: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional().default(50) }))
    .query(async ({ input }) => {
      const candidates = await fetchReguaCandidates(input.limit);
      const consolidated = consolidateCandidates(candidates);

      return {
        totalCandidates: consolidated.length,
        candidates: consolidated.map((c) => ({
          clientId: c.clientId,
          clientName: c.clientName,
          phone: c.whatsappNumber,
          stage: c.stage,
          totalDebt: c.totalDebt,
          titlesCount: c.titlesCount,
          maxDaysOverdue: c.maxDaysOverdue,
          hasPaymentLink: !!c.paymentLink,
        })),
      };
    }),

  // ── Executar régua ───────────────────────────────────────────────────────
  run: protectedProcedure
    .input(
      z.object({
        dryRun: z.boolean().default(true),
        limit: z.number().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await runRegua(input.dryRun, input.limit);

      return {
        runId: result.runId,
        dryRun: result.dryRun,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        totalCandidates: result.totalCandidates,
        sent: result.sent,
        skipped: result.skipped,
        errors: result.errors,
        dailyLimitReached: result.dailyLimitReached,
        entriesCount: result.entries.length,
      };
    }),

  // ── Histórico de execuções ───────────────────────────────────────────────
  history: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional().default(20) }))
    .query(async ({ input }) => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      try {
        const [rows] = await conn.execute(
          `SELECT 
             runId,
             dryRun,
             COUNT(*) AS totalEntries,
             SUM(status = 'sent') AS sent,
             SUM(status = 'skipped') AS skipped,
             SUM(status = 'error') AS errors,
             SUM(status = 'dry_run') AS dryRunCount,
             MIN(createdAt) AS startedAt,
             MAX(createdAt) AS finishedAt
           FROM regua_audit
           GROUP BY runId, dryRun
           ORDER BY startedAt DESC
           LIMIT ?`,
          [input.limit]
        );
        await conn.end();
        return { runs: rows as any[] };
      } catch (e) {
        await conn.end();
        throw e;
      }
    }),

  // ── Detalhes de uma execução ─────────────────────────────────────────────
  auditByRun: publicProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ input }) => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      try {
        const [rows] = await conn.execute(
          `SELECT 
             id, runId, clientId, receivableId, stage, dryRun, status,
             skipReason, phoneE164, totalDebt, titlesCount, maxDaysOverdue,
             providerMessageId, providerStatus, errorMessage, correlationId, sentAt, createdAt
           FROM regua_audit
           WHERE runId = ?
           ORDER BY createdAt ASC
           LIMIT 500`,
          [input.runId]
        );
        await conn.end();
        return { entries: rows as any[] };
      } catch (e) {
        await conn.end();
        throw e;
      }
    }),

  // ── Estatísticas por período ─────────────────────────────────────────────
  // GET /api/regua/stats?days=7
  stats: publicProcedure
    .input(z.object({ days: z.number().min(1).max(90).optional().default(7) }))
    .query(async ({ input }) => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      try {
        // Totais gerais no período
        const [totals] = await conn.execute(
          `SELECT 
             COUNT(*) AS total,
             SUM(status = 'sent') AS sent,
             SUM(status = 'skipped') AS skipped,
             SUM(status = 'error') AS errors,
             SUM(status = 'dry_run') AS dryRuns,
             COUNT(DISTINCT clientId) AS uniqueClients,
             COUNT(DISTINCT runId) AS totalRuns,
             COALESCE(SUM(CASE WHEN status = 'sent' THEN CAST(totalDebt AS DECIMAL(12,2)) ELSE 0 END), 0) AS totalDebtCobrado
           FROM regua_audit
           WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
          [input.days]
        );

        // Breakdown por etapa
        const [byStage] = await conn.execute(
          `SELECT 
             stage,
             COUNT(*) AS total,
             SUM(status = 'sent') AS sent,
             SUM(status = 'skipped') AS skipped,
             SUM(status = 'error') AS errors
           FROM regua_audit
           WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY stage
           ORDER BY FIELD(stage, 'd_minus_3', 'd_0', 'd_plus_3', 'd_plus_7', 'd_plus_15')`,
          [input.days]
        );

        // Breakdown por skipReason
        const [bySkipReason] = await conn.execute(
          `SELECT 
             skipReason,
             COUNT(*) AS count
           FROM regua_audit
           WHERE status = 'skipped'
             AND createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY skipReason
           ORDER BY count DESC`,
          [input.days]
        );

        // Envios por dia
        const [byDay] = await conn.execute(
          `SELECT 
             DATE(createdAt) AS day,
             SUM(status = 'sent') AS sent,
             SUM(status = 'skipped') AS skipped,
             SUM(status = 'error') AS errors
           FROM regua_audit
           WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY DATE(createdAt)
           ORDER BY day DESC`,
          [input.days]
        );

        await conn.end();

        return {
          period: `${input.days} dias`,
          totals: (totals as any[])[0],
          byStage: byStage as any[],
          bySkipReason: bySkipReason as any[],
          byDay: byDay as any[],
        };
      } catch (e) {
        await conn.end();
        throw e;
      }
    }),

  // ── Logs de auditoria recentes ───────────────────────────────────────────
  // GET /api/regua/logs?limit=50&status=sent|skipped|error
  logs: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).optional().default(50),
        status: z.enum(['sent', 'skipped', 'error', 'dry_run', 'all']).optional().default('all'),
        stage: z.enum(['d_minus_3', 'd_0', 'd_plus_3', 'd_plus_7', 'd_plus_15', 'all']).optional().default('all'),
        clientId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      try {
        let whereClause = '1=1';
        const params: any[] = [];

        if (input.status !== 'all') {
          whereClause += ' AND ra.status = ?';
          params.push(input.status);
        }

        if (input.stage !== 'all') {
          whereClause += ' AND ra.stage = ?';
          params.push(input.stage);
        }

        if (input.clientId) {
          whereClause += ' AND ra.clientId = ?';
          params.push(input.clientId);
        }

        params.push(input.limit);

        const [rows] = await conn.execute(
          `SELECT 
             ra.id, ra.runId, ra.clientId, ra.receivableId, ra.stage, ra.dryRun, ra.status,
             ra.skipReason, ra.phoneE164, ra.totalDebt, ra.titlesCount, ra.maxDaysOverdue,
             ra.providerMessageId, ra.providerStatus, ra.errorMessage, ra.correlationId,
             ra.sentAt, ra.createdAt,
             c.name AS clientName
           FROM regua_audit ra
           LEFT JOIN clients c ON c.id = ra.clientId
           WHERE ${whereClause}
           ORDER BY ra.createdAt DESC
           LIMIT ?`,
          params
        );

        await conn.end();
        return { logs: rows as any[], count: (rows as any[]).length };
      } catch (e) {
        await conn.end();
        throw e;
      }
    }),

  // ── Agendamento da Régua ─────────────────────────────────────────────────
  // Calcula próxima execução, lê última execução real e histórico
  scheduleStatus: publicProcedure.query(async () => {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      // ── Últimas 10 execuções (agrupadas por runId) ──────────────────────
      const [runRows] = await conn.execute<any[]>(`
        SELECT
          runId,
          MIN(createdAt) AS startedAt,
          MAX(createdAt) AS finishedAt,
          COUNT(*) AS total,
          SUM(CASE WHEN status='sent'    THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS skipped,
          SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) AS errors,
          SUM(CASE WHEN status='dry_run' THEN 1 ELSE 0 END) AS dryRun
        FROM regua_audit
        GROUP BY runId
        ORDER BY MAX(createdAt) DESC
        LIMIT 10
      `);

      // ── Top reasons do último runId ─────────────────────────────────────
      const lastRunId = runRows[0]?.runId ?? null;
      let topReasons: { reason: string; count: number }[] = [];
      if (lastRunId) {
        const [reasonRows] = await conn.execute<any[]>(
          `SELECT skipReason AS reason, COUNT(*) AS cnt
           FROM regua_audit
           WHERE runId = ? AND status = 'skipped' AND skipReason IS NOT NULL
           GROUP BY skipReason ORDER BY cnt DESC LIMIT 5`,
          [lastRunId]
        );
        topReasons = reasonRows.map((r: any) => ({ reason: r.reason, count: Number(r.cnt) }));
      }

      await conn.end();

      // ── Calcular próxima execução (07:30 seg-sex, America/Sao_Paulo) ────
      // Offset SP: UTC-3 (BRT) ou UTC-2 (BRST)
      const SP_OFFSET_MS = -3 * 60 * 60 * 1000; // BRT = UTC-3
      const nowUtc = Date.now();
      const nowSP = new Date(nowUtc + SP_OFFSET_MS);
      // Avançar até o próximo seg-sex às 07:30
      let nextRun = new Date(nowSP);
      nextRun.setHours(7, 30, 0, 0);
      // Se já passou das 07:30 hoje, avançar para amanhã
      if (nextRun <= nowSP) nextRun.setDate(nextRun.getDate() + 1);
      // Pular fins de semana
      while (nextRun.getDay() === 0 || nextRun.getDay() === 6) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      // Converter de volta para UTC
      const nextRunUtc = new Date(nextRun.getTime() - SP_OFFSET_MS);

      // ── Alerta: passou 15 min do horário previsto sem execução? ─────────
      const lastRunAt = runRows[0]?.finishedAt ? new Date(runRows[0].finishedAt) : null;
      const ALERT_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutos
      // Verifica se hoje é dia útil e já passou das 07:45 SP sem execução hoje
      const todaySP = new Date(nowUtc + SP_OFFSET_MS);
      const isWeekdayNow = todaySP.getDay() >= 1 && todaySP.getDay() <= 5;
      const pastTriggerTime = todaySP.getHours() > 7 || (todaySP.getHours() === 7 && todaySP.getMinutes() >= 45);
      const lastRunToday = lastRunAt
        ? new Date(lastRunAt.getTime() + SP_OFFSET_MS).toDateString() === todaySP.toDateString()
        : false;
      const lateAlert = isWeekdayNow && pastTriggerTime && !lastRunToday;

      // ── Montar histórico formatado ──────────────────────────────────────
      const history = (runRows as any[]).map((r: any) => ({
        runId: r.runId,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        total: Number(r.total),
        sent: Number(r.sent),
        skipped: Number(r.skipped),
        errors: Number(r.errors),
        dryRun: Number(r.dryRun),
      }));

      const lastRun = history[0] ?? null;

      return {
        cronExpression: '0 30 7 * * 1-5',
        cronDescription: 'Seg–Sex às 07:30 (America/Sao_Paulo)',
        enabled: process.env.REGUA_ENABLED !== 'false',
        allowRealSend: process.env.ALLOW_REAL_SEND === 'true',
        nextRunAt: nextRunUtc.toISOString(),
        lastRun,
        topReasons,
        history,
        lateAlert,
      };
    } catch (e) {
      await conn.end();
      throw e;
    }
  }),
});
