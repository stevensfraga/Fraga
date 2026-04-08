/**
 * 🔐 Conta Azul Tenant Check - Multi-Strategy
 * Tenta múltiplas estratégias para validar tenant e extrair identificadores
 * Integrado com StructuredLogger para rastreamento completo
 */

import axios from 'axios';
import { getDb } from './db';
import { clients } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { StructuredLogger } from './structuredLogger';

interface TenantCheckResult {
  ok: boolean;
  strategyUsed?: string;
  identifiers?: {
    empresaId?: string;
    tenant?: string;
    accountId?: string;
    organizacaoId?: string;
  };
  baseUrlEffective?: string;
  error?: string;
  allAttempts?: Array<{
    strategy: string;
    endpoint: string;
    status: number | null;
    latencyMs: number;
    error?: string;
  }>;
}

/**
 * Estratégias de tenant-check ordenadas por probabilidade
 */
const TENANT_CHECK_STRATEGIES = [
  {
    name: 'pessoas-limit1',
    endpoint: '/pessoas?limit=1',
    extractId: (data: any) => ({
      empresaId: data?.empresa_id,
      tenant: data?.tenant,
      accountId: data?.account_id,
    }),
  },
  {
    name: 'clientes-limit1',
    endpoint: '/clientes?limit=1',
    extractId: (data: any) => ({
      empresaId: data?.empresa_id,
      tenant: data?.tenant,
      accountId: data?.account_id,
    }),
  },
  {
    name: 'empresa',
    endpoint: '/empresa',
    extractId: (data: any) => ({
      empresaId: data?.id,
      tenant: data?.tenant,
      accountId: data?.account_id,
    }),
  },
  {
    name: 'organizacao',
    endpoint: '/organizacao',
    extractId: (data: any) => ({
      organizacaoId: data?.id,
      tenant: data?.tenant,
      empresaId: data?.empresa_id,
    }),
  },
  {
    name: 'me',
    endpoint: '/me',
    extractId: (data: any) => ({
      empresaId: data?.empresa_id,
      tenant: data?.tenant,
      accountId: data?.account_id,
    }),
  },
  {
    name: 'conta',
    endpoint: '/conta',
    extractId: (data: any) => ({
      empresaId: data?.id,
      tenant: data?.tenant,
      accountId: data?.account_id,
    }),
  },
];

/**
 * Testar uma estratégia individual
 */
async function testStrategy(
  baseUrl: string,
  strategy: (typeof TENANT_CHECK_STRATEGIES)[0],
  accessToken: string,
  logger: StructuredLogger
): Promise<{
  strategy: string;
  endpoint: string;
  fullUrl: string;
  status: number | null;
  latencyMs: number;
  error?: string;
  data?: any;
  identifiers?: any;
}> {
  const fullUrl = `${baseUrl}${strategy.endpoint}`;
  const startTime = Date.now();

  try {
    logger.log(`Testing strategy: ${strategy.name}`, {
      url: fullUrl,
      status: 'testing',
    });

    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
      validateStatus: () => true,
    });

    const latencyMs = Date.now() - startTime;
    const dataPreview = JSON.stringify(response.data).substring(0, 150);

    logger.log(`${strategy.name}: Status ${response.status}`, {
      url: fullUrl,
      status: response.status,
      latencyMs,
    });

    // Extrair identificadores se status for 200
    let identifiers: any = null;
    if (response.status === 200) {
      identifiers = strategy.extractId(response.data);
      logger.success(`${strategy.name}: Identifiers extracted`, {
        url: fullUrl,
        status: 200,
        latencyMs,
      });
    }

    return {
      strategy: strategy.name,
      endpoint: strategy.endpoint,
      fullUrl,
      status: response.status,
      latencyMs,
      data: response.data,
      identifiers,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error?.message || 'Unknown error';

    logger.warn(`${strategy.name}: Error ${errorMsg}`, {
      url: fullUrl,
      status: 'error',
      latencyMs,
    });

    return {
      strategy: strategy.name,
      endpoint: strategy.endpoint,
      fullUrl,
      status: null,
      latencyMs,
      error: errorMsg,
    };
  }
}

