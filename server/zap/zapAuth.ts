/**
 * PARTE A — ZAP AUTH HELPER COM CACHE + RETRY
 * 
 * Fonte única de verdade para autenticação Zap
 * Cache em memória com reauth automático
 */

import axios from 'axios';
import crypto from 'crypto';

interface ZapAuthCache {
  token: string;
  cookie: string;
  expiresAt: number;
  tokenHash: string;
}

let authCache: ZapAuthCache | null = null;

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api.zapcontabil.com.br';
const ZAP_EMAIL = process.env.ZAP_CONTABIL_USER || '';
const ZAP_PASSWORD = process.env.ZAP_CONTABIL_PASS || '';

/**
 * Gera hash do token (sem vazar)
 */
function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
}

/**
 * Faz login no Zap e retorna token + cookie
 */
async function loginZap(): Promise<{ token: string; cookie: string; expiresAt: number }> {
  console.log('[ZapAuth] Fazendo login...');

  try {
    const response = await axios.post(
      `${ZAP_BASE_URL}/auth/login`,
      {
        email: ZAP_EMAIL,
        password: ZAP_PASSWORD,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const token = response.data.token || response.data.accessToken;
    if (!token) {
      throw new Error('Nenhum token retornado no login');
    }

    // Extrair cookie JRT do header set-cookie
    const setCookieHeader = response.headers['set-cookie'];
    let cookie = '';
    if (Array.isArray(setCookieHeader) && setCookieHeader.length > 0) {
      // Pegar primeiro cookie (JRT)
      const firstCookie = setCookieHeader[0];
      cookie = firstCookie.split(';')[0]; // Remover opções (path, expires, etc)
    }

    // Calcular expiresAt: agora + 14 minutos (assumindo TTL 15min)
    const expiresAt = Date.now() + 14 * 60 * 1000;

    console.log('[ZapAuth] ✅ Login bem-sucedido');
    console.log('[ZapAuth] Token hash:', tokenHash(token));
    console.log('[ZapAuth] Expira em:', new Date(expiresAt).toISOString());

    return { token, cookie, expiresAt };
  } catch (err: any) {
    console.error('[ZapAuth] ❌ Login falhou:', err.message);
    throw err;
  }
}

/**
 * Obtém auth com cache + reauth automático
 */
export async function getZapAuth(forceReauth = false): Promise<{
  token: string;
  cookie: string;
  expiresAtISO: string;
  tokenHash: string;
}> {
  const now = Date.now();

  // Se forceReauth ou cache ausente ou expira em < 120s
  if (
    forceReauth ||
    !authCache ||
    authCache.expiresAt - now < 120 * 1000
  ) {
    console.log('[ZapAuth] Reauthenticando...');
    const auth = await loginZap();
    authCache = {
      token: auth.token,
      cookie: auth.cookie,
      expiresAt: auth.expiresAt,
      tokenHash: tokenHash(auth.token),
    };
  }

  const expiresAtISO = new Date(authCache.expiresAt).toISOString();

  return {
    token: authCache.token,
    cookie: authCache.cookie,
    expiresAtISO,
    tokenHash: authCache.tokenHash,
  };
}

/**
 * Retorna status do auth (para prova)
 */
export function getZapAuthStatus(): {
  hasAuth: boolean;
  expiresAtISO: string | null;
  minutesUntilExpiry: number;
  tokenHash: string | null;
} {
  const now = Date.now();

  if (!authCache) {
    return {
      hasAuth: false,
      expiresAtISO: null,
      minutesUntilExpiry: 0,
      tokenHash: null,
    };
  }

  const minutesUntilExpiry = Math.round((authCache.expiresAt - now) / 60 / 1000);
  const expiresAtISO = new Date(authCache.expiresAt).toISOString();

  return {
    hasAuth: true,
    expiresAtISO,
    minutesUntilExpiry,
    tokenHash: authCache.tokenHash,
  };
}
