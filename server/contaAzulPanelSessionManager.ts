/**
 * Panel Session Manager - Fallback Opcional
 * 
 * Gerencia cookies de sessão do painel Conta Azul como fallback
 * NOTA: Bearer token (OAuth) é o método preferido
 * Este manager é apenas para casos onde o painel requer cookies
 * 
 * Uso (apenas se necessário):
 * const session = await getPanelSession()
 * // Usar session.cookies em requisições
 */

import axios, { AxiosInstance } from 'axios';
import { getDb } from './db';

interface PanelSession {
  cookies: string[];
  sessionId?: string;
  lastUpdated: Date;
  expiresAt: Date;
}

let cachedSession: PanelSession | null = null;
const SESSION_CACHE_TTL = 60 * 60 * 1000; // 1 hora
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos

/**
 * Obter ou criar sessão do painel
 * NOTA: Usar apenas como fallback se Bearer token não funcionar
 */
export async function getPanelSession(): Promise<PanelSession | null> {
  try {
    // Verificar cache
    if (cachedSession && cachedSession.expiresAt > new Date()) {
      console.log('[PanelSession] Usando sessão em cache');
      return cachedSession;
    }

    console.log('[PanelSession] Criando nova sessão...');

    // Criar nova sessão
    const session = await createPanelSession();
    if (session) {
      cachedSession = session;
      return session;
    }

    return null;
  } catch (error: any) {
    console.error('[PanelSession] Erro ao obter sessão:', error.message);
    return null;
  }
}

/**
 * Criar nova sessão do painel
 */
async function createPanelSession(): Promise<PanelSession | null> {
  try {
    // Criar cliente Axios para capturar cookies
    const client = axios.create({
      baseURL: 'https://services.contaazul.com',
      withCredentials: true,
      timeout: SESSION_TIMEOUT,
    });

    // Fazer requisição inicial para obter cookies de sessão
    // NOTA: Este é um exemplo genérico - pode precisar ajuste conforme API real
    const response = await client.get('/finance-pro-reader/v1/installment-view?page=1&page_size=1');

    // Extrair cookies do header Set-Cookie
    const setCookieHeaders = response.headers['set-cookie'] || [];
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    if (cookies.length === 0) {
      console.warn('[PanelSession] Nenhum cookie retornado');
      return null;
    }

    console.log(`[PanelSession] Sessão criada com ${cookies.length} cookie(s)`);

    const session: PanelSession = {
      cookies,
      sessionId: extractSessionId(cookies),
      lastUpdated: new Date(),
      expiresAt: new Date(Date.now() + SESSION_CACHE_TTL),
    };

    return session;
  } catch (error: any) {
    console.error('[PanelSession] Erro ao criar sessão:', error.message);
    return null;
  }
}

/**
 * Extrair ID de sessão dos cookies
 */
function extractSessionId(cookies: string[]): string | undefined {
  for (const cookie of cookies) {
    // Procurar por JSESSIONID ou similar
    const match = cookie.match(/JSESSIONID=([^;]+)/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Validar sessão
 */
export async function validatePanelSession(): Promise<boolean> {
  try {
    const session = await getPanelSession();
    if (!session) {
      console.warn('[PanelSession] Sessão inválida');
      return false;
    }

    // Fazer requisição de teste com cookies
    const client = axios.create({
      baseURL: 'https://services.contaazul.com',
      withCredentials: true,
      timeout: SESSION_TIMEOUT,
    });

    // Adicionar cookies ao header
    const cookieHeader = session.cookies.join('; ');
    const response = await client.get('/finance-pro-reader/v1/installment-view?page=1&page_size=1', {
      headers: {
        'Cookie': cookieHeader,
      },
    });

    if (response.status === 200) {
      console.log('[PanelSession] ✅ Sessão válida');
      return true;
    }

    console.warn(`[PanelSession] HTTP ${response.status}`);
    return false;
  } catch (error: any) {
    console.error('[PanelSession] Erro ao validar sessão:', error.message);
    return false;
  }
}

/**
 * Limpar cache de sessão
 */
export function clearPanelSessionCache(): void {
  cachedSession = null;
  console.log('[PanelSession] Cache limpo');
}

/**
 * Obter status da sessão
 */
export async function getPanelSessionStatus(): Promise<{
  ok: boolean;
  cached: boolean;
  sessionId?: string;
  expiresIn?: number;
}> {
  try {
    if (!cachedSession) {
      return { ok: false, cached: false };
    }

    const expiresIn = Math.round((cachedSession.expiresAt.getTime() - Date.now()) / 1000);

    return {
      ok: expiresIn > 0,
      cached: true,
      sessionId: cachedSession.sessionId,
      expiresIn,
    };
  } catch (error: any) {
    console.error('[PanelSession] Erro ao obter status:', error.message);
    return { ok: false, cached: false };
  }
}

/**
 * Criar cliente Axios com cookies de sessão
 * NOTA: Usar apenas como fallback
 */
export async function createPanelAxiosClient(): Promise<AxiosInstance | null> {
  try {
    const session = await getPanelSession();
    if (!session) {
      console.warn('[PanelSession] Não foi possível criar cliente com sessão');
      return null;
    }

    const cookieHeader = session.cookies.join('; ');

    const client = axios.create({
      baseURL: 'https://services.contaazul.com',
      headers: {
        'Cookie': cookieHeader,
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: SESSION_TIMEOUT,
    });

    console.log('[PanelSession] Cliente Axios criado com cookies');

    return client;
  } catch (error: any) {
    console.error('[PanelSession] Erro ao criar cliente:', error.message);
    return null;
  }
}

/**
 * NOTA IMPORTANTE:
 * 
 * Este módulo é um FALLBACK OPCIONAL e não deve ser usado por padrão.
 * 
 * Preferência de métodos:
 * 1. Bearer Token (OAuth) - Método preferido, implementado em contaAzulRequest.ts
 * 2. Cookies de Sessão - Fallback, implementado neste arquivo
 * 
 * Se o painel exigir cookies, integrar assim:
 * 
 * import { createPanelAxiosClient } from './contaAzulPanelSessionManager'
 * 
 * const client = await createPanelAxiosClient()
 * if (client) {
 *   const response = await client.get('/endpoint')
 * }
 */
