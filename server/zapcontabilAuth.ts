/**
 * 🔐 Gerenciador de autenticação ZapContábil
 * Mantém o JWT atualizado usando o cookie jrt que a API retorna
 * Cookie jrt é válido por 1 ano, então não precisa pedir manualmente
 */

import axios from "axios";

interface AuthState {
  bearerJwt: string | null;
  jrtCookie: string | null;
  lastRefreshAt: number;
  expiresAt: number;
}

let authState: AuthState = {
  bearerJwt: process.env.ZAP_CONTABIL_BEARER_JWT || null,
  jrtCookie: process.env.ZAP_CONTABIL_JRT_COOKIE || null,
  lastRefreshAt: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
};

/**
 * Fazer refresh do JWT usando um endpoint leve da API
 * Isso vai capturar o novo cookie jrt da resposta
 */
export async function refreshZapContabilAuth(): Promise<boolean> {
  try {
    if (!authState.bearerJwt) {
      console.warn("[ZapContabilAuth] No Bearer JWT configured");
      return false;
    }

    const apiUrl = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
    
    // Usar um endpoint leve para fazer refresh
    const response = await axios.get(`${apiUrl}/info`, {
      headers: {
        "Authorization": `Bearer ${authState.bearerJwt}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    // Capturar o novo cookie jrt da resposta
    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader) {
      const jrtMatch = setCookieHeader.toString().match(/jrt=([^;]+)/);
      if (jrtMatch && jrtMatch[1]) {
        authState.jrtCookie = jrtMatch[1];
        authState.lastRefreshAt = Date.now();
        authState.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        
        console.log("[ZapContabilAuth] JWT refreshed successfully");
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("[ZapContabilAuth] Refresh failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Obter headers de autenticação atualizados
 */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authState.bearerJwt) {
    headers["Authorization"] = `Bearer ${authState.bearerJwt}`;
  }

  if (authState.jrtCookie) {
    headers["Cookie"] = `jrt=${authState.jrtCookie}`;
  }

  return headers;
}

/**
 * Atualizar Bearer JWT (chamado quando um novo JWT é fornecido)
 */
export function setBearerJWT(jwt: string): void {
  authState.bearerJwt = jwt;
  authState.lastRefreshAt = Date.now();
}

/**
 * Obter estado atual de autenticação
 */
export function getAuthState(): AuthState {
  return { ...authState };
}

/**
 * Verificar se precisa fazer refresh
 */
export function shouldRefresh(): boolean {
  const timeSinceLastRefresh = Date.now() - authState.lastRefreshAt;
  const refreshInterval = 12 * 60 * 60 * 1000; // 12 horas
  return timeSinceLastRefresh > refreshInterval;
}

/**
 * Inicializar autenticação
 */
export async function initializeAuth(): Promise<void> {
  if (shouldRefresh()) {
    await refreshZapContabilAuth();
  }
}
