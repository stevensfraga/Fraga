/**
 * PARTE B — ZAP REQUEST WRAPPER COM RETRY 401/403
 * 
 * Wrapper que usa getZapAuth() e faz retry automático
 */

import axios, { AxiosRequestConfig } from 'axios';
import { getZapAuth } from './zapAuth';

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api.zapcontabil.com.br';

interface ZapRequestOptions {
  retryOnAuth?: boolean;
  correlationId?: string;
}

/**
 * Faz request ao Zap com headers corretos e retry automático
 */
export async function zapRequest(
  path: string,
  options: AxiosRequestConfig = {},
  { retryOnAuth = true, correlationId = '' }: ZapRequestOptions = {}
): Promise<{
  httpStatus: number;
  text: string;
  json?: any;
  headers: Record<string, any>;
}> {
  let retryCount = 0;
  const maxRetries = 1;

  async function makeRequest(forceReauth = false): Promise<any> {
    try {
      // Obter auth (com reauth se necessário)
      const auth = await getZapAuth(forceReauth);

      console.log(`[ZapRequest] ${options.method || 'GET'} ${path}`);
      if (correlationId) {
        console.log(`[ZapRequest] CorrelationID: ${correlationId}`);
      }
      console.log(`[ZapRequest] Token hash: ${auth.tokenHash}`);

      // Preparar headers
      const headers: any = {
        ...options.headers,
        'Authorization': `Bearer ${auth.token}`,
        'Cookie': auth.cookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      };

      // Adicionar X-Requested-With para POST /messages
      if (options.method === 'POST' && path.includes('/messages')) {
        headers['X-Requested-With'] = 'XMLHttpRequest';
      }

      // Fazer request
      const response = await axios({
        ...options,
        url: `${ZAP_BASE_URL}${path}`,
        headers,
        timeout: 30000,
      });

      console.log(`[ZapRequest] ✅ HTTP ${response.status}`);

      return {
        httpStatus: response.status,
        text: response.data,
        json: typeof response.data === 'object' ? response.data : null,
        headers: response.headers,
      };
    } catch (err: any) {
      const status = err.response?.status;
      const errorText = err.response?.data?.error || err.message;

      console.error(`[ZapRequest] ❌ HTTP ${status}: ${errorText}`);

      // Se 401/403 e ainda temos retry, fazer reauth
      if ((status === 401 || status === 403) && retryOnAuth && retryCount < maxRetries) {
        console.log(`[ZapRequest] Retrying com forceReauth...`);
        retryCount++;
        return makeRequest(true); // Force reauth
      }

      // Senão, retornar erro
      return {
        httpStatus: status || 500,
        text: errorText,
        json: err.response?.data,
        headers: err.response?.headers || {},
      };
    }
  }

  return makeRequest();
}