/**
 * Executar tenant-check multi-strategy
 * Retorna primeira estratégia que responde 200
 */
export async function tenantCheckMultiStrategy(
  clientId?: number,
  traceId?: string
): Promise<TenantCheckResult> {
  const logger = new StructuredLogger({
    traceId: traceId || 'unknown',
    clientId,
    step: 'tenant-check',
    provider: 'contaazul',
  });

  try {
    const accessToken = await getValidAccessToken();
    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';

    logger.log(`START: Testing ${TENANT_CHECK_STRATEGIES.length} strategies`, {
      baseUrlEffective: baseUrl,
      status: 'start',
    });

    const allAttempts: TenantCheckResult['allAttempts'] = [];

    for (const strategy of TENANT_CHECK_STRATEGIES) {
      const result = await testStrategy(baseUrl, strategy, accessToken, logger);
      allAttempts.push(result);

      // Se sucesso (status 200), retornar
      if (result.status === 200 && result.identifiers) {
        logger.success(`TENANT-CHECK OK: Strategy ${result.strategy}`, {
          strategyUsed: result.strategy,
          status: 'ok',
          latencyMs: result.latencyMs,
        });

        return {
          ok: true,
          strategyUsed: result.strategy,
          identifiers: result.identifiers,
          baseUrlEffective: baseUrl,
          allAttempts,
        };
      }
    }

    // Nenhuma estratégia funcionou
    logger.error(`TENANT-CHECK FAILED: No strategy returned 200`, undefined, {
      status: 'failed',
      stepFailed: 'tenant-check',
      errorCode: 'NO_STRATEGY_SUCCESS',
    });

    return {
      ok: false,
      strategyUsed: 'none',
      identifiers: {},
      baseUrlEffective: baseUrl,
      error: 'No strategy returned 200',
      allAttempts,
    };
  } catch (error: any) {
    logger.error(`TENANT-CHECK FATAL: ${error?.message}`, error, {
      status: 'error',
      stepFailed: 'tenant-check',
      errorCode: 'TENANT_CHECK_FATAL',
    });

    return {
      ok: false,
      strategyUsed: 'none',
      identifiers: {},
      error: error?.message,
    };
  }
}

/**
 * Validar /pessoas endpoint
 */
export async function validatePessoasEndpoint(
  traceId?: string
): Promise<{
  ok: boolean;
  recordCount: number;
  firstRecord?: any;
  latencyMs: number;
  error?: string;
}> {
  const logger = new StructuredLogger({
    traceId: traceId || 'unknown',
    step: 'pessoas',
    provider: 'contaazul',
  });

  try {
    logger.log('Validating /pessoas endpoint...');

    const accessToken = await getValidAccessToken();
    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';
    const url = `${baseUrl}/pessoas?limit=1`;

    const startTime = Date.now();
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const latencyMs = Date.now() - startTime;

    if (response.status === 200) {
      const recordCount = Array.isArray(response.data) ? response.data.length : 1;
      const firstRecord = Array.isArray(response.data) ? response.data[0] : response.data;

      logger.success(`/pessoas HTTP 200 ✓`, {
        url,
        status: 200,
        latencyMs,
      });

      return {
        ok: true,
        recordCount,
        firstRecord,
        latencyMs,
      };
    }

    logger.error(`/pessoas HTTP ${response.status}`, undefined, {
      url,
      status: response.status,
      latencyMs,
      stepFailed: 'pessoas',
      errorCode: `HTTP_${response.status}`,
    });

    return {
      ok: false,
      recordCount: 0,
      latencyMs,
      error: `HTTP ${response.status}`,
    };
  } catch (error: any) {
    logger.error(`/pessoas ERROR: ${error?.message}`, error, {
      status: 'error',
      stepFailed: 'pessoas',
      errorCode: 'PESSOAS_ERROR',
    });

    return {
      ok: false,
      recordCount: 0,
      latencyMs: 0,
      error: error?.message,
    };
  }
}
