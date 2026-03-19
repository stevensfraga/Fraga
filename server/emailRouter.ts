/**
 * Router tRPC para serviço de e-mail
 */

import { publicProcedure, router } from "./_core/trpc";
import {
  sendCollectionEmail,
  sendPaymentConfirmationEmail,
  sendResetEmail,
  testSMTPConnection,
} from "./emailService";
import { z } from "zod";

export const emailRouter = router({
  /**
   * Enviar e-mail de cobrança
   */
  sendCollectionEmail: publicProcedure
    .input(
      z.object({
        clientEmail: z.string().email(),
        clientName: z.string(),
        stage: z.string(),
        amount: z.number(),
        dueDate: z.string(),
        boletoUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await sendCollectionEmail(
          input.clientEmail,
          input.clientName,
          input.stage,
          input.amount,
          input.dueDate,
          input.boletoUrl
        );
        return result;
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Enviar e-mail de confirmação de pagamento
   */
  sendPaymentConfirmation: publicProcedure
    .input(
      z.object({
        clientEmail: z.string().email(),
        clientName: z.string(),
        amountPaid: z.number(),
        paymentDate: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await sendPaymentConfirmationEmail(
          input.clientEmail,
          input.clientName,
          input.amountPaid,
          input.paymentDate
        );
        return result;
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Enviar e-mail de reset para clientes > 60 dias
   */
  sendResetEmail: publicProcedure
    .input(
      z.object({
        clientEmail: z.string().email(),
        clientName: z.string(),
        totalDebt: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await sendResetEmail(
          input.clientEmail,
          input.clientName,
          input.totalDebt
        );
        return result;
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Testar conexão SMTP
   */
  testConnection: publicProcedure.query(async () => {
    try {
      const result = await testSMTPConnection();
      return result;
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
      };
    }
  }),
});

export type EmailRouter = typeof emailRouter;
