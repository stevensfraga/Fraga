/**
 * Router tRPC para fluxo OAuth do Conta Azul
 * Endpoints: /api/trpc/contaAzulOAuth.*
 */

import { publicProcedure, router } from "./_core/trpc";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  saveToken,
  hasValidToken,
  clearToken,
} from "./contaAzulOAuthManager";
import { z } from "zod";

export const contaAzulOAuthRouter = router({
  /**
   * Obter URL de autorização
   * GET /api/trpc/contaAzulOAuth.getAuthUrl
   */
  getAuthUrl: publicProcedure.query(async () => {
    try {
      // Gerar state dinâmico
      const crypto = await import('crypto');
      const state = crypto.randomBytes(32).toString('hex');
      const authUrl = getAuthorizationUrl(state);
      return {
        success: true,
        authUrl,
        state,
      };
    } catch (error: any) {
      console.error("[OAuth Router] Erro ao gerar URL de autorização:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }),

  /**
   * Processar callback OAuth
   * GET /api/conta-azul/callback?code=...&state=...
   * Nota: Este endpoint é chamado via HTTP direto, não via tRPC
   */
  processCallback: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ input }: { input: { code: string } }) => {
      try {
        console.log("[OAuth Router] Processando callback com código:", input.code.substring(0, 10) + "...");

        // Trocar código por token
        const tokenData = await exchangeCodeForToken(input.code);

        // Salvar token no banco
        await saveToken(
          tokenData.access_token,
          tokenData.refresh_token,
          tokenData.expires_in
        );

        console.log("[OAuth Router] ✅ Callback processado com sucesso");

        return {
          success: true,
          message: "Autenticação realizada com sucesso",
        };
      } catch (error: any) {
        console.error("[OAuth Router] ❌ Erro ao processar callback:", error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Verificar se há token válido
   * GET /api/trpc/contaAzulOAuth.isAuthenticated
   */
  isAuthenticated: publicProcedure.query(async () => {
    try {
      const authenticated = await hasValidToken();
      return {
        authenticated,
      };
    } catch (error: any) {
      console.error("[OAuth Router] Erro ao verificar autenticação:", error.message);
      return {
        authenticated: false,
      };
    }
  }),

  /**
   * Processar callback OAuth via tRPC
   * POST /api/trpc/contaAzulOAuth.processCallbackCode
   */
  processCallbackCode: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ input }: { input: { code: string } }) => {
      try {
        console.log("[OAuth Router] Processando callback com código:", input.code.substring(0, 10) + "...");

        // Trocar código por token
        const tokenData = await exchangeCodeForToken(input.code);

        // Salvar token no banco
        await saveToken(
          tokenData.access_token,
          tokenData.refresh_token,
          tokenData.expires_in
        );

        console.log("[OAuth Router] ✅ Callback processado com sucesso");

        return {
          success: true,
          message: "Autenticação realizada com sucesso",
        };
      } catch (error: any) {
        console.error("[OAuth Router] ❌ Erro ao processar callback:", error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Fazer logout (remover token)
   * POST /api/trpc/contaAzulOAuth.logout
   */
  logout: publicProcedure.mutation(async () => {
    try {
      await clearToken();
      return {
        success: true,
        message: "Desconectado com sucesso",
      };
    } catch (error: any) {
      console.error("[OAuth Router] Erro ao fazer logout:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }),
});

export type ContaAzulOAuthRouter = typeof contaAzulOAuthRouter;
