/**
 * Router tRPC para webhooks de pagamento do Conta Azul
 * Endpoints: /api/trpc/webhookPayment.*
 */

import { publicProcedure, router } from "./_core/trpc";
import {
  processPaymentWebhook,
  getClientPaymentHistory,
  getFailedWebhooks,
  getWebhookStats,
} from "./webhookPaymentManager";
import { z } from "zod";

export const webhookPaymentRouter = router({
  /**
   * Receber webhook de pagamento
   * POST /api/trpc/webhookPayment.receivePayment
   */
  receivePayment: publicProcedure
    .input(
      z.object({
        id: z.string(),
        event: z.string(),
        data: z.object({
          receivable_id: z.string().optional(),
          amount: z.number().optional(),
          payment_date: z.string().optional(),
          payment_method: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log("[Webhook Router] Recebendo webhook de pagamento:", input.id);

        const result = await processPaymentWebhook(input);

        return {
          success: result.success,
          message: result.message,
          error: result.error,
        };
      } catch (error: any) {
        console.error("[Webhook Router] Erro ao receber webhook:", error.message);
        return {
          success: false,
          message: "Erro ao processar webhook",
          error: error.message,
        };
      }
    }),

  /**
   * Buscar histórico de pagamentos de um cliente
   * GET /api/trpc/webhookPayment.getClientPaymentHistory?clientId=123
   */
  getClientPaymentHistory: publicProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      try {
        const payments = await getClientPaymentHistory(input.clientId);
        return {
          success: true,
          payments,
        };
      } catch (error: any) {
        console.error("[Webhook Router] Erro ao buscar histórico:", error.message);
        return {
          success: false,
          error: error.message,
          payments: [],
        };
      }
    }),

  /**
   * Buscar webhooks que falharam
   * GET /api/trpc/webhookPayment.getFailedWebhooks
   */
  getFailedWebhooks: publicProcedure.query(async () => {
    try {
      const webhooks = await getFailedWebhooks();
      return {
        success: true,
        webhooks,
      };
    } catch (error: any) {
      console.error("[Webhook Router] Erro ao buscar webhooks falhados:", error.message);
      return {
        success: false,
        error: error.message,
        webhooks: [],
      };
    }
  }),

  /**
   * Buscar estatísticas de webhooks
   * GET /api/trpc/webhookPayment.getStats
   */
  getStats: publicProcedure.query(async () => {
    try {
      const stats = await getWebhookStats();
      return {
        success: true,
        stats,
      };
    } catch (error: any) {
      console.error("[Webhook Router] Erro ao buscar estatísticas:", error.message);
      return {
        success: false,
        error: error.message,
        stats: null,
      };
    }
  }),
});

export type WebhookPaymentRouter = typeof webhookPaymentRouter;
