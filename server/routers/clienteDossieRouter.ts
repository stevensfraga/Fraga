/**
 * Dossiê do Cliente — tela executiva com resumo, títulos, timeline e ações
 * Acessível em /cliente/:id
 */
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sql, and, eq, desc, inArray, gte, lte } from "drizzle-orm";
import {
  clients,
  receivables,
  collectionMessages,
  reguaAudit,
  aiAssistantLog,
  inboundMessages,
  legalCases,
} from "../../drizzle/schema";
import mysql from "mysql2/promise";
import { buildReguaMessage, sendReguaMessage, saveReguaAudit, ReguaStage } from "../services/reguaCobrancaService";
import { v4 as uuidv4 } from "uuid";

async function rawQuery<T = any>(query: string, params: any[] = []): Promise<T[]> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows] = await conn.execute(query, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

function toStr(v: any): string {
  if (!v) return "";
  if (typeof v === "object" && typeof v.toISOString === "function") return v.toISOString();
  return String(v);
}

export const clienteDossieRouter = router({
  // ── RESUMO DO CLIENTE ──────────────────────────────────────────────────────
  resumo: publicProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Dados básicos do cliente
      const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.id, input.clientId))
        .limit(1);
      if (!client) throw new Error("Cliente não encontrado");

      // Títulos em aberto
      const openRows = await db
        .select({
          count: sql<number>`COUNT(*)`,
          total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL)), 0)`,
          maxDaysOverdue: sql<number>`MAX(DATEDIFF(NOW(), dueDate))`,
        })
        .from(receivables)
        .where(
          and(
            eq(receivables.clientId, input.clientId),
            inArray(receivables.status, ["pending", "overdue"]),
            sql`CAST(amount AS DECIMAL) > 0`
          )
        );

      const openCount = Number(openRows[0]?.count ?? 0);
      const totalOpen = Number(openRows[0]?.total ?? 0);
      const maxDaysOverdue = Number(openRows[0]?.maxDaysOverdue ?? 0);

      // Estágio atual da régua (último registro de reguaAudit com status=sent)
      const [lastReguaRow] = await rawQuery<{ stage: string; sentAt: string; totalDebt: string }>(
        `SELECT stage, sentAt, totalDebt FROM regua_audit
         WHERE clientId = ? AND status = 'sent'
         ORDER BY createdAt DESC LIMIT 1`,
        [input.clientId]
      );

      // Último disparo (collectionMessages)
      const [lastDispatch] = await rawQuery<{ sentAt: string; messageType: string; status: string }>(
        `SELECT sentAt, messageType, status FROM collectionMessages
         WHERE clientId = ? ORDER BY sentAt DESC LIMIT 1`,
        [input.clientId]
      );

      // Próximo disparo previsto (baseado no stage atual)
      const stageOrder = ["d_minus_3", "d_0", "d_plus_3", "d_plus_7", "d_plus_15"];
      const currentStageIdx = lastReguaRow ? stageOrder.indexOf(lastReguaRow.stage) : -1;
      const nextStage = currentStageIdx >= 0 && currentStageIdx < stageOrder.length - 1
        ? stageOrder[currentStageIdx + 1]
        : null;

      return {
        id: client.id,
        name: client.name,
        document: client.document,
        whatsappNumber: client.whatsappNumber,
        whatsappSource: client.whatsappSource,
        optOut: client.optOut,
        status: client.status,
        email: client.email,
        cnae: client.cnae,
        openCount,
        totalOpen,
        maxDaysOverdue,
        reguaStage: lastReguaRow?.stage ?? null,
        lastDispatchAt: lastDispatch?.sentAt ? toStr(lastDispatch.sentAt) : null,
        lastDispatchType: lastDispatch?.messageType ?? null,
        nextStage,
        createdAt: toStr(client.createdAt),
        updatedAt: toStr(client.updatedAt),
      };
    }),

  // ── TÍTULOS DO CLIENTE ─────────────────────────────────────────────────────
  titulos: publicProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await rawQuery<{
        id: number;
        contaAzulId: string;
        amount: string;
        dueDate: string;
        paidDate: string | null;
        status: string;
        description: string | null;
        link: string | null;
        linhaDigitavel: string | null;
        paymentLinkCanonical: string | null;
        pdfStorageUrl: string | null;
        dispatchCount: number;
        lastDispatchedAt: string | null;
        daysOverdue: number;
      }>(
        `SELECT id, contaAzulId, amount, dueDate, paidDate, status, description,
                link, linhaDigitavel, paymentLinkCanonical, pdfStorageUrl,
                dispatchCount, lastDispatchedAt,
                DATEDIFF(NOW(), dueDate) AS daysOverdue
         FROM receivables
         WHERE clientId = ?
         ORDER BY dueDate DESC`,
        [input.clientId]
      );

      return rows.map(r => ({
        id: r.id,
        contaAzulId: r.contaAzulId,
        amount: Number(r.amount),
        dueDate: toStr(r.dueDate),
        paidDate: r.paidDate ? toStr(r.paidDate) : null,
        status: r.status,
        description: r.description,
        link: r.paymentLinkCanonical ?? r.link,
        linhaDigitavel: r.linhaDigitavel,
        pdfStorageUrl: r.pdfStorageUrl,
        dispatchCount: Number(r.dispatchCount ?? 0),
        lastDispatchedAt: r.lastDispatchedAt ? toStr(r.lastDispatchedAt) : null,
        daysOverdue: Number(r.daysOverdue ?? 0),
      }));
    }),

  // ── TIMELINE DE COBRANÇA ───────────────────────────────────────────────────
  timeline: publicProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      // Disparos da régua
      const reguaRows = await rawQuery<{
        id: number;
        runId: string;
        stage: string;
        status: string;
        skipReason: string | null;
        phoneE164: string | null;
        totalDebt: string | null;
        titlesCount: number | null;
        maxDaysOverdue: number | null;
        providerMessageId: string | null;
        providerStatus: string | null;
        errorMessage: string | null;
        correlationId: string | null;
        sentAt: string | null;
        createdAt: string;
        dryRun: number;
      }>(
        `SELECT id, runId, stage, status, skipReason, phoneE164, totalDebt, titlesCount,
                maxDaysOverdue, providerMessageId, providerStatus, errorMessage,
                correlationId, sentAt, createdAt, dryRun
         FROM regua_audit WHERE clientId = ?
         ORDER BY createdAt DESC LIMIT 100`,
        [input.clientId]
      );

      // Mensagens de cobrança (collectionMessages)
      const collectionRows = await rawQuery<{
        id: number;
        receivableId: number | null;
        messageType: string;
        status: string;
        outcome: string;
        sentAt: string | null;
        responseReceived: number;
        responseText: string | null;
        responseDate: string | null;
        whatsappMessageId: string | null;
        createdAt: string;
      }>(
        `SELECT id, receivableId, messageType, status, outcome, sentAt,
                responseReceived, responseText, responseDate, whatsappMessageId, createdAt
         FROM collectionMessages WHERE clientId = ?
         ORDER BY createdAt DESC LIMIT 100`,
        [input.clientId]
      );

      // Mensagens inbound do cliente
      const inboundRows = await rawQuery<{
        id: number;
        fromPhone: string;
        text: string;
        messageId: string | null;
        processed: number;
        createdAt: string;
      }>(
        `SELECT id, fromPhone, text, messageId, processed, createdAt
         FROM inbound_messages WHERE clientId = ?
         ORDER BY createdAt DESC LIMIT 50`,
        [input.clientId]
      );

      // Logs da IA
      const aiRows = await rawQuery<{
        id: number;
        intent: string;
        response: string;
        handoffToHuman: number;
        handoffReason: string | null;
        correlationId: string | null;
        createdAt: string;
      }>(
        `SELECT id, intent, response, handoffToHuman, handoffReason, correlationId, createdAt
         FROM ai_assistant_log WHERE clientId = ?
         ORDER BY createdAt DESC LIMIT 50`,
        [input.clientId]
      );

      // Unificar e ordenar por data
      type TimelineEvent = {
        type: "regua" | "collection" | "inbound" | "ai";
        id: number;
        createdAt: string;
        data: Record<string, any>;
      };

      const events: TimelineEvent[] = [
        ...reguaRows.map(r => ({
          type: "regua" as const,
          id: r.id,
          createdAt: toStr(r.createdAt),
          data: {
            stage: r.stage,
            status: r.status,
            skipReason: r.skipReason,
            totalDebt: r.totalDebt ? Number(r.totalDebt) : null,
            titlesCount: r.titlesCount,
            maxDaysOverdue: r.maxDaysOverdue,
            providerMessageId: r.providerMessageId,
            providerStatus: r.providerStatus,
            errorMessage: r.errorMessage,
            correlationId: r.correlationId,
            sentAt: r.sentAt ? toStr(r.sentAt) : null,
            dryRun: Boolean(r.dryRun),
          },
        })),
        ...collectionRows.map(r => ({
          type: "collection" as const,
          id: r.id,
          createdAt: toStr(r.createdAt),
          data: {
            receivableId: r.receivableId,
            messageType: r.messageType,
            status: r.status,
            outcome: r.outcome,
            sentAt: r.sentAt ? toStr(r.sentAt) : null,
            responseReceived: Boolean(r.responseReceived),
            responseText: r.responseText,
            responseDate: r.responseDate ? toStr(r.responseDate) : null,
            whatsappMessageId: r.whatsappMessageId,
          },
        })),
        ...inboundRows.map(r => ({
          type: "inbound" as const,
          id: r.id,
          createdAt: toStr(r.createdAt),
          data: {
            fromPhone: r.fromPhone,
            text: r.text,
            messageId: r.messageId,
            processed: Boolean(r.processed),
          },
        })),
        ...aiRows.map(r => ({
          type: "ai" as const,
          id: r.id,
          createdAt: toStr(r.createdAt),
          data: {
            intent: r.intent,
            response: r.response,
            handoffToHuman: Boolean(r.handoffToHuman),
            handoffReason: r.handoffReason,
            correlationId: r.correlationId,
          },
        })),
      ];

      // Ordenar por data decrescente
      events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return events.slice(0, 200);
    }),

  // ── BUSCA DE CLIENTES (para autocomplete) ─────────────────────────────────
  buscar: publicProcedure
    .input(z.object({ q: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const rows = await rawQuery<{
        id: number;
        name: string;
        document: string | null;
        whatsappNumber: string | null;
        optOut: number;
        status: string;
        totalOpen: string;
        openCount: number;
      }>(
        `SELECT c.id, c.name, c.document, c.whatsappNumber, c.optOut, c.status,
                COALESCE(SUM(CASE WHEN r.status IN ('pending','overdue') THEN r.amount ELSE 0 END), 0) AS totalOpen,
                COUNT(CASE WHEN r.status IN ('pending','overdue') THEN 1 END) AS openCount
         FROM clients c
         LEFT JOIN receivables r ON r.clientId = c.id
         WHERE c.name LIKE ? OR c.document LIKE ?
         GROUP BY c.id
         ORDER BY totalOpen DESC
         LIMIT ?`,
        [`%${input.q}%`, `%${input.q}%`, input.limit]
      );

      return rows.map(r => ({
        id: r.id,
        name: r.name,
        document: r.document,
        whatsappNumber: r.whatsappNumber,
        optOut: Boolean(r.optOut),
        status: r.status,
        totalOpen: Number(r.totalOpen),
        openCount: Number(r.openCount ?? 0),
      }));
    }),

  // ── LISTA COMPLETA DE CLIENTES ATIVOS ─────────────────────────────────────
  listaAtivos: publicProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
      somenteSemWhatsapp: z.boolean().default(false),
      somenteOptOut: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const conditions: string[] = ["c.status = 'active'"];
      const params: any[] = [];

      if (input.somenteSemWhatsapp) conditions.push("(c.whatsappNumber IS NULL OR c.whatsappNumber = '')");
      if (input.somenteOptOut) conditions.push("c.optOut = 1");

      const where = conditions.join(" AND ");

      const rows = await rawQuery<{
        id: number;
        name: string;
        document: string | null;
        whatsappNumber: string | null;
        optOut: number;
        status: string;
        totalOpen: string;
        openCount: number;
        lastDispatchedAt: string | null;
        updatedAt: string;
      }>(
        `SELECT c.id, c.name, c.document, c.whatsappNumber, c.optOut, c.status,
                COALESCE(SUM(CASE WHEN r.status IN ('pending','overdue') THEN r.amount ELSE 0 END), 0) AS totalOpen,
                COUNT(CASE WHEN r.status IN ('pending','overdue') THEN 1 END) AS openCount,
                MAX(r.lastDispatchedAt) AS lastDispatchedAt,
                c.updatedAt
         FROM clients c
         LEFT JOIN receivables r ON r.clientId = c.id
         WHERE ${where}
         GROUP BY c.id
         ORDER BY totalOpen DESC
         LIMIT ? OFFSET ?`,
        [...params, input.pageSize, offset]
      );

      const [countRow] = await rawQuery<{ total: number }>(
        `SELECT COUNT(*) AS total FROM clients c WHERE ${where}`,
        params
      );

      return {
        items: rows.map(r => ({
          id: r.id,
          name: r.name,
          document: r.document,
          whatsappNumber: r.whatsappNumber,
          optOut: Boolean(r.optOut),
          status: r.status,
          totalOpen: Number(r.totalOpen),
          openCount: Number(r.openCount ?? 0),
          lastDispatchedAt: r.lastDispatchedAt ? toStr(r.lastDispatchedAt) : null,
          updatedAt: toStr(r.updatedAt),
        })),
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── LISTA DE INADIMPLENTES (drill-down) ───────────────────────────────────
  listaInadimplentes: publicProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.pageSize;

      const rows = await rawQuery<{
        id: number;
        name: string;
        document: string | null;
        whatsappNumber: string | null;
        optOut: number;
        totalDebt: string;
        titlesCount: number;
        maxDaysOverdue: number;
        lastDispatchedAt: string | null;
        reguaStage: string | null;
      }>(
        `SELECT c.id, c.name, c.document, c.whatsappNumber, c.optOut,
                COALESCE(SUM(r.amount), 0) AS totalDebt,
                COUNT(r.id) AS titlesCount,
                MAX(DATEDIFF(NOW(), r.dueDate)) AS maxDaysOverdue,
                MAX(r.lastDispatchedAt) AS lastDispatchedAt,
                (SELECT stage FROM regua_audit ra
                 WHERE ra.clientId = c.id AND ra.status = 'sent'
                 ORDER BY ra.createdAt DESC LIMIT 1) AS reguaStage
         FROM clients c
         INNER JOIN receivables r ON r.clientId = c.id
         WHERE r.status IN ('pending','overdue') AND r.amount > 0
         GROUP BY c.id
         ORDER BY totalDebt DESC
         LIMIT ? OFFSET ?`,
        [input.pageSize, offset]
      );

      const [countRow] = await rawQuery<{ total: number }>(
        `SELECT COUNT(DISTINCT c.id) AS total
         FROM clients c
         INNER JOIN receivables r ON r.clientId = c.id
         WHERE r.status IN ('pending','overdue') AND r.amount > 0`
      );

      return {
        items: rows.map(r => ({
          id: r.id,
          name: r.name,
          document: r.document,
          whatsappNumber: r.whatsappNumber,
          optOut: Boolean(r.optOut),
          totalDebt: Number(r.totalDebt),
          titlesCount: Number(r.titlesCount ?? 0),
          maxDaysOverdue: Number(r.maxDaysOverdue ?? 0),
          lastDispatchedAt: r.lastDispatchedAt ? toStr(r.lastDispatchedAt) : null,
          reguaStage: r.reguaStage ?? null,
        })),
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── LISTA DE TÍTULOS EM ABERTO (drill-down) ────────────────────────────────
  listaTitulosAbertos: publicProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
      faixa: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const faixaFilter = input.faixa
        ? `AND CASE
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 0 AND 7 THEN '0-7'
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 8 AND 15 THEN '8-15'
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 16 AND 30 THEN '16-30'
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '90+'
          END = ?`
        : "";
      const params: any[] = input.faixa ? [input.faixa] : [];

      const rows = await rawQuery<{
        id: number;
        clientId: number;
        clientName: string;
        amount: string;
        dueDate: string;
        status: string;
        daysOverdue: number;
        link: string | null;
        linhaDigitavel: string | null;
        dispatchCount: number;
        lastDispatchedAt: string | null;
        faixa: string;
      }>(
        `SELECT r.id, r.clientId, c.name AS clientName, r.amount, r.dueDate,
                r.status, DATEDIFF(NOW(), r.dueDate) AS daysOverdue,
                COALESCE(r.paymentLinkCanonical, r.link) AS link,
                r.linhaDigitavel, r.dispatchCount, r.lastDispatchedAt,
                CASE
                  WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 0 AND 7 THEN '0-7'
                  WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 8 AND 15 THEN '8-15'
                  WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 16 AND 30 THEN '16-30'
                  WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 31 AND 60 THEN '31-60'
                  WHEN DATEDIFF(NOW(), r.dueDate) BETWEEN 61 AND 90 THEN '61-90'
                  ELSE '90+'
                END AS faixa
         FROM receivables r
         INNER JOIN clients c ON c.id = r.clientId
         WHERE r.status IN ('pending','overdue') AND r.amount > 0
         ${faixaFilter}
         ORDER BY r.amount DESC
         LIMIT ? OFFSET ?`,
        [...params, input.pageSize, offset]
      );

      const [countRow] = await rawQuery<{ total: number }>(
        `SELECT COUNT(*) AS total FROM receivables r
         WHERE r.status IN ('pending','overdue') AND r.amount > 0
         ${faixaFilter}`,
        params
      );

      return {
        items: rows.map(r => ({
          id: r.id,
          clientId: r.clientId,
          clientName: r.clientName,
          amount: Number(r.amount),
          dueDate: toStr(r.dueDate),
          status: r.status,
          daysOverdue: Number(r.daysOverdue ?? 0),
          link: r.link,
          linhaDigitavel: r.linhaDigitavel,
          dispatchCount: Number(r.dispatchCount ?? 0),
          lastDispatchedAt: r.lastDispatchedAt ? toStr(r.lastDispatchedAt) : null,
          faixa: r.faixa,
        })),
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── RECUPERADO VIA RÉGUA (drill-down) ─────────────────────────────────────
  listaRecuperadoRegua: publicProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).default(30),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      const sinceStr = since.toISOString().slice(0, 10);

      // Recuperado via régua = paid + was_overdue + tinha collectionMessage sent
      const rows = await rawQuery<{
        receivableId: number;
        clientId: number;
        clientName: string;
        amount: string;
        paidDate: string;
        dueDate: string;
        daysLate: number;
        msgId: number | null;
        msgType: string | null;
        msgSentAt: string | null;
      }>(
        `SELECT r.id AS receivableId, r.clientId, c.name AS clientName,
                r.amount, r.paidDate, r.dueDate,
                DATEDIFF(r.paidDate, r.dueDate) AS daysLate,
                cm.id AS msgId, cm.messageType AS msgType, cm.sentAt AS msgSentAt
         FROM receivables r
         INNER JOIN clients c ON c.id = r.clientId
         INNER JOIN collectionMessages cm ON cm.receivableId = r.id AND cm.status IN ('sent','delivered','read')
         WHERE r.status = 'paid'
           AND r.paidDate >= ?
           AND r.dueDate < r.paidDate
         ORDER BY r.paidDate DESC
         LIMIT ? OFFSET ?`,
        [sinceStr, input.pageSize, offset]
      );

      const [countRow] = await rawQuery<{ total: number }>(
        `SELECT COUNT(DISTINCT r.id) AS total
         FROM receivables r
         INNER JOIN collectionMessages cm ON cm.receivableId = r.id AND cm.status IN ('sent','delivered','read')
         WHERE r.status = 'paid' AND r.paidDate >= ? AND r.dueDate < r.paidDate`,
        [sinceStr]
      );

      return {
        items: rows.map(r => ({
          receivableId: r.receivableId,
          clientId: r.clientId,
          clientName: r.clientName,
          amount: Number(r.amount),
          paidDate: toStr(r.paidDate),
          dueDate: toStr(r.dueDate),
          daysLate: Number(r.daysLate ?? 0),
          msgId: r.msgId,
          msgType: r.msgType,
          msgSentAt: r.msgSentAt ? toStr(r.msgSentAt) : null,
        })),
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── PAGAMENTOS TOTAIS (drill-down) ─────────────────────────────────────────
  listaPagamentosTotais: publicProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).default(30),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      const sinceStr = since.toISOString().slice(0, 10);

      const rows = await rawQuery<{
        id: number;
        clientId: number;
        clientName: string;
        amount: string;
        paidDate: string;
        dueDate: string;
        wasOverdue: number;
        hasCollectionMsg: number;
      }>(
        `SELECT r.id, r.clientId, c.name AS clientName, r.amount,
                r.paidDate, r.dueDate,
                CASE WHEN r.dueDate < r.paidDate THEN 1 ELSE 0 END AS wasOverdue,
                CASE WHEN EXISTS (
                  SELECT 1 FROM collectionMessages cm
                  WHERE cm.receivableId = r.id AND cm.status IN ('sent','delivered','read')
                ) THEN 1 ELSE 0 END AS hasCollectionMsg
         FROM receivables r
         INNER JOIN clients c ON c.id = r.clientId
         WHERE r.status = 'paid' AND r.paidDate >= ?
         ORDER BY r.paidDate DESC
         LIMIT ? OFFSET ?`,
        [sinceStr, input.pageSize, offset]
      );

      const [countRow] = await rawQuery<{ total: number }>(
        `SELECT COUNT(*) AS total FROM receivables r
         WHERE r.status = 'paid' AND r.paidDate >= ?`,
        [sinceStr]
      );

      return {
        items: rows.map(r => ({
          id: r.id,
          clientId: r.clientId,
          clientName: r.clientName,
          amount: Number(r.amount),
          paidDate: toStr(r.paidDate),
          dueDate: toStr(r.dueDate),
          wasOverdue: Boolean(r.wasOverdue),
          hasCollectionMsg: Boolean(r.hasCollectionMsg),
        })),
        total: Number(countRow?.total ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // ── AÇÃO: ENVIAR LEMBRETE MANUAL ──────────────────────────────────────────
  sendManual: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      stage: z.enum(["d_minus_3", "d_0", "d_plus_3", "d_plus_7", "d_plus_15"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Buscar dados do cliente
      const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
      if (!client) throw new Error("Cliente não encontrado");
      if (client.optOut) throw new Error("Cliente com opt-out ativo — envio bloqueado");
      if (!client.whatsappNumber) throw new Error("Cliente sem número WhatsApp cadastrado");

      // Buscar títulos em aberto
      const openTitles = await rawQuery<{ id: number; amount: string; dueDate: string; daysOverdue: number; link: string | null; linhaDigitavel: string | null }>(  
        `SELECT id, amount, dueDate, DATEDIFF(NOW(), dueDate) AS daysOverdue, link, linhaDigitavel
         FROM receivables WHERE clientId = ? AND status IN ('pending','overdue') AND CAST(amount AS DECIMAL) > 0
         ORDER BY daysOverdue DESC LIMIT 10`,
        [input.clientId]
      );
      if (!openTitles.length) throw new Error("Cliente sem títulos em aberto");

      const totalDebt = openTitles.reduce((s, r) => s + Number(r.amount), 0);
      const maxDaysOverdue = Math.max(...openTitles.map(r => Number(r.daysOverdue ?? 0)));
      const primaryTitle = openTitles[0];
      const paymentLink = primaryTitle.linhaDigitavel ?? primaryTitle.link ?? null;

      // Determinar estágio
      const stage: ReguaStage = input.stage ?? (
        maxDaysOverdue <= 0 ? "d_0" :
        maxDaysOverdue <= 3 ? "d_plus_3" :
        maxDaysOverdue <= 7 ? "d_plus_7" :
        "d_plus_15"
      );

      const runId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const correlationId = `manual-${uuidv4()}`;

      // Montar mensagem
      const messageContent = buildReguaMessage({
        stage,
        clientName: client.name,
        totalDebt,
        titlesCount: openTitles.length,
        maxDaysOverdue,
        paymentLink,
        correlationId,
      });

      // Enviar
      const sendResult = await sendReguaMessage(client.whatsappNumber, messageContent);

      // Gravar auditoria com trigger=manual
      await saveReguaAudit(runId, false, {
        clientId: input.clientId,
        receivableId: primaryTitle.id,
        stage,
        status: sendResult.ok ? "sent" : "error",
        skipReason: undefined,
        phoneE164: client.whatsappNumber,
        messageContent,
        totalDebt,
        titlesCount: openTitles.length,
        maxDaysOverdue,
        providerMessageId: sendResult.messageId ?? undefined,
        providerStatus: sendResult.ok ? "sent" : "error",
        errorMessage: sendResult.ok ? undefined : (sendResult as any).error ?? "Erro desconhecido",
        correlationId,
        sentAt: sendResult.ok ? new Date() : undefined,
      });

      // Registrar em collectionMessages para aparecer na timeline
      await rawQuery(
        `INSERT INTO collectionMessages (clientId, receivableId, messageType, status, outcome, sentAt, whatsappMessageId, createdAt, updatedAt)
         VALUES (?, ?, 'manual_reminder', ?, 'pending', NOW(), ?, NOW(), NOW())`,
        [input.clientId, primaryTitle.id, sendResult.ok ? 'sent' : 'failed', sendResult.messageId ?? null]
      );

      return {
        ok: sendResult.ok,
        correlationId,
        stage,
        messageId: sendResult.messageId ?? null,
        error: sendResult.ok ? null : (sendResult as any).error ?? "Erro no envio",
      };
    }),

  // ── AÇÃO: MARCAR OPT-OUT ──────────────────────────────────────────────────
  setOptOut: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      optOut: z.boolean(),
      motivo: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
      if (!client) throw new Error("Cliente não encontrado");

      // Atualizar flag optOut
      await db.update(clients)
        .set({ optOut: input.optOut, updatedAt: new Date() })
        .where(eq(clients.id, input.clientId));

      // Registrar na timeline via collectionMessages
      const motivo = input.motivo ?? (input.optOut ? "Opt-out manual pelo gestor" : "Opt-in manual pelo gestor");
      await rawQuery(
        `INSERT INTO collectionMessages (clientId, receivableId, messageType, status, outcome, sentAt, createdAt, updatedAt)
         VALUES (?, NULL, ?, 'sent', 'opt_out_registered', NOW(), NOW(), NOW())`,
        [input.clientId, input.optOut ? 'opt_out' : 'opt_in']
      );

      console.log(`[Dossiê] ${input.optOut ? 'OPT_OUT' : 'OPT_IN'} clientId=${input.clientId} motivo="${motivo}"`);

      return {
        ok: true,
        clientId: input.clientId,
        optOut: input.optOut,
        motivo,
        updatedAt: new Date().toISOString(),
      };
    }),

  // ── AÇÃO: ESCALAR PARA JURÍDICO ───────────────────────────────────────────
  setJuridico: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
      if (!client) throw new Error("Cliente não encontrado");

      // Verificar se já tem caso jurídico ativo
      const [existingCase] = await db.select()
        .from(legalCases)
        .where(
          and(
            eq(legalCases.clientId, input.clientId),
            inArray(legalCases.status, ["draft", "approved", "sent_to_legal"])
          )
        )
        .limit(1);

      if (existingCase) {
        return {
          ok: false,
          caseId: existingCase.id,
          status: existingCase.status,
          message: `Já existe caso jurídico ativo (id=${existingCase.id}, status=${existingCase.status})`,
        };
      }

      // Criar novo caso jurídico
      const [insertResult] = await rawQuery<{ insertId: number }>(
        `INSERT INTO legal_cases (clientId, status, notes, createdAt, updatedAt) VALUES (?, 'draft', ?, NOW(), NOW())`,
        [input.clientId, input.notes ?? null]
      );
      const caseId = (insertResult as any)?.insertId ?? 0;

      // Registrar na timeline
      await rawQuery(
        `INSERT INTO collectionMessages (clientId, receivableId, messageType, status, outcome, sentAt, createdAt, updatedAt)
         VALUES (?, NULL, 'escalated_legal', 'sent', 'escalated', NOW(), NOW(), NOW())`,
        [input.clientId]
      );

      // Bloquear régua para este cliente (opt-out temporário não — apenas log)
      console.log(`[Dossiê] JURIDICO clientId=${input.clientId} caseId=${caseId}`);

      return {
        ok: true,
        caseId,
        status: "draft",
        message: "Cliente escalado para jurídico. Caso criado com status 'draft'.",
      };
    }),
});
