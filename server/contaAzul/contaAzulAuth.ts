/**
 * contaAzulAuth.ts
 * 
 * Helper para autenticação Conta Azul com cache + refresh automático
 * Evita loops de token expirado
 */

import { getValidAccessToken } from "../contaAzulOAuthManager";

interface TokenCache {
  token: string;
  expiresAt: number;
  refreshedAt: number;
}

let tokenCache: TokenCache | null = null;

/**
 * Obter token válido com cache + refresh automático
 * 
 * Lógica:
 * 1. Se cache existe e não expirou: retorna cache
 * 2. Se cache expirou: faz refresh
 * 3. Se refresh falha: tenta getValidAccessToken()
 * 4. Se tudo falha: retorna null
 */
export async function getContaAzulToken(): Promise<string | null> {
  try {
    const now = Date.now();

    // Se cache existe e não expirou em < 120s: retorna cache
    if (tokenCache && tokenCache.expiresAt > now + 120000) {
      console.log("[contaAzulAuth] Token do cache válido");
      return tokenCache.token;
    }

    // Cache expirado ou não existe: tenta obter novo token
    console.log("[contaAzulAuth] Cache expirado ou não existe, obtendo novo token...");

    const token = await getValidAccessToken();
    if (!token) {
      console.error("[contaAzulAuth] getValidAccessToken() retornou null");
      return null;
    }

    // Estimar expiração (assumir 3600s = 1 hora)
    const expiresAt = now + 3600000;

    // Atualizar cache
    tokenCache = {
      token,
      expiresAt,
      refreshedAt: now,
    };

    console.log(`[contaAzulAuth] Token obtido. Expira em ${Math.round((expiresAt - now) / 1000)}s`);

    return token;
  } catch (error) {
    console.error("[contaAzulAuth] Erro ao obter token:", error);
    return null;
  }
}

/**
 * Limpar cache (útil para testes)
 */
export function clearContaAzulTokenCache(): void {
  tokenCache = null;
  console.log("[contaAzulAuth] Cache limpo");
}

/**
 * Obter status do cache (para debug)
 */
export function getContaAzulTokenCacheStatus(): {
  hasCached: boolean;
  isExpired: boolean;
  minutesUntilExpiry: number;
  refreshedAgo: number;
} {
  const now = Date.now();

  if (!tokenCache) {
    return {
      hasCached: false,
      isExpired: true,
      minutesUntilExpiry: 0,
      refreshedAgo: 0,
    };
  }

  const minutesUntilExpiry = Math.round((tokenCache.expiresAt - now) / 60000);
  const refreshedAgo = Math.round((now - tokenCache.refreshedAt) / 1000);

  return {
    hasCached: true,
    isExpired: tokenCache.expiresAt < now,
    minutesUntilExpiry,
    refreshedAgo,
  };
}
