/**
 * 🚀 tRPC Router para Primeiro Envio de Boleto
 * 
 * Endpoints:
 * - firstBoleto.validate - Validação pré-envio
 * - firstBoleto.prepareMessage - Preparação de mensagem
 * - firstBoleto.dispatch - Envio do boleto
 */

import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  runPreDispatchValidation,
  formatValidationForConsole,
} from "./firstBoletoValidation";
import {
  prepareMessage,
  validatePreparedMessage,
  formatPreparedMessageForDisplay,
} from "./messagePreparation";
import {
  executeSecureDispatch,
  formatDispatchLogForDisplay,
} from "./secureDispatch";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";

export const firstBoletoRouter = router({
  /**
   * Validar pré-requisitos antes do envio
   */
  validate: protectedProcedure
    .input(
      z.object({
        customerCnpj: z.string().min(1, "CNPJ é obrigatório"),
      })
    )
    .query(async ({ input }: any) => {
      try {
        console.log(`[FirstBoleto] Validando cliente: ${input.customerCnpj}`);

        const validation = await runPreDispatchValidation(input.customerCnpj);

        console.log(formatValidationForConsole(validation));

        return {
          success: true,
          data: validation,
        };
      } catch (error) {
        console.error("[FirstBoleto] Erro na validação:", error);

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Erro ao validar",
        });
      }
    }),

  /**
   * Preparar mensagem para envio
   */
  prepareMessage: protectedProcedure
    .input(
      z.object({
        boleto: z.object({
          id: z.number(),
          customerName: z.string(),
          whatsappNumber: z.string(),
          amount: z.number(),
          dueDate: z.date(),
        }),
        messageType: z.enum(["friendly", "administrative", "formal"]).optional(),
        bankSlipUrl: z.string().optional(),
      })
    )
    .query(async ({ input }: any) => {
      try {
        console.log(`[FirstBoleto] Preparando mensagem para ${input.boleto.customerName}`);

        // Se não tiver URL do boleto, usar um placeholder (será obtido do Conta Azul)
        const bankSlipUrl =
          input.bankSlipUrl ||
          `https://conta-azul.com/boleto/${input.boleto.id}`;

        const prepared = prepareMessage({
          customerName: input.boleto.customerName,
          whatsappNumber: input.boleto.whatsappNumber,
          amount: input.boleto.amount,
          dueDate: input.boleto.dueDate,
          bankSlipUrl,
          messageType: input.messageType,
        });

        // Validar mensagem preparada
        const validation = validatePreparedMessage(prepared);

        if (!validation.isValid) {
          console.error("[FirstBoleto] Mensagem com erros:", validation.errors);

          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Mensagem inválida: ${validation.errors.join(", ")}`,
          });
        }

        console.log(formatPreparedMessageForDisplay(prepared));

        return {
          success: true,
          data: prepared,
        };
      } catch (error) {
        console.error("[FirstBoleto] Erro ao preparar mensagem:", error);

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Erro ao preparar mensagem",
        });
      }
    }),

  /**
   * Enviar boleto via WhatsApp
   */
  dispatch: protectedProcedure
    .input(
      z.object({
        clientId: z.number(),
        receivableId: z.number(),
        message: z.object({
          whatsappNumber: z.string(),
          message: z.string(),
          formattedAmount: z.string(),
          formattedDueDate: z.string(),
          validation: z.object({
            isValid: z.boolean(),
            errors: z.array(z.string()),
            warnings: z.array(z.string()),
          }),
        }),
      })
    )
    .mutation(async ({ input }: any) => {
      try {
        console.log(
          `[FirstBoleto] Iniciando envio para cliente ${input.clientId}, boleto ${input.receivableId}`
        );

        // Validar mensagem antes de enviar
        if (!input.message.validation.isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Mensagem inválida: ${input.message.validation.errors.join(", ")}`,
          });
        }

        // Executar envio seguro
        const result = await executeSecureDispatch(
          input.clientId,
          input.receivableId,
          input.message
        );

        console.log(formatDispatchLogForDisplay(result));

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.log.message,
          });
        }

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error("[FirstBoleto] Erro ao enviar boleto:", error);

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Erro ao enviar boleto",
        });
      }
    }),

  /**
   * Obter histórico de envios do primeiro boleto
   */
  getHistory: protectedProcedure.query(async () => {
    try {
      const db = await getDb();

      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      // TODO: Implementar query para buscar histórico
      // Por enquanto, retornar vazio

      return {
        success: true,
        data: [],
      };
    } catch (error) {
      console.error("[FirstBoleto] Erro ao buscar histórico:", error);

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Erro ao buscar histórico",
      });
    }
  }),
});
