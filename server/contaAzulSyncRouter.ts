/**
 * 🔄 tRPC Router para Sincronização de Dados Conta Azul
 */

import { publicProcedure, router } from "./_core/trpc";
import { executeFullSync, formatSyncResult } from "./contaAzulDataSync";
import { TRPCError } from "@trpc/server";

// Middleware para validar TEST_DISPATCH_TOKEN
const withTestToken = publicProcedure.use(async ({ ctx, next }) => {
  const authHeader = ctx.req?.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const expectedToken = process.env.TEST_DISPATCH_TOKEN;

  if (!token || token !== expectedToken) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Token inválido ou não fornecido',
    });
  }

  return next({ ctx });
});

export const contaAzulSyncRouter = router({
  /**
   * Executar sincronização completa
   */
  syncNow: withTestToken.mutation(async () => {
    try {
      console.log("[tRPC] Iniciando sincronização de dados Conta Azul...");

      const result = await executeFullSync();

      console.log(formatSyncResult(result));

      return {
        success: result.success,
        data: result,
      };
    } catch (error) {
      console.error("[tRPC] Erro ao sincronizar:", error);

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Erro ao sincronizar",
      });
    }
  }),

  /**
   * Health check
   */
  health: withTestToken.query(() => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }),
});
