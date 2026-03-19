/**
 * Router tRPC para gerenciar integração com Conta Azul
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  fetchContasReceber,
  fetchClientes,
} from "./contaAzulOAuth";
import {
  fetchMonthlyFinancialData,
  fetchLast6MonthsFinancialData,
} from "./contaAzulFinancial";
import {
  getFinancialDataWithCache,
  getCacheStatus,
} from "./contaAzulCache";

export const contaAzulRouter = router({
  /**
   * Obter URL de autorização
   */
  getAuthUrl: publicProcedure.query(async () => {
    try {
      const authUrl = getAuthorizationUrl();
      return {
        success: true,
        authUrl,
        message: "Clique no link para autorizar a aplicação no Conta Azul",
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }),

  /**
   * Processar callback de autorização
   */
  handleCallback: publicProcedure
    .input(
      z.object({
        code: z.string(),
        state: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log("[ContaAzul Router] Processando callback com código:", input.code);

        const tokenData = await exchangeCodeForToken(input.code);

        console.log("[ContaAzul Router] ✅ Token obtido com sucesso!");

        return {
          success: true,
          token: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in,
          message: "Autorização bem-sucedida! Token obtido.",
        };
      } catch (error: any) {
        console.error("[ContaAzul Router] ❌ Erro ao processar callback:", error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Buscar contas a receber
   */
  getContasReceber: publicProcedure
    .input(
      z.object({
        accessToken: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        console.log("[ContaAzul Router] Buscando contas a receber...");

        const contas = await fetchContasReceber(input.accessToken);

        // Filtrar contas vencidas
        const hoje = new Date();
        const contasVencidas = contas.filter((conta) => {
          const vencimento = new Date(conta.dataVencimento);
          return vencimento < hoje;
        });

        console.log(`[ContaAzul Router] ✅ ${contasVencidas.length} contas vencidas encontradas`);

        return {
          success: true,
          total: contas.length,
          vencidas: contasVencidas.length,
          contas: contasVencidas.slice(0, 20), // Retornar primeiras 20
        };
      } catch (error: any) {
        console.error("[ContaAzul Router] ❌ Erro ao buscar contas:", error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Buscar clientes
   */
  getClientes: publicProcedure
    .input(
      z.object({
        accessToken: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        console.log("[ContaAzul Router] Buscando clientes...");

        const clientes = await fetchClientes(input.accessToken);

        console.log(`[ContaAzul Router] ✅ ${clientes.length} clientes encontrados`);

        return {
          success: true,
          total: clientes.length,
          clientes: clientes.slice(0, 20), // Retornar primeiros 20
        };
      } catch (error: any) {
        console.error("[ContaAzul Router] ❌ Erro ao buscar clientes:", error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Buscar dados financeiros dos ultimos 6 meses (com cache)
   */
  getLast6Months: publicProcedure.query(async () => {
    try {
      console.log("[ContaAzul Router] Buscando dados dos ultimos 6 meses...");
      const data = await getFinancialDataWithCache();
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      console.error("[ContaAzul Router] Erro ao buscar ultimos 6 meses:", error.message);
      return {
        success: false,
        error: error.message,
        data: [],
      };
    }
  }),

  /**
   * Buscar dados do mes atual
   */
  getCurrentMonth: publicProcedure.query(async () => {
    try {
      console.log("[ContaAzul Router] Buscando dados do mes atual...");
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const currentMonth = `${year}-${month}`;
      const data = await fetchMonthlyFinancialData(currentMonth);
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      console.error("[ContaAzul Router] Erro ao buscar mes atual:", error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }),

  /**
   * Buscar dados do mes anterior
   */
  getPreviousMonth: publicProcedure.query(async () => {
    try {
      console.log("[ContaAzul Router] Buscando dados do mes anterior...");
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = lastMonth.getFullYear();
      const month = String(lastMonth.getMonth() + 1).padStart(2, "0");
      const previousMonth = `${year}-${month}`;
      const data = await fetchMonthlyFinancialData(previousMonth);
      return {
        success: true,
        data,
      };
    } catch (error: any) {
      console.error("[ContaAzul Router] Erro ao buscar mes anterior:", error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }),

  /**
   * Obter status do cache
   */
  getCacheStatus: publicProcedure.query(async () => {
    try {
      const status = getCacheStatus();
      return {
        success: true,
        status,
      };
    } catch (error: any) {
      console.error("[ContaAzul Router] Erro ao obter status do cache:", error.message);
      return {
        success: false,
        error: error.message,
        status: null,
      };
    }
  }),
});
