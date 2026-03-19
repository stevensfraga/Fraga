/**
 * tRPC Router para Dashboard de Auditoria
 * 
 * Endpoints para consultar histórico de cobranças, estatísticas e relatórios
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { collectionMessages } from "../drizzle/schema";
import { desc, and, gte, lte, eq } from "drizzle-orm";

export const auditRouter = router({
  /**
   * Busca histórico de mensagens de cobrança
   * Retorna últimas N mensagens com filtro opcional por cliente
   */
  getMessageHistory: publicProcedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
        clientId: z.string().optional(),
        status: z.enum(["pending", "sent", "delivered", "read", "failed"]).optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const filters: any[] = [];

      if (input.clientId) {
        filters.push(eq(collectionMessages.cnpj as any, input.clientId as any));
      }

      if (input.status) {
        filters.push(eq(collectionMessages.status as any, input.status as any));
      }

      if (input.dateFrom) {
        filters.push(gte(collectionMessages.sentAt, input.dateFrom));
      }

      if (input.dateTo) {
        filters.push(lte(collectionMessages.sentAt, input.dateTo));
      }

      let query = db.select().from(collectionMessages);

      if (filters.length > 0) {
        query = query.where(and(...filters)) as any;
      }

      const messages = await (query as any)
        .orderBy(desc(collectionMessages.sentAt))
        .limit(input.limit)
        .offset(input.offset);

      return messages;
    }),

  /**
   * Retorna estatísticas de cobrança
   * Total de mensagens, taxa de sucesso, falhas, etc
   */
  getStatistics: publicProcedure
    .input(
      z.object({
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const filters: any[] = [];

      if (input.dateFrom) {
        filters.push(gte(collectionMessages.sentAt, input.dateFrom));
      }

      if (input.dateTo) {
        filters.push(lte(collectionMessages.sentAt, input.dateTo));
      }

      let query = db.select().from(collectionMessages);

      if (filters.length > 0) {
        query = query.where(and(...filters)) as any;
      }

      const messages = await (query as any);

      const total = messages.length;
      const sent = messages.filter((m: any) => m.status === "sent" || m.status === "delivered" || m.status === "read").length;
      const failed = messages.filter((m: any) => m.status === "failed").length;
      const pending = messages.filter((m: any) => m.status === "pending").length;

      const successRate = total > 0 ? (sent / total) * 100 : 0;

      const byClient: Record<string, number> = {};
      messages.forEach((m: any) => {
        byClient[m.cnpj] = (byClient[m.cnpj] || 0) + 1;
      });

      const byDay: Record<string, number> = {};
      messages.forEach((m: any) => {
        const day = m.sentAt ? m.sentAt.toISOString().split("T")[0] : "unknown";
        byDay[day] = (byDay[day] || 0) + 1;
      });

      return {
        total,
        successful: sent,
        failed,
        pending,
        successRate: parseFloat(successRate.toFixed(2)),
        byClient,
        byDay,
      };
    }),

  /**
   * Busca detalhes de uma mensagem específica
   */
  getMessageDetail: publicProcedure
    .input(z.object({ messageId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const message = await (db
        .select()
        .from(collectionMessages)
        .where(eq(collectionMessages.id as any, parseInt(input.messageId)))
        .limit(1) as any);

      return message[0] || null;
    }),

  /**
   * Retorna últimas N mensagens para dashboard em tempo real
   */
  getRecentMessages: publicProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const messages = await (db
        .select()
        .from(collectionMessages)
        .orderBy(desc(collectionMessages.sentAt))
        .limit(input.limit) as any);

      return messages;
    }),

  /**
   * Retorna resumo do dia atual
   */
  getTodaySummary: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const messages = await (db
      .select()
      .from(collectionMessages)
      .where(
        and(
          gte(collectionMessages.sentAt, today),
          lte(collectionMessages.sentAt, tomorrow)
        )
      ) as any);

    const sent = messages.filter((m: any) => m.status === "sent" || m.status === "delivered" || m.status === "read").length;
    const failed = messages.filter((m: any) => m.status === "failed").length;
    const total = messages.length;

    return {
      date: today.toISOString().split("T")[0],
      total,
      successful: sent,
      failed,
      successRate: total > 0 ? ((sent / total) * 100).toFixed(2) : "0",
    };
  }),

  /**
   * Insere dados de teste para validar dashboard
   */
  insertTestMessage: publicProcedure
    .input(
      z.object({
        cnpj: z.string(),
        messageType: z.enum(["friendly", "administrative", "formal"]),
        messageTemplate: z.string(),
        messageSent: z.string(),
        status: z.enum(["pending", "sent", "delivered", "read", "failed"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(collectionMessages).values({
        cnpj: input.cnpj,
        messageType: input.messageType as any,
        messageTemplate: input.messageTemplate,
        messageSent: input.messageSent,
        status: input.status as any,
        sentAt: new Date(),
      });

      return {
        success: true,
        message: "Dados de teste inseridos com sucesso",
      };
    }),
});
