/**
 * PanelSessionManager
 * Gerencia sessão do painel Conta Azul com cookieJar
 */

import axios, { AxiosInstance } from 'axios';
import { loadPanelSession, invalidatePanelSession } from './capturePanelSession';

const PANEL_BASE_URL = 'https://services.contaazul.com';

/**
 * Criar cliente axios com cookies da sessão
 */
export async function createPanelAxiosClient(): Promise<AxiosInstance | null> {
  try {
    const session = await loadPanelSession();

    if (!session) {
      console.warn('[PanelSessionManager] Nenhuma sessão válida encontrada');
      return null;
    }

    // Montar cookie string
    const cookieString = session.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    // Criar cliente com headers do painel
    const client = axios.create({
      baseURL: PANEL_BASE_URL,
      timeout: 30000,
      headers: {
        'Cookie': cookieString,
        'Origin': 'https://pro.contaazul.com',
        'Referer': 'https://pro.contaazul.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    console.log('[PanelSessionManager] Cliente axios criado com sessão');
    console.log('[PanelSessionManager] Cookies:', session.cookies.length);

    return client;
  } catch (error: any) {
    console.error('[PanelSessionManager] Erro ao criar cliente:', error.message);
    return null;
  }
}

/**
 * Testar acesso ao painel com sessão
 */
export async function testPanelAccessWithSession(
  endpoint: string = '/contaazul-bff/finance/v1/financial-events/test/summary'
): Promise<{ ok: boolean; httpStatus: number; usedCookies: string[]; decision: string; error?: string }> {
  try {
    const client = await createPanelAxiosClient();

    if (!client) {
      return {
        ok: false,
        httpStatus: 0,
        usedCookies: [],
        decision: 'NO_SESSION',
        error: 'Nenhuma sessão válida encontrada',
      };
    }

    const session = await loadPanelSession();
    const usedCookies = session?.cookies.map((c) => c.name) || [];

    console.log('[PanelSessionManager] Testando acesso ao painel:', endpoint);
    console.log('[PanelSessionManager] Cookies usados:', usedCookies);

    const response = await client.get(endpoint);

    console.log('[PanelSessionManager] Acesso OK:', response.status);

    return {
      ok: true,
      httpStatus: response.status,
      usedCookies,
      decision: 'OK_PANEL_SESSION',
    };
  } catch (error: any) {
    const httpStatus = error.response?.status || 0;
    const errorMsg = error.response?.data?.message || error.message;

    console.error('[PanelSessionManager] Acesso FALHOU:', httpStatus);

    const session = await loadPanelSession();
    const usedCookies = session?.cookies.map((c) => c.name) || [];

    // Se 401/403, invalidar sessão
    if (httpStatus === 401 || httpStatus === 403) {
      console.warn('[PanelSessionManager] Sessão expirada ou inválida, invalidando...');
      await invalidatePanelSession();

      return {
        ok: false,
        httpStatus,
        usedCookies,
        decision: 'SESSION_EXPIRED',
        error: errorMsg,
      };
    }

    return {
      ok: false,
      httpStatus,
      usedCookies,
      decision: 'PANEL_AUTH_FAILED',
      error: errorMsg,
    };
  }
}

export default {
  createPanelAxiosClient,
  testPanelAccessWithSession,
};
