/**
 * Router para o Orquestrador
 * Endpoints tRPC para comunicação
 */

import { router, publicProcedure } from "../routers";
import { z } from "zod";
import { orchestrate, clearCache, getCacheStats } from "./orchestrator";

export const orchestratorRouter = router({
  /**
   * Endpoint principal: enviar query ao orquestrador
   */
  query: publicProcedure
    .input(
      z.object({
        query: z.string().describe("Pergunta/tarefa para o orquestrador"),
        context: z
          .record(z.unknown())
          .optional()
          .describe("Contexto adicional"),
        requiresDeepThinking: z
          .boolean()
          .optional()
          .describe("Forçar uso de raciocínio profundo"),
        priority: z
          .enum(["low", "medium", "high"])
          .optional()
          .default("medium"),
      })
    )
    .mutation(async ({ input }) => {
      console.log("[API] Orquestrador chamado com:", input.query);

      const response = await orchestrate({
        query: input.query,
        context: input.context,
        requiresDeepThinking: input.requiresDeepThinking,
        priority: input.priority,
      });

      return response;
    }),

  /**
   * Gerenciar cache
   */
  cache: publicProcedure
    .input(z.enum(["clear", "stats"]))
    .mutation(async ({ input }) => {
      if (input === "clear") {
        clearCache();
        return { success: true, message: "Cache limpo" };
      }

      const stats = getCacheStats();
      return {
        success: true,
        data: stats,
      };
    }),

  /**
   * Health check do orquestrador
   */
  health: publicProcedure.query(async () => {
    return {
      status: "online",
      apiKey: process.env.ANTHROPIC_API_KEY ? "configured" : "missing",
      cacheStats: getCacheStats(),
      timestamp: new Date().toISOString(),
    };
  }),
});

export type OrchestratorRouter = typeof orchestratorRouter;
