/**
 * Helper para Requisições aos Endpoints do Painel Conta Azul
 * 
 * Gerencia:
 * - Token OAuth com refresh automático
 * - Retry automático em caso de 401/403
 * - Logging detalhado com correlationId
 * - Headers padronizados
 * 
 * Uso:
 * const response = await contaAzulRequest('GET', '/contaazul-bff/finance/v1/financial-events/{id}/summary')
 */

import axios, { AxiosResponse, AxiosError } from 'axios';
import { getValidAccessToken, refreshAccessToken } from './contaAzulOAuthManager';
import { notifyOwner } from './_core/notification';
import crypto from 'crypto';

const PANEL_API_BASE = 'https://services.contaazul.com';

// Headers padrão para todas as requisições
const DEFAULT_HEADERS = {
  'Accept': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Fraga-Dashboard/1.0 (Panel Integration)',
  'Content-Type': 'application/json',
};

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  data?: any;
  params?: Record<string, any>;
  timeout?: number;
  retryCount?: number;
  correlationId?: string;
}

interface RequestResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  correlationId: string;
  endpoint: string;
  timestamp: Date;
  retried?: boolean;
}

/**
 * Gerar correlationId único para rastreabilidade
 */
function generateCorrelationId(): string {
  return `panel-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Fazer requisição com gerenciamento de token e retry
 */
export async function contaAzulRequest<T = any>(
  options: RequestOptions
): Promise<RequestResult<T>> {
  const correlationId = options.correlationId || generateCorrelationId();
  const timeout = options.timeout || 30000;
  const maxRetries = options.retryCount ?? 1;
  
  let lastError: any = null;
  let retried = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Obter token válido
      let token: string;
      try {
        token = await getValidAccessToken();
      } catch (error: any) {
        console.error(`[PanelRequest] ${correlationId} Erro ao obter token:`, error.message);
        return {
          ok: false,
          status: 401,
          error: `Falha ao obter token OAuth: ${error.message}`,
          correlationId,
          endpoint: options.endpoint,
          timestamp: new Date(),
        };
      }

      // Construir URL completa
      const fullUrl = `${PANEL_API_BASE}${options.endpoint}`;

      // Log da requisição
      console.log(`[PanelRequest] ${correlationId} [Attempt ${attempt + 1}/${maxRetries + 1}]`);
      console.log(`  Método: ${options.method}`);
      console.log(`  URL: ${fullUrl}`);
      if (options.params) {
        console.log(`  Params:`, options.params);
      }

      // Fazer requisição
      const response = await axios({
        method: options.method,
        url: fullUrl,
        data: options.data,
        params: options.params,
        headers: {
          ...DEFAULT_HEADERS,
          'Authorization': `Bearer ${token}`,
          'X-Correlation-ID': correlationId,
        },
        timeout,
        validateStatus: () => true, // Não lançar erro para qualquer status
      });

      // Log da resposta
      console.log(`[PanelRequest] ${correlationId} Status: ${response.status}`);

      // Sucesso (2xx)
      if (response.status >= 200 && response.status < 300) {
        console.log(`[PanelRequest] ${correlationId} ✅ Sucesso`);
        return {
          ok: true,
          status: response.status,
          data: response.data,
          correlationId,
          endpoint: options.endpoint,
          timestamp: new Date(),
          retried,
        };
      }

      // Erro 401 ou 403 - Tentar refresh e retry
      if ((response.status === 401 || response.status === 403) && attempt < maxRetries) {
        console.warn(`[PanelRequest] ${correlationId} HTTP ${response.status} - Tentando refresh de token...`);
        
        try {
          // Obter token armazenado para refresh
          const { getDb } = await import('./db');
          const db = await getDb();
          if (!db) throw new Error('Database not available');

          const { contaAzulTokens } = await import('../drizzle/schema');
          const { desc } = await import('drizzle-orm');
          
          const tokens = await db
            .select()
            .from(contaAzulTokens)
            .orderBy((t) => t.updatedAt ? desc(t.updatedAt) : desc(t.createdAt))
            .limit(1);

          if (!tokens.length) {
            throw new Error('Nenhum token armazenado para refresh');
          }

          const tokenRecord = tokens[0];
          
          // Tentar refresh
          const newTokenData = await refreshAccessToken(tokenRecord.refreshToken);
          console.log(`[PanelRequest] ${correlationId} ✅ Token renovado com sucesso`);
          
          retried = true;
          continue; // Retry com novo token
        } catch (refreshError: any) {
          console.error(`[PanelRequest] ${correlationId} ❌ Falha ao renovar token:`, refreshError.message);
          
          // Notificar owner sobre necessidade de reautenticação
          await notifyOwner({
            title: '⚠️ Painel Conta Azul - Reautenticação Necessária',
            content: `Falha ao renovar token OAuth para painel. Erro: ${refreshError.message}. Por favor, reautentique em Configurações → Integrações → Aplicativos.`,
          });

          return {
            ok: false,
            status: response.status,
            error: `Falha ao renovar token: ${refreshError.message}`,
            correlationId,
            endpoint: options.endpoint,
            timestamp: new Date(),
            retried,
          };
        }
      }

      // Erro 4xx ou 5xx sem retry
      if (response.status >= 400) {
        const errorMsg = response.data?.message || response.data?.error || response.statusText;
        console.error(`[PanelRequest] ${correlationId} ❌ HTTP ${response.status}: ${errorMsg}`);
        
        return {
          ok: false,
          status: response.status,
          error: errorMsg || `HTTP ${response.status}`,
          correlationId,
          endpoint: options.endpoint,
          timestamp: new Date(),
          retried,
        };
      }

    } catch (error: any) {
      lastError = error;
      console.error(`[PanelRequest] ${correlationId} Erro na requisição:`, error.message);
      
      if (attempt < maxRetries) {
        console.log(`[PanelRequest] ${correlationId} Retrying em 1s...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
    }
  }

  // Falha após todos os retries
  const errorMsg = lastError?.message || 'Erro desconhecido na requisição';
  console.error(`[PanelRequest] ${correlationId} ❌ Falha após ${maxRetries + 1} tentativas`);
  
  return {
    ok: false,
    status: lastError?.response?.status || 500,
    error: errorMsg,
    correlationId,
    endpoint: options.endpoint,
    timestamp: new Date(),
    retried,
  };
}

/**
 * Wrapper para GET
 */
export async function contaAzulGet<T = any>(
  endpoint: string,
  params?: Record<string, any>,
  correlationId?: string
): Promise<RequestResult<T>> {
  return contaAzulRequest<T>({
    method: 'GET',
    endpoint,
    params,
    correlationId,
  });
}

/**
 * Wrapper para POST
 */
export async function contaAzulPost<T = any>(
  endpoint: string,
  data?: any,
  correlationId?: string
): Promise<RequestResult<T>> {
  return contaAzulRequest<T>({
    method: 'POST',
    endpoint,
    data,
    correlationId,
  });
}

/**
 * Validar conexão com painel
 */
export async function validatePanelConnection(): Promise<{
  ok: boolean;
  status: number;
  message: string;
}> {
  const result = await contaAzulGet('/finance-pro-reader/v1/installment-view?page=1&page_size=1');
  
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok ? 'Conexão com painel OK' : `Erro: ${result.error}`,
  };
}
