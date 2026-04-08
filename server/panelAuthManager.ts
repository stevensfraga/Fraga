/**
 * PanelAuthManager
 * Gerencia autenticação separada para o painel Conta Azul (services.contaazul.com)
 * 
 * O painel usa autenticação diferente da API pública:
 * - API pública (api-v2.contaazul.com): OAuth2
 * - Painel (services.contaazul.com): Sessão/Cookies/JWT do webapp
 */

import axios, { AxiosInstance } from 'axios';
import { getDb } from './db';
import { sql } from 'drizzle-orm';

interface PanelSession {
  id: string;
  cookies: string; // JSON stringified cookie jar
  headers: Record<string, string>;
  expiresAt: Date;
  createdAt: Date;
}

const PANEL_BASE_URL = 'https://services.contaazul.com';
const PANEL_SESSION_TTL = 60 * 60 * 1000; // 1 hora

/**
 * Obter ou criar sessão do painel
 */
export async function getPanelSession(): Promise<PanelSession | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    // Procurar sessão válida
    const result = await db.execute(
      sql`SELECT * FROM panel_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1`
    );

    if (result && result.length > 0) {
      console.log('[PanelAuth] Sessão do painel encontrada e válida');
      return result[0] as unknown as PanelSession;
    }

    console.log('[PanelAuth] Nenhuma sessão válida encontrada');
    return null;
  } catch (error: any) {
    console.error('[PanelAuth] Erro ao obter sessão:', error.message);
    return null;
  }
}

/**
 * Logar 401 completo do painel para diagnóstico
 */
export function logPanelAuthError(error: any, endpoint: string, token: string): void {
  const status = error.response?.status;
  const headers = error.response?.headers || {};
  const data = error.response?.data || {};

  console.error(`[PanelAuth] 401 COMPLETO - ${endpoint}`);
  console.error(`[PanelAuth] HTTP Status: ${status}`);
  console.error(`[PanelAuth] Response Headers:`, JSON.stringify(headers, null, 2));
  console.error(`[PanelAuth] Response Data:`, JSON.stringify(data, null, 2));
  console.error(`[PanelAuth] Token Enviado (prefixo):`, token.substring(0, 30) + '...');
  console.error(`[PanelAuth] WWW-Authenticate:`, headers['www-authenticate'] || 'N/A');
}

/**
 * Criar cliente axios com cookies e headers do painel
 */
export function createPanelClient(session?: PanelSession): AxiosInstance {
  const client = axios.create({
    baseURL: PANEL_BASE_URL,
    timeout: 30000,
    withCredentials: true,
  });

  // Headers padrão do painel
  const defaultHeaders = {
    'Origin': 'https://pro.contaazul.com',
    'Referer': 'https://pro.contaazul.com/',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Fraga-Dashboard/1.0 (Panel Integration)',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  if (session) {
    try {
      const cookies = JSON.parse(session.cookies);
      Object.assign(defaultHeaders, cookies);
      Object.assign(defaultHeaders, session.headers);
    } catch (e) {
      console.warn('[PanelAuth] Erro ao parsear cookies da sessão');
    }
  }

  client.defaults.headers.common = defaultHeaders;

  return client;
}

/**
 * Testar acesso ao painel com token atual
 */
export async function testPanelAccess(
  accessToken: string,
  endpoint: string = '/contaazul-bff/finance/v1/financial-events/test/summary'
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    console.log(`[PanelAuth] Testando acesso ao painel: ${endpoint}`);

    const response = await axios.get(`${PANEL_BASE_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Origin': 'https://pro.contaazul.com',
        'Referer': 'https://pro.contaazul.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log(`[PanelAuth] Acesso OK: ${response.status}`);
    return { ok: true, status: response.status };
  } catch (error: any) {
    const status = error.response?.status || 0;
    const errorMsg = error.response?.data?.message || error.message;

    console.error(`[PanelAuth] Acesso FALHOU: ${status}`);

    if (status === 401) {
      logPanelAuthError(error, endpoint, accessToken);
    }

    return {
      ok: false,
      status,
      error: errorMsg,
    };
  }
}

/**
 * Tentar obter sessão do painel via login automatizado (placeholder)
 * Em produção, isso seria feito via Playwright ou captura de cookies do browser
 */
export async function obtainPanelSession(
  email: string,
  password: string
): Promise<PanelSession | null> {
  try {
    console.log('[PanelAuth] Tentando obter sessão do painel via login...');

    // Placeholder: em produção, usar Playwright ou similar
    // const browser = await chromium.launch();
    // const page = await browser.newPage();
    // await page.goto('https://pro.contaazul.com/login');
    // ... preencher credenciais ...
    // const cookies = await page.context().cookies();
    // ... salvar cookies no DB ...

    console.warn('[PanelAuth] obtainPanelSession não implementado (requer Playwright)');
    return null;
  } catch (error: any) {
    console.error('[PanelAuth] Erro ao obter sessão:', error.message);
    return null;
  }
}

export default {
  getPanelSession,
  testPanelAccess,
  obtainPanelSession,
  createPanelClient,
  logPanelAuthError,
};
