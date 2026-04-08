/**
 * 📊 Router de Métricas de Cobrança
 * Fornece dados para o Dashboard de Cobrança
 * Fonte: dispatch_history + receivables + clients
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { receivables, collectionMessages, clients } from "../drizzle/schema";
import { eq, sql, and, gte, lte, desc, count, sum } from "drizzle-orm";

export const collectionMetricsRouter = router({
  /**
   * 📈 Métricas Principais (Cards)
   * Retorna: boletos enviados, taxa entrega, valor cobrado, valor recuperado
   */
  mainMetrics: protectedProcedure
    .input(
      z.object({
        period: z.enum(["day", "week", "month"]).default("month"),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Calcular data de início baseado no período
      const now = new Date();
      let startDate = new Date();

      if (input.period === "day") {
        startDate.setHours(0, 0, 0, 0);
      } else if (input.period === "week") {
        const day = now.getDay();
        startDate.setDate(now.getDate() - day);
        startDate.setHours(0, 0, 0, 0);
      } else {
        // month
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
      }

      // Boletos enviados
      const sent = await db
        .select({ count: count() })
        .from(collectionMessages)
        .where(
          and(
            eq(collectionMessages.status, "sent"),
            gte(collectionMessages.createdAt, startDate)
          )
        );

      // Boletos falhados
      const failed = await db
        .select({ count: count() })
        .from(collectionMessages)
        .where(
          and(
            eq(collectionMessages.status, "failed"),
            gte(collectionMessages.createdAt, startDate)
          )
        );

      // Valor total em cobrança (receivables com status overdue)
      const totalOverdue = await db
        .select({ total: sum(receivables.amount) })
        .from(receivables)
        .where(eq(receivables.status, "overdue"));

      // Valor recuperado (receivables com status paid)
      const totalRecovered = await db
        .select({ total: sum(receivables.amount) })
        .from(receivables)
        .where(eq(receivables.status, "paid"));

      const sentCount = sent[0]?.count || 0;
      const failedCount = failed[0]?.count || 0;
      const totalSent = sentCount + failedCount;
      const deliveryRate = totalSent > 0 ? ((sentCount / totalSent) * 100).toFixed(2) : "0.00";

      return {
        period: input.period,
        boletos: {
          sent: sentCount,
          failed: failedCount,
          total: totalSent,
          deliveryRate: parseFloat(deliveryRate),
        },
        values: {
        totalOverdue: parseFloat(String(totalOverdue[0]?.total || 0)),
        totalRecovered: parseFloat(String(totalRecovered[0]?.total || 0)),
        },
      };
    }),

  /**
   * 📊 Histórico de Envios (Gráfico)
   * Retorna: envios por dia/semana/mês
   */
  sendingHistory: protectedProcedure
    .input(
      z.object({
        period: z.enum(["day", "week", "month"]).default("month"),
        days: z.number().default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      startDate.setHours(0, 0, 0, 0);

      const history = await db
        .select({
          date: sql<string>`DATE(${collectionMessages.createdAt})`,
          sent: sql<number>`COUNT(CASE WHEN ${collectionMessages.status} = 'sent' THEN 1 END)`,
          failed: sql<number>`COUNT(CASE WHEN ${collectionMessages.status} = 'failed' THEN 1 END)`,
          total: count(),
        })
        .from(collectionMessages)
        .where(gte(collectionMessages.createdAt, startDate))
        .groupBy(sql`DATE(${collectionMessages.createdAt})`)
        .orderBy(sql`DATE(${collectionMessages.createdAt})`);

      return history.map((item) => ({
        date: item.date || new Date().toISOString().split('T')[0],
        sent: typeof item.sent === 'number' ? item.sent : 0,
        failed: typeof item.failed === 'number' ? item.failed : 0,
        total: typeof item.total === 'number' ? item.total : 0,
      }));
    }),

  /**
   * 👥 Ranking de Inadimplentes
   * Retorna: top 10 clientes com maior dívida
   */
  topDebtors: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(10),
        status: z.enum(["overdue", "pending", "all"]).default("overdue"),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const whereCondition =
        input.status === "all"
          ? undefined
          : eq(receivables.status, input.status as "overdue" | "pending");

      const debtors = await db
        .select({
          clientId: receivables.clientId,
          clientName: clients.name,
          email: clients.email,
          whatsappNumber: clients.whatsappNumber,
          totalDebt: sum(receivables.amount),
          receivableCount: count(),
          oldestDue: sql<string>`MIN(${receivables.dueDate})`,
        })
        .from(receivables)
        .leftJoin(clients, eq(receivables.clientId, clients.id))
        .where(whereCondition)
        .groupBy(receivables.clientId, clients.name, clients.email, clients.whatsappNumber)
        .orderBy(desc(sum(receivables.amount)))
        .limit(input.limit);

      return debtors.map((debtor) => ({
        clientId: debtor.clientId,
        clientName: debtor.clientName || "Unknown",
        email: debtor.email,
        whatsappNumber: debtor.whatsappNumber,
        totalDebt: parseFloat(String(debtor.totalDebt || 0)),
        receivableCount: debtor.receivableCount || 0,
        oldestDue: debtor.oldestDue,
        daysOverdue: debtor.oldestDue
          ? Math.floor(
              (Date.now() - new Date(debtor.oldestDue).getTime()) / (1000 * 60 * 60 * 24)
            )
          : 0,
      }));
    }),

  /**
   * 📅 Aging da Dívida (0–30 / 30–60 / 60+ dias)
   * Retorna: distribuição de dívidas por faixa de vencimento
   */
  debtAging: protectedProcedure
    .input(
      z.object({
        status: z.enum(["overdue", "pending", "all"]).default("overdue"),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const whereCondition =
        input.status === "all"
          ? undefined
          : eq(receivables.status, input.status as "overdue" | "pending");

      const now = new Date();

      // 0-30 dias
      const days0to30Start = new Date(now);
      days0to30Start.setDate(now.getDate() - 30);

      const days0to30 = await db
        .select({
          count: count(),
          total: sum(receivables.amount),
        })
        .from(receivables)
        .where(
          and(
            whereCondition,
            gte(receivables.dueDate, days0to30Start),
            lte(receivables.dueDate, now)
          )
        );

      // 30-60 dias
      const days30to60Start = new Date(now);
      days30to60Start.setDate(now.getDate() - 60);

      const days30to60 = await db
        .select({
          count: count(),
          total: sum(receivables.amount),
        })
        .from(receivables)
        .where(
          and(
            whereCondition,
            gte(receivables.dueDate, days30to60Start),
            lte(receivables.dueDate, days0to30Start)
          )
        );

      // 60+ dias
      const days60plus = await db
        .select({
          count: count(),
          total: sum(receivables.amount),
        })
        .from(receivables)
        .where(
          and(whereCondition, lte(receivables.dueDate, days30to60Start))
        );

      return {
        "0-30": {
          count: days0to30[0]?.count || 0,
          total: parseFloat(String(days0to30[0]?.total || 0)),
        },
        "30-60": {
          count: days30to60[0]?.count || 0,
          total: parseFloat(String(days30to60[0]?.total || 0)),
        },
        "60+": {
          count: days60plus[0]?.count || 0,
          total: parseFloat(String(days60plus[0]?.total || 0)),
        },
      };
    }),

  /**
   * 📋 Histórico de Envios por Cliente
   * Retorna: últimos envios de um cliente específico
   */
  clientSendingHistory: protectedProcedure
    .input(
      z.object({
        clientId: z.number(),
        limit: z.number().default(10),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const history = await db
        .select({
          id: collectionMessages.id,
          receivableId: collectionMessages.receivableId,
          status: collectionMessages.status,
          whatsappMessageId: collectionMessages.whatsappMessageId,
          lastError: collectionMessages.lastError,
          createdAt: collectionMessages.createdAt,
          amount: receivables.amount,
          dueDate: receivables.dueDate,
        })
        .from(collectionMessages)
        .leftJoin(
          receivables,
          eq(collectionMessages.receivableId, receivables.id)
        )
        .where(eq(receivables.clientId, input.clientId))
        .orderBy(desc(collectionMessages.createdAt))
        .limit(input.limit);

      return history.map((item) => ({
        id: item.id,
        receivableId: item.receivableId,
        status: item.status,
        whatsappMessageId: item.whatsappMessageId,
        lastError: item.lastError,
        createdAt: item.createdAt,
        amount: item.amount ? parseFloat(item.amount.toString()) : 0,
        dueDate: item.dueDate,
      }));
    }),

  /**
   * 📊 Estatísticas Gerais
   * Retorna: total de receivables, clientes, status distribution
   */
  generalStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Total de receivables por status
    const byStatus = await db
      .select({
        status: receivables.status,
        count: count(),
        total: sum(receivables.amount),
      })
      .from(receivables)
      .groupBy(receivables.status);

    // Total de clientes
    const totalClients = await db
      .select({ count: count() })
      .from(clients);

    // Clientes com WhatsApp
    const clientsWithWhatsapp = await db
      .select({ count: count() })
      .from(clients)
      .where(sql`${clients.whatsappNumber} IS NOT NULL AND ${clients.whatsappNumber} != ''`);

    return {
      receivables: {
        byStatus: byStatus.map((item) => ({
          status: item.status,
          count: item.count,
          total: parseFloat(String(item.total || 0)),
        })),
      },
      clients: {
        total: totalClients[0]?.count || 0,
        withWhatsapp: clientsWithWhatsapp[0]?.count || 0,
      },
    };
  }),
});
