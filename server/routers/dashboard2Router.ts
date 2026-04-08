import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { runFullSync } from "../fullSyncRouter";
import { getDb } from "../db";
import { sql, and, gte, lte, eq, count, desc, isNotNull, ne, inArray } from "drizzle-orm";
import { clients, receivables, aiAssistantLog, reguaAudit, contaAzulTokens, alertSettings } from "../../drizzle/schema";
import mysql from "mysql2/promise";
import axios from "axios";

// ─── Raw SQL helper ──────────────────────────────────────────────────────────

async function rawQuery<T = any>(query: string, params: any[] = []): Promise<T[]> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows] = await conn.execute(query, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Calcula delta e percentual evitando NaN e divisão por zero */
function calcDelta(current: number, previous: number) {
  const delta = current - previous;
  const pct = previous > 0 ? (delta / previous) * 100 : current > 0 ? 100 : 0;
  return {
    delta: Math.round(delta * 100) / 100,
    pct: Math.round(pct * 10) / 10,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

/** Normaliza Date do MySQL para string ISO */
function toStr(v: any): string {
  if (!v) return "";
  if (typeof v === "object" && typeof v.toISOString === "function") return v.toISOString().slice(0, 10);
  return String(v);
}

// ─── WhatsApp alert helper ────────────────────────────────────────────────────

async function sendWhatsAppAlert(phone: string, message: string): Promise<void> {
  const apiKey = process.env.WHATSAPP_API_KEY;
  const apiUrl = process.env.ZAP_CONTABIL_API_URL;
  if (!apiKey || !apiUrl) return;
  try {
    await axios.post(
      `${apiUrl}/message/sendText`,
      { number: phone, text: message },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
    );
  } catch {
    // silently fail — alertas não devem quebrar o dashboard
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const dashboard2Router = router({

  // ── ABA OPERACIONAL ────────────────────────────────────────────────────────

  operacional: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const { days } = input;
      const since = daysAgo(days);
      const prevSince = daysAgo(days * 2);
      const prevUntil = daysAgo(days);
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Total clientes ativos
      const [activeRow] = await db
        .select({ total: count() })
        .from(clients)
        .where(eq(clients.status, "active"));
      const totalActive = activeRow?.total ?? 0;

      // Clientes com títulos em aberto (atual e anterior)
      const openClientsRows = await db
        .selectDistinct({ clientId: receivables.clientId })
        .from(receivables)
        .where(and(inArray(receivables.status, ["pending", "overdue"]), sql`CAST(${receivables.amount} AS DECIMAL) > 0`));
      const clientsWithOpen = openClientsRows.length;

      // Valor total em aberto
      const [openValueRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${receivables.amount} AS DECIMAL)), 0)` })
        .from(receivables)
        .where(and(inArray(receivables.status, ["pending", "overdue"]), sql`CAST(${receivables.amount} AS DECIMAL) > 0`));
      const totalOpen = Number(openValueRow?.total ?? 0);

      // Pagamentos totais do período (todos os pagamentos, com ou sem cobrança)
      const [totalPaidRow] = await rawQuery<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM receivables
         WHERE status = 'paid' AND paidDate >= ?`,
        [since.toISOString().slice(0, 10)]
      );
      const totalPaid = Number(totalPaidRow?.total ?? 0);

      // Recuperado via régua = paid + estava vencido + tinha collectionMessage enviado
      const [recoveredViaReguaRow] = await rawQuery<{ total: string }>(
        `SELECT COALESCE(SUM(r.amount), 0) AS total
         FROM receivables r
         WHERE r.status = 'paid'
           AND r.paidDate >= ?
           AND r.dueDate < r.paidDate
           AND EXISTS (
             SELECT 1 FROM collectionMessages cm
             WHERE cm.receivableId = r.id AND cm.status IN ('sent','delivered','read')
           )`,
        [since.toISOString().slice(0, 10)]
      );
      const recoveredViaRegua = Number(recoveredViaReguaRow?.total ?? 0);
      // Manter campo 'recovered' como alias para compatibilidade com comparativo
      const recovered = recoveredViaRegua;

      // Recuperado via régua — período anterior
      const [prevRecoveredRow] = await rawQuery<{ total: string }>(
        `SELECT COALESCE(SUM(r.amount), 0) AS total
         FROM receivables r
         WHERE r.status = 'paid'
           AND r.paidDate >= ? AND r.paidDate < ?
           AND r.dueDate < r.paidDate
           AND EXISTS (
             SELECT 1 FROM collectionMessages cm
             WHERE cm.receivableId = r.id AND cm.status IN ('sent','delivered','read')
           )`,
        [prevSince.toISOString().slice(0, 10), prevUntil.toISOString().slice(0, 10)]
      );
      const prevRecovered = Number(prevRecoveredRow?.total ?? 0);

      // Clientes inadimplentes período anterior (para comparativo)
      const prevOpenRows = await rawQuery<{ cnt: number }>(
        `SELECT COUNT(DISTINCT clientId) AS cnt FROM receivables
         WHERE status IN ('pending','overdue') AND amount > 0
           AND updatedAt >= ? AND updatedAt < ?`,
        [prevSince.toISOString().slice(0, 10), prevUntil.toISOString().slice(0, 10)]
      );
      const prevClientsWithOpen = Number(prevOpenRows[0]?.cnt ?? 0);

      // Taxa de recuperação
      const totalForRate = totalOpen + recovered;
      const recoveryRate = totalForRate > 0 ? (recovered / totalForRate) * 100 : 0;
      const prevTotalForRate = totalOpen + prevRecovered;
      const prevRecoveryRate = prevTotalForRate > 0 ? (prevRecovered / prevTotalForRate) * 100 : 0;

      // Ranking de clientes por valor em aberto (top 20)
      const rankingRows = await db
        .select({
          id: clients.id,
          name: clients.name,
          whatsappNumber: clients.whatsappNumber,
          titlesCount: count(receivables.id),
          totalDebt: sql<string>`COALESCE(SUM(CAST(${receivables.amount} AS DECIMAL)), 0)`,
          maxDaysOverdue: sql<number>`MAX(DATEDIFF(NOW(), ${receivables.dueDate}))`,
        })
        .from(receivables)
        .innerJoin(clients, eq(clients.id, receivables.clientId))
        .where(and(inArray(receivables.status, ["pending", "overdue"]), sql`CAST(${receivables.amount} AS DECIMAL) > 0`))
        .groupBy(clients.id, clients.name, clients.whatsappNumber)
        .orderBy(sql`SUM(CAST(${receivables.amount} AS DECIMAL)) DESC`)
        .limit(20);

      return {
        totalActive,
        clientsWithOpen,
        totalOpen,
        recovered,
        recoveredViaRegua,
        totalPaid,
        prevRecovered,
        recoveryRate: Math.round(recoveryRate * 10) / 10,
        comparativo: {
          recovered: calcDelta(recovered, prevRecovered),
          clientsWithOpen: calcDelta(clientsWithOpen, prevClientsWithOpen),
          recoveryRate: calcDelta(
            Math.round(recoveryRate * 10) / 10,
            Math.round(prevRecoveryRate * 10) / 10
          ),
        },
        ranking: await Promise.all(rankingRows.map(async r => {
          const [lastAudit] = await rawQuery<{ stage: string; sentAt: string }>(
            `SELECT stage, sentAt FROM regua_audit WHERE clientId = ? AND status = 'sent' ORDER BY createdAt DESC LIMIT 1`,
            [r.id]
          );
          const stageLabels: Record<string, string> = {
            d_minus_3: "D-3", d_0: "D0", d_plus_3: "D+3", d_plus_7: "D+7", d_plus_15: "D+15"
          };
          const stageDays: Record<string, number> = {
            d_minus_3: -3, d_0: 0, d_plus_3: 3, d_plus_7: 7, d_plus_15: 15
          };
          const stageOrder = ["d_minus_3", "d_0", "d_plus_3", "d_plus_7", "d_plus_15"];
          const currentStageIdx = lastAudit ? stageOrder.indexOf(lastAudit.stage) : -1;
          const nextStageKey = currentStageIdx >= 0 && currentStageIdx < stageOrder.length - 1
            ? stageOrder[currentStageIdx + 1] : null;
          let nextDispatchAt: string | null = null;
          if (nextStageKey && lastAudit) {
            const daysToNext = stageDays[nextStageKey] - (stageDays[lastAudit.stage] ?? 0);
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + Math.max(1, daysToNext));
            nextDispatchAt = nextDate.toISOString().slice(0, 10);
          }
          return {
            id: r.id,
            name: r.name,
            whatsappNumber: r.whatsappNumber,
            titlesCount: r.titlesCount,
            totalDebt: Number(r.totalDebt),
            maxDaysOverdue: Number(r.maxDaysOverdue ?? 0),
            reguaStage: lastAudit ? (stageLabels[lastAudit.stage] ?? lastAudit.stage) : null,
            lastDispatchAt: lastAudit?.sentAt ? toStr(lastAudit.sentAt) : null,
            nextDispatchAt,
          };
        })),
        period: { days, since: since.toISOString() },
      };
    }),

  // ── ABA FINANCEIRO ─────────────────────────────────────────────────────────

  financeiro: publicProcedure
    .input(z.object({ months: z.number().int().min(1).max(24).default(6) }))
    .query(async ({ input }) => {
      const { months } = input;
      const since = monthsAgo(months);
      const sinceStr = since.toISOString().slice(0, 10);
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Evolução mensal inadimplência
      const delinquencyRows = await rawQuery<{ month: string; count: number; total: string }>(
        `SELECT DATE_FORMAT(dueDate, '%Y-%m') AS month, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM receivables WHERE status IN ('pending', 'overdue') AND amount > 0 AND dueDate >= ?
         GROUP BY month ORDER BY month ASC`,
        [sinceStr]
      );

      // Evolução mensal recebíveis pagos
      const paidRows = await rawQuery<{ month: string; count: number; total: string }>(
        `SELECT DATE_FORMAT(updatedAt, '%Y-%m') AS month, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM receivables WHERE status = 'paid' AND updatedAt >= ?
         GROUP BY month ORDER BY month ASC`,
        [sinceStr]
      );

      // Ticket médio atual
      const [ticketRow] = await rawQuery<{ avg: string }>(
        `SELECT AVG(amount) AS avg FROM receivables WHERE status IN ('pending', 'overdue') AND amount > 0`
      );
      const ticketMedio = Number(ticketRow?.avg ?? 0);

      // Ticket médio período anterior (para comparativo)
      const prevSinceStr = monthsAgo(months * 2).toISOString().slice(0, 10);
      const [prevTicketRow] = await rawQuery<{ avg: string }>(
        `SELECT AVG(amount) AS avg FROM receivables
         WHERE status IN ('pending', 'overdue') AND amount > 0 AND updatedAt < ?`,
        [sinceStr]
      );
      const prevTicketMedio = Number(prevTicketRow?.avg ?? 0);

      // Total em aberto atual e anterior (para comparativo)
      const [totalOpenRow] = await rawQuery<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM receivables WHERE status IN ('pending','overdue') AND amount > 0`
      );
      const totalOpen = Number(totalOpenRow?.total ?? 0);

      // Distribuição por faixa de atraso
      const faixasRows = await rawQuery<{ faixa: string; count: number; total: string }>(
        `SELECT
          CASE
            WHEN DATEDIFF(NOW(), dueDate) BETWEEN 0 AND 7 THEN '0-7'
            WHEN DATEDIFF(NOW(), dueDate) BETWEEN 8 AND 15 THEN '8-15'
            WHEN DATEDIFF(NOW(), dueDate) BETWEEN 16 AND 30 THEN '16-30'
            ELSE '30+'
          END AS faixa,
          COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM receivables WHERE status IN ('pending', 'overdue') AND amount > 0 AND dueDate <= NOW()
         GROUP BY faixa`
      );

      // Drill-down top 100
      const drillDownRows = await rawQuery<{ id: number; name: string; amount: string; dueDate: string; status: string; daysOverdue: number; faixa: string }>(
        `SELECT c.id, c.name, r.amount, r.dueDate, r.status,
          DATEDIFF(NOW(), r.dueDate) AS daysOverdue,
          CASE
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 0 AND 7 THEN '0-7'
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 8 AND 15 THEN '8-15'
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 16 AND 30 THEN '16-30'
            ELSE '30+'
          END AS faixa
         FROM receivables r INNER JOIN clients c ON c.id = r.clientId
         WHERE r.status IN ('pending', 'overdue') AND r.amount > 0 AND r.dueDate <= NOW()
         ORDER BY r.amount DESC LIMIT 100`
      );

      return {
        delinquencyByMonth: delinquencyRows.map(r => ({ month: r.month, count: Number(r.count), total: Number(r.total) })),
        paidByMonth: paidRows.map(r => ({ month: r.month, count: Number(r.count), total: Number(r.total) })),
        ticketMedio: Math.round(ticketMedio * 100) / 100,
        totalOpen,
        comparativo: {
          ticketMedio: calcDelta(ticketMedio, prevTicketMedio),
        },
        faixas: faixasRows.map(r => ({ faixa: r.faixa, count: Number(r.count), total: Number(r.total) })),
        drillDown: drillDownRows.map(r => ({
          id: r.id, name: r.name, amount: Number(r.amount),
          dueDate: r.dueDate, status: r.status,
          daysOverdue: Number(r.daysOverdue ?? 0), faixa: r.faixa,
        })),
      };
    }),

  // ── ABA IA & AUTOMAÇÃO ─────────────────────────────────────────────────────

  iaAutomacao: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      const { days } = input;
      const since = daysAgo(days);
      const prevSince = daysAgo(days * 2);
      const prevUntil = daysAgo(days);
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Mensagens processadas hoje
      const [todayRow] = await db
        .select({ total: count() })
        .from(aiAssistantLog)
        .where(sql`DATE(${aiAssistantLog.createdAt}) = CURDATE()`);
      const processedToday = todayRow?.total ?? 0;

      // Stats do período atual
      const [totalRow] = await db.select({ total: count() }).from(aiAssistantLog).where(gte(aiAssistantLog.createdAt, since));
      const totalPeriod = totalRow?.total ?? 0;

      const [respondedRow] = await db.select({ total: count() }).from(aiAssistantLog)
        .where(and(gte(aiAssistantLog.createdAt, since), eq(aiAssistantLog.handoffToHuman, false)));
      const responded = respondedRow?.total ?? 0;

      const [handoffRow] = await db.select({ total: count() }).from(aiAssistantLog)
        .where(and(gte(aiAssistantLog.createdAt, since), eq(aiAssistantLog.handoffToHuman, true)));
      const transferredToHuman = handoffRow?.total ?? 0;

      // Stats do período anterior
      const [prevTotalRow] = await db.select({ total: count() }).from(aiAssistantLog)
        .where(and(gte(aiAssistantLog.createdAt, prevSince), lte(aiAssistantLog.createdAt, prevUntil)));
      const prevTotal = prevTotalRow?.total ?? 0;

      const [prevRespondedRow] = await db.select({ total: count() }).from(aiAssistantLog)
        .where(and(gte(aiAssistantLog.createdAt, prevSince), lte(aiAssistantLog.createdAt, prevUntil), eq(aiAssistantLog.handoffToHuman, false)));
      const prevResponded = prevRespondedRow?.total ?? 0;

      const resolvedByAIPct = totalPeriod > 0 ? (responded / totalPeriod) * 100 : 0;
      const transferredPct = totalPeriod > 0 ? (transferredToHuman / totalPeriod) * 100 : 0;
      const prevResolvedPct = prevTotal > 0 ? (prevResponded / prevTotal) * 100 : 0;

      // Intents mais frequentes
      const intentsRows = await db
        .select({ intent: aiAssistantLog.intent, count: count() })
        .from(aiAssistantLog)
        .where(and(gte(aiAssistantLog.createdAt, since), isNotNull(aiAssistantLog.intent), ne(aiAssistantLog.intent, "")))
        .groupBy(aiAssistantLog.intent)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(10);

      // Logs recentes (últimos 50)
      const logsRows = await db
        .select({
          id: aiAssistantLog.id,
          fromPhone: aiAssistantLog.fromPhone,
          clientId: aiAssistantLog.clientId,
          intent: aiAssistantLog.intent,
          response: aiAssistantLog.response,
          handoffToHuman: aiAssistantLog.handoffToHuman,
          handoffReason: aiAssistantLog.handoffReason,
          correlationId: aiAssistantLog.correlationId,
          createdAt: aiAssistantLog.createdAt,
          clientName: clients.name,
        })
        .from(aiAssistantLog)
        .leftJoin(clients, eq(clients.id, aiAssistantLog.clientId))
        .where(gte(aiAssistantLog.createdAt, since))
        .orderBy(desc(aiAssistantLog.createdAt))
        .limit(50);

      // Evolução diária (últimos 7 dias)
      const sevenDaysAgoStr = daysAgo(7).toISOString().slice(0, 10);
      const dailyRows = await rawQuery<{ day: string; total: number; responded: number; handoff: number }>(
        `SELECT DATE(createdAt) AS day, COUNT(*) AS total,
          SUM(CASE WHEN handoffToHuman = 0 THEN 1 ELSE 0 END) AS responded,
          SUM(CASE WHEN handoffToHuman = 1 THEN 1 ELSE 0 END) AS handoff
         FROM ai_assistant_log WHERE createdAt >= ?
         GROUP BY day ORDER BY day ASC`,
        [sevenDaysAgoStr]
      );

      return {
        processedToday,
        period: {
          days, total: totalPeriod, responded, transferredToHuman,
          resolvedByAI: Math.round(resolvedByAIPct * 10) / 10,
          transferredPct: Math.round(transferredPct * 10) / 10,
        },
        comparativo: {
          total: calcDelta(totalPeriod, prevTotal),
          resolvedByAI: calcDelta(
            Math.round(resolvedByAIPct * 10) / 10,
            Math.round(prevResolvedPct * 10) / 10
          ),
        },
        intents: intentsRows.map(r => ({ intent: r.intent, count: r.count })),
        logs: logsRows.map(r => ({
          id: r.id, fromPhone: r.fromPhone, clientId: r.clientId,
          intent: r.intent, response: r.response, handoffToHuman: r.handoffToHuman,
          handoffReason: r.handoffReason, correlationId: r.correlationId,
          createdAt: r.createdAt, clientName: r.clientName ?? null,
        })),
        daily: dailyRows.map(r => ({
          day: toStr(r.day),
          total: Number(r.total),
          responded: Number(r.responded ?? 0),
          handoff: Number(r.handoff ?? 0),
        })),
      };
    }),

  // ── ABA TÉCNICO ────────────────────────────────────────────────────────────

  tecnico: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Status OAuth Conta Azul
    let oauthData: { expiresAt: Date | null; updatedAt: Date } | null = null;
    let oauthValid = false;
    try {
      const [row] = await db
        .select({ expiresAt: contaAzulTokens.expiresAt, updatedAt: contaAzulTokens.updatedAt })
        .from(contaAzulTokens)
        .orderBy(desc(contaAzulTokens.updatedAt))
        .limit(1);
      if (row) { oauthData = row; oauthValid = row.expiresAt ? new Date(row.expiresAt) > new Date() : false; }
    } catch { /* tabela pode não existir */ }

    // Sync recente
    const syncRows = await rawQuery<{ day: string; paid: number; cancelled: number; lastRun: string }>(
      `SELECT DATE(updatedAt) AS day,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        MAX(updatedAt) AS lastRun
       FROM receivables WHERE updatedAt >= ? AND status IN ('paid', 'cancelled')
       GROUP BY day ORDER BY day DESC LIMIT 7`,
      [daysAgo(7).toISOString().slice(0, 10)]
    );

    // Status Régua (últimos 7 dias)
    const [reguaRow] = await db
      .select({
        total: count(),
        sent: sql<number>`SUM(CASE WHEN ${reguaAudit.status} = 'sent' THEN 1 ELSE 0 END)`,
        skipped: sql<number>`SUM(CASE WHEN ${reguaAudit.status} = 'skipped' THEN 1 ELSE 0 END)`,
        errors: sql<number>`SUM(CASE WHEN ${reguaAudit.status} = 'error' THEN 1 ELSE 0 END)`,
        lastRun: sql<Date>`MAX(${reguaAudit.createdAt})`,
      })
      .from(reguaAudit)
      .where(gte(reguaAudit.createdAt, daysAgo(7)));

    const envStatus = {
      REGUA_ENABLED: process.env.REGUA_ENABLED ?? "false",
      REGUA_DAILY_LIMIT: process.env.REGUA_DAILY_LIMIT ?? "50",
      REGUA_ALLOWED_STAGES: process.env.REGUA_ALLOWED_STAGES ?? "d_plus_7,d_plus_15",
      REGUA_QUIET_HOURS: process.env.REGUA_QUIET_HOURS ?? "18:00-08:00",
      REGUA_BUSINESS_DAYS_ONLY: process.env.REGUA_BUSINESS_DAYS_ONLY ?? "true",
      REGUA_RATE_LIMIT_HOURS: process.env.REGUA_RATE_LIMIT_HOURS ?? "12",
      ENABLE_SYNC_PAYMENTS_JOB: process.env.ENABLE_SYNC_PAYMENTS_JOB ?? "false",
      ALLOW_REAL_SEND: process.env.ALLOW_REAL_SEND ?? "false",
      ALLOW_CRON_ENABLE: process.env.ALLOW_CRON_ENABLE ?? "false",
      INBOUND_AI_ENABLED: process.env.INBOUND_AI_ENABLED ?? "false",
      WHATSAPP_AI_WHITELIST:
        process.env.WHATSAPP_AI_WHITELIST === "*" ? "*"
        : process.env.WHATSAPP_AI_WHITELIST ? "***" : "não definido",
    };

    // Erros recentes de IA
    const recentErrors = await db
      .select({
        id: aiAssistantLog.id, fromPhone: aiAssistantLog.fromPhone,
        intent: aiAssistantLog.intent, handoffReason: aiAssistantLog.handoffReason,
        createdAt: aiAssistantLog.createdAt,
      })
      .from(aiAssistantLog)
      .where(and(gte(aiAssistantLog.createdAt, daysAgo(7)), eq(aiAssistantLog.handoffToHuman, true)))
      .orderBy(desc(aiAssistantLog.createdAt))
      .limit(20);

    return {
      oauth: { valid: oauthValid, expiresAt: oauthData?.expiresAt ?? null, lastUpdated: oauthData?.updatedAt ?? null },
      sync: {
        recentDays: syncRows.map(r => ({
          day: toStr(r.day),
          paid: Number(r.paid ?? 0),
          cancelled: Number(r.cancelled ?? 0),
          lastRun: toStr(r.lastRun),
        })),
      },
      regua: {
        total: reguaRow?.total ?? 0,
        sent: Number(reguaRow?.sent ?? 0),
        skipped: Number(reguaRow?.skipped ?? 0),
        errors: Number(reguaRow?.errors ?? 0),
        lastRun: reguaRow?.lastRun ?? null,
      },
      envStatus,
      recentHandoffs: recentErrors.map(r => ({
        id: r.id, fromPhone: r.fromPhone, intent: r.intent,
        handoffReason: r.handoffReason, createdAt: r.createdAt,
      })),
    };
  }),

  // ── DRILL-DOWN por faixa de atraso ─────────────────────────────────────────

  drillDownFaixa: publicProcedure
    .input(z.object({ faixa: z.enum(["0-7", "8-15", "16-30", "30+"]) }))
    .query(async ({ input }) => {
      const { faixa } = input;
      let minDays = 0, maxDays = 7;
      if (faixa === "0-7") { minDays = 0; maxDays = 7; }
      else if (faixa === "8-15") { minDays = 8; maxDays = 15; }
      else if (faixa === "16-30") { minDays = 16; maxDays = 30; }
      else { minDays = 31; maxDays = 9999; }

      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select({
          id: clients.id, name: clients.name, whatsappNumber: clients.whatsappNumber,
          receivableId: receivables.id, amount: receivables.amount,
          dueDate: receivables.dueDate, status: receivables.status,
          daysOverdue: sql<number>`DATEDIFF(NOW(), ${receivables.dueDate})`,
        })
        .from(receivables)
        .innerJoin(clients, eq(clients.id, receivables.clientId))
        .where(and(
          inArray(receivables.status, ["pending", "overdue"]),
          sql`CAST(${receivables.amount} AS DECIMAL) > 0`,
          sql`${receivables.dueDate} <= NOW()`,
          sql`DATEDIFF(NOW(), ${receivables.dueDate}) >= ${minDays}`,
          sql`DATEDIFF(NOW(), ${receivables.dueDate}) <= ${maxDays}`
        ))
        .orderBy(sql`CAST(${receivables.amount} AS DECIMAL) DESC`)
        .limit(100);

      return rows.map(r => ({
        id: r.id, name: r.name, whatsappNumber: r.whatsappNumber,
        receivableId: r.receivableId, amount: Number(r.amount),
        dueDate: r.dueDate, status: r.status,
        daysOverdue: Number(r.daysOverdue ?? 0),
      }));
    }),

  // ── ALERTAS WhatsApp para gestor ───────────────────────────────────────────

  checkAlerts: publicProcedure
    .input(z.object({ currentOpen: z.number(), prevOpen: z.number().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { sent: 0 };

      const settings = await db
        .select()
        .from(alertSettings)
        .where(eq(alertSettings.enabled, true));

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      let sent = 0;

      for (const setting of settings) {
        // Rate limit: 1 alerta por dia por tipo
        if (setting.lastSentAt && new Date(setting.lastSentAt) > oneDayAgo) continue;

        let shouldSend = false;
        let message = "";

        if (setting.alertType === "open_value_threshold") {
          const threshold = Number(setting.threshold);
          if (input.currentOpen >= threshold) {
            shouldSend = true;
            message = `🚨 *Alerta Fraga Contabilidade*\n\nValor em aberto atingiu *R$ ${input.currentOpen.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}*, acima do limite configurado de R$ ${threshold.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.\n\n_${new Date().toLocaleString("pt-BR")}_`;
          }
        } else if (setting.alertType === "open_value_increase" && input.prevOpen && input.prevOpen > 0) {
          const pctIncrease = ((input.currentOpen - input.prevOpen) / input.prevOpen) * 100;
          const threshold = Number(setting.threshold);
          if (pctIncrease >= threshold) {
            shouldSend = true;
            message = `📈 *Alerta Fraga Contabilidade*\n\nValor em aberto subiu *${pctIncrease.toFixed(1)}%* vs período anterior (acima do limite de ${threshold}%).\n\nAtual: R$ ${input.currentOpen.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\nAnterior: R$ ${input.prevOpen.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n\n_${new Date().toLocaleString("pt-BR")}_`;
          }
        }

        if (shouldSend) {
          await sendWhatsAppAlert(setting.phone, message);
          await db.update(alertSettings)
            .set({ lastSentAt: now })
            .where(eq(alertSettings.id, setting.id));
          sent++;
        }
      }

      return { sent };
    }),

  // ── CONFIGURAÇÕES DE ALERTAS ───────────────────────────────────────────────

  getAlertSettings: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(alertSettings).orderBy(alertSettings.alertType);
  }),

  updateAlertSetting: protectedProcedure
    .input(z.object({
      id: z.number(),
      threshold: z.number().optional(),
      phone: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { id, ...updates } = input;
      await db.update(alertSettings).set(updates as any).where(eq(alertSettings.id, id));
      return { ok: true };
    }),

  // ── EXPORT DATA (para PDF gerado no frontend) ──────────────────────────────

  exportData: publicProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const { days } = input;
      const since = daysAgo(days);
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // KPIs
      const [activeRow] = await db.select({ total: count() }).from(clients).where(eq(clients.status, "active"));
      const [openValueRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${receivables.amount} AS DECIMAL)), 0)` })
        .from(receivables)
        .where(and(inArray(receivables.status, ["pending", "overdue"]), sql`CAST(${receivables.amount} AS DECIMAL) > 0`));
      const [recoveredRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${receivables.amount} AS DECIMAL)), 0)` })
        .from(receivables)
        .where(and(eq(receivables.status, "paid"), gte(receivables.updatedAt, since)));

      const totalOpen = Number(openValueRow?.total ?? 0);
      const recovered = Number(recoveredRow?.total ?? 0);
      const totalForRate = totalOpen + recovered;
      const recoveryRate = totalForRate > 0 ? (recovered / totalForRate) * 100 : 0;

      // Ranking top 20
      const rankingRows = await db
        .select({
          id: clients.id, name: clients.name, whatsappNumber: clients.whatsappNumber,
          titlesCount: count(receivables.id),
          totalDebt: sql<string>`COALESCE(SUM(CAST(${receivables.amount} AS DECIMAL)), 0)`,
          maxDaysOverdue: sql<number>`MAX(DATEDIFF(NOW(), ${receivables.dueDate}))`,
        })
        .from(receivables)
        .innerJoin(clients, eq(clients.id, receivables.clientId))
        .where(and(inArray(receivables.status, ["pending", "overdue"]), sql`CAST(${receivables.amount} AS DECIMAL) > 0`))
        .groupBy(clients.id, clients.name, clients.whatsappNumber)
        .orderBy(sql`SUM(CAST(${receivables.amount} AS DECIMAL)) DESC`)
        .limit(20);

      // Faixas de atraso
      const faixasRows = await rawQuery<{ faixa: string; count: number; total: string }>(
        `SELECT CASE
            WHEN DATEDIFF(NOW(), dueDate) BETWEEN 0 AND 7 THEN '0-7'
            WHEN DATEDIFF(NOW(), dueDate) BETWEEN 8 AND 15 THEN '8-15'
            WHEN DATEDIFF(NOW(), dueDate) BETWEEN 16 AND 30 THEN '16-30'
            ELSE '30+'
          END AS faixa, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM receivables WHERE status IN ('pending', 'overdue') AND amount > 0 AND dueDate <= NOW()
         GROUP BY faixa`
      );

      return {
        generatedAt: new Date().toISOString(),
        period: { days, since: since.toISOString() },
        kpis: {
          totalActive: activeRow?.total ?? 0,
          totalOpen,
          recovered,
          recoveryRate: Math.round(recoveryRate * 10) / 10,
        },
        ranking: rankingRows.map(r => ({
          name: r.name, titlesCount: r.titlesCount,
          totalDebt: Number(r.totalDebt), maxDaysOverdue: Number(r.maxDaysOverdue ?? 0),
        })),
        faixas: faixasRows.map(r => ({ faixa: r.faixa, count: Number(r.count), total: Number(r.total) })),
      };
    }),

  // ── FULL SYNC CONTA AZUL ───────────────────────────────────────────────────

  fullSync: protectedProcedure
    .input(z.object({ days: z.number().int().min(30).max(365).default(180) }))
    .mutation(async ({ input }) => {
      const result = await runFullSync(input.days);
      return {
        success: true,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        total: result.total,
        errors: result.errors,
      };
    }),
});
