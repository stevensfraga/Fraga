/**
 * tRPC Router para Auditoria Completa do Sistema Manos
 * 
 * Endpoints para validar todos os componentes antes de disparar boletos reais:
 * 1. OAuth Conta Azul
 * 2. Busca de Boletos
 * 3. Envio WhatsApp
 * 4. Dashboard/Auditoria
 * 5. Scheduler de Cobrança
 * 6. Webhook de Pagamento
 * 7. Criptografia AES-256
 * 8. Conexão com Banco de Dados
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { runFullAudit, formatAuditForConsole } from "./auditService";

export const systemAuditRouter = router({
  /**
   * Executar auditoria completa do sistema
   * Retorna resultado estruturado com status de cada componente
   */
  runFullAudit: publicProcedure
    .input(
      z.object({
        verbose: z.boolean().optional().default(false),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await runFullAudit();

        if (input.verbose) {
          console.log(formatAuditForConsole(result));
        }

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),

  /**
   * Obter status resumido do sistema
   * Retorna apenas o status geral e resumo
   */
  getSystemStatus: publicProcedure.query(async () => {
    try {
      const result = await runFullAudit();

      return {
        success: true,
        status: result.status,
        summary: result.summary,
        timestamp: result.timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),

  /**
   * Validar componente específico
   * Permite testar um componente individual
   */
  validateComponent: publicProcedure
    .input(
      z.enum([
        "oauth",
        "boletos",
        "whatsapp",
        "dashboard",
        "scheduler",
        "webhook",
        "encryption",
        "database",
      ])
    )
    .query(async ({ input }) => {
      try {
        const result = await runFullAudit();
        const componentCheck = result.checks[input as keyof typeof result.checks];

        if (!componentCheck) {
          return {
            success: false,
            error: `Componente ${input} não encontrado`,
          };
        }

        return {
          success: true,
          component: input,
          check: componentCheck,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),

  /**
   * Obter recomendações do sistema
   * Retorna lista de ações recomendadas
   */
  getRecommendations: publicProcedure.query(async () => {
    try {
      const result = await runFullAudit();

      return {
        success: true,
        status: result.status,
        recommendations: result.recommendations,
        timestamp: result.timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),

  /**
   * Verificar se o sistema está pronto para disparar boletos
   * Retorna true/false com motivo se não estiver pronto
   */
  isReadyForDispatch: publicProcedure.query(async () => {
    try {
      const result = await runFullAudit();

      const isReady =
        result.checks.oauth.status === "pass" &&
        result.checks.boletos.status !== "fail" &&
        result.checks.whatsapp.status !== "fail" &&
        result.checks.database.status === "pass";

      const blockers = Object.entries(result.checks)
        .filter(([_, check]) => check.status === "fail")
        .map(([name, check]) => ({
          component: name,
          message: check.message,
          suggestedCommand: check.suggestedCommand,
        }));

      return {
        success: true,
        isReady,
        blockers,
        timestamp: result.timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
});
