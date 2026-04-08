import { router, protectedProcedure } from './_core/trpc';
import { z } from 'zod';
import { getDb } from './db';
import { collectionMessages } from '../drizzle/schema';
import { eq, gte, lte, and, sql } from 'drizzle-orm';

/**
 * Router para métricas de performance do agente de cobrança
 */

export const performanceMetricsRouter = router({
  /**
   * Busca métricas gerais de performance
   */
  getOverallMetrics: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) {
          return {
            success: false,
            message: 'Database not available'
          };
        }

        let query = db.select({
          totalMessagesSent: sql`COUNT(DISTINCT ${collectionMessages.id})`,
          totalDelivered: sql`COUNT(CASE WHEN ${collectionMessages.status} IN ('delivered', 'read') THEN 1 END)`,
          totalRead: sql`COUNT(CASE WHEN ${collectionMessages.status} = 'read' THEN 1 END)`,
          totalResponses: sql`COUNT(CASE WHEN ${collectionMessages.responseReceived} = true THEN 1 END)`,
          totalAgreed: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'agreed' THEN 1 END)`,
          totalPaid: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'paid' THEN 1 END)`,
          totalRejected: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'rejected' THEN 1 END)`
        }).from(collectionMessages);

        if (input.startDate && input.endDate) {
          query = query.where(and(
            gte(collectionMessages.sentAt, input.startDate),
            lte(collectionMessages.sentAt, input.endDate)
          )) as any;
        }

        const result = await query;

        return {
          success: true,
          metrics: {
            totalMessagesSent: result[0]?.totalMessagesSent || 0,
            totalDelivered: result[0]?.totalDelivered || 0,
            totalRead: result[0]?.totalRead || 0,
            totalResponses: result[0]?.totalResponses || 0,
            totalAgreed: result[0]?.totalAgreed || 0,
            totalPaid: result[0]?.totalPaid || 0,
            totalRejected: result[0]?.totalRejected || 0,
            deliveryRate: result[0]?.totalMessagesSent ? 
              (((Number(result[0]?.totalDelivered) || 0) / (Number(result[0]?.totalMessagesSent) || 1)) * 100).toFixed(2) : '0.00',
            responseRate: result[0]?.totalMessagesSent ? 
              (((Number(result[0]?.totalResponses) || 0) / (Number(result[0]?.totalMessagesSent) || 1)) * 100).toFixed(2) : '0.00',
            conversionRate: result[0]?.totalResponses ? 
              (((Number(result[0]?.totalAgreed) || 0) / (Number(result[0]?.totalResponses) || 1)) * 100).toFixed(2) : '0.00'
          }
        };
      } catch (error) {
        console.error('Erro ao buscar métricas gerais:', error);
        return {
          success: false,
          message: 'Erro ao buscar métricas'
        };
      }
    }),

  /**
   * Busca métricas por tipo de mensagem
   */
  getMetricsByMessageType: protectedProcedure
    .query(async () => {
      try {
        const db = await getDb();
        if (!db) {
          return {
            success: false,
            message: 'Database not available'
          };
        }

        const result = await db
          .select({
            messageType: collectionMessages.messageType,
            totalSent: sql`COUNT(DISTINCT ${collectionMessages.id})`,
            totalDelivered: sql`COUNT(CASE WHEN ${collectionMessages.status} IN ('delivered', 'read') THEN 1 END)`,
            totalResponses: sql`COUNT(CASE WHEN ${collectionMessages.responseReceived} = true THEN 1 END)`,
            totalAgreed: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'agreed' THEN 1 END)`,
            totalPaid: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'paid' THEN 1 END)`
          })
          .from(collectionMessages)
          .groupBy(collectionMessages.messageType);

        return {
          success: true,
          metrics: (result as any[]).map((row: any) => ({
            messageType: row.messageType,
            totalSent: row.totalSent || 0,
            totalDelivered: row.totalDelivered || 0,
            totalResponses: row.totalResponses || 0,
            totalAgreed: row.totalAgreed || 0,
            totalPaid: row.totalPaid || 0,
            deliveryRate: row.totalSent ? (((Number(row.totalDelivered) || 0) / (Number(row.totalSent) || 1)) * 100).toFixed(2) : '0.00',
            responseRate: row.totalSent ? (((Number(row.totalResponses) || 0) / (Number(row.totalSent) || 1)) * 100).toFixed(2) : '0.00'
          }))
        };
      } catch (error) {
        console.error('Erro ao buscar métricas por tipo:', error);
        return {
          success: false,
          message: 'Erro ao buscar métricas'
        };
      }
    }),

  /**
   * Busca métricas diárias
   */
  getDailyMetrics: protectedProcedure
    .input(z.object({
      days: z.number().default(30)
    }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) {
          return {
            success: false,
            message: 'Database not available'
          };
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - input.days);

        const result = await db
          .select({
            date: sql`DATE(${collectionMessages.sentAt})`,
            totalSent: sql`COUNT(DISTINCT ${collectionMessages.id})`,
            totalDelivered: sql`COUNT(CASE WHEN ${collectionMessages.status} IN ('delivered', 'read') THEN 1 END)`,
            totalResponses: sql`COUNT(CASE WHEN ${collectionMessages.responseReceived} = true THEN 1 END)`,
            totalAgreed: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'agreed' THEN 1 END)`,
            totalPaid: sql`COUNT(CASE WHEN ${collectionMessages.outcome} = 'paid' THEN 1 END)`
          })
          .from(collectionMessages)
          .where(gte(collectionMessages.sentAt, startDate))
          .groupBy(sql`DATE(${collectionMessages.sentAt})`)
          .orderBy(sql`DATE(${collectionMessages.sentAt})`);

        return {
          success: true,
          metrics: result
        };
      } catch (error) {
        console.error('Erro ao buscar métricas diárias:', error);
        return {
          success: false,
          message: 'Erro ao buscar métricas'
        };
      }
    }),

  /**
   * Busca métricas de tempo de resposta
   */
  getResponseTimeMetrics: protectedProcedure
    .query(async () => {
      try {
        const db = await getDb();
        if (!db) {
          return {
            success: false,
            message: 'Database not available'
          };
        }

        const result = await db
          .select({
            messageType: collectionMessages.messageType,
            avgResponseTime: sql`AVG(TIMESTAMPDIFF(MINUTE, ${collectionMessages.sentAt}, ${collectionMessages.responseDate}))`,
            minResponseTime: sql`MIN(TIMESTAMPDIFF(MINUTE, ${collectionMessages.sentAt}, ${collectionMessages.responseDate}))`,
            maxResponseTime: sql`MAX(TIMESTAMPDIFF(MINUTE, ${collectionMessages.sentAt}, ${collectionMessages.responseDate}))`
          })
          .from(collectionMessages)
          .where(sql`${collectionMessages.responseDate} IS NOT NULL`)
          .groupBy(collectionMessages.messageType);

        return {
          success: true,
          metrics: result
        };
      } catch (error) {
        console.error('Erro ao buscar tempo de resposta:', error);
        return {
          success: false,
          message: 'Erro ao buscar métricas'
        };
      }
    })
});
