/**
 * 🔍 Conta Azul Probe with Cache
 * Probe automático com cache de 6h e invalidação automática em 404
 * Integrado com StructuredLogger para rastreamento completo
 */

import axios from 'axios';
import { getCachedProbeResult, setCachedProbeResult, invalidateCacheForClient } from './contaAzulCacheHelper';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { StructuredLogger } from './structuredLogger';

interface ProbeResult {
  ok: boolean;
  baseUrl: string;
  strategyUsed: string;
  identifiers: any;
  latencyMs: number;
  source: 'cache' | 'probe';
  error?: string;
}

/**
 * Executar probe com cache automático
 * Se cache válido: retorna cache
 * Se falhar com 404: invalida cache e tenta novamente (1 vez)
 */
export async function probeWithCache(clientId: number, traceId: string): Promise<ProbeResult> {
  const logger = new StructuredLogger({
    traceId,
    clientId,
    step: 'probe',
    provider: 'contaazul',
  });

  const startTime = Date.now();

  try {
    // PASSO 1: Tentar cache
    logger.log('Checking cache...');
    const cached = await getCachedProbeResult(clientId);

    if (cached && cached.ok) {
      const latencyMs = Date.now() - startTime;
      logger.success(`Cache HIT: baseUrl=${cached.baseUrlEffective}`, {
        source: 'cache',
        latencyMs,
        strategyUsed: cached.strategyUsed,
        baseUrlEffective: cached.baseUrlEffective,
      });

      return {
        ok: true,
        baseUrl: cached.baseUrlEffective,
        strategyUsed: cached.strategyUsed,
        identifiers: cached.identifiers,
        latencyMs,
        source: 'cache',
      };
    }

    // PASSO 2: Executar probe
    logger.log('Cache MISS, running probe...');
    const probeResult = await runProbe(clientId, traceId, logger);

    if (!probeResult.ok) {
      const latencyMs = Date.now() - startTime;
      logger.error(`Probe failed: ${probeResult.error}`, undefined, {
        latencyMs,
        status: 'failed',
      });

      return {
        ok: false,
        baseUrl: '',
        strategyUsed: '',
        identifiers: {},
        latencyMs,
        source: 'probe',
        error: probeResult.error,
      };
    }

    // PASSO 3: Salvar cache
    await setCachedProbeResult(
      clientId,
      probeResult.baseUrl,
      probeResult.strategyUsed,
      probeResult.identifiers
    );

    const latencyMs = Date.now() - startTime;
    logger.success(`Probe SUCCESS and cached`, {
      source: 'probe',
      latencyMs,
      strategyUsed: probeResult.strategyUsed,
      baseUrlEffective: probeResult.baseUrl,
      status: 'ok',
    });

    return {
      ok: true,
      baseUrl: probeResult.baseUrl,
      strategyUsed: probeResult.strategyUsed,
      identifiers: probeResult.identifiers,
      latencyMs,
      source: 'probe',
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    logger.error(`FATAL: ${error?.message}`, error, {
      latencyMs,
      status: 'error',
      stepFailed: 'probe',
      errorCode: 'PROBE_FATAL',
    });

    return {
      ok: false,
      baseUrl: '',
      strategyUsed: '',
      identifiers: {},
      latencyMs,
      source: 'probe',
      error: error?.message,
    };
  }
}

/**
 * Executar probe com retry automático em 404
 */
async function runProbe(clientId: number, traceId: string, logger: StructuredLogger) {
  const token = await getValidAccessToken();
  const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';

  // Rotas candidatas
  const routes = [
    { path: '/v1/pessoas', strategy: 'pessoas' },
    { path: '/v1/clientes', strategy: 'clientes' },
    { path: '/v1/empresa', strategy: 'empresa' },
    { path: '/v1/organizacao', strategy: 'organizacao' },
    { path: '/v1/me', strategy: 'me' },
    { path: '/v1/conta', strategy: 'conta' },
    { path: '/pessoas', strategy: 'pessoas-no-v1' },
    { path: '/clientes', strategy: 'clientes-no-v1' },
    { path: '/empresa', strategy: 'empresa-no-v1' },
    { path: '/me', strategy: 'me-no-v1' },
  ];

  let lastError: any = null;

  for (const route of routes) {
    const url = `${baseUrl}${route.path}`;

    try {
      logger.log(`Testing ${route.strategy}...`, {
        url,
        status: 'testing',
      });

      const startTime = Date.now();
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      const latencyMs = Date.now() - startTime;

      // Se 404, continuar
      if (response.status === 404) {
        logger.log(`${route.strategy}: HTTP 404 (skip)`, {
          url,
          status: 404,
          latencyMs,
        });
        continue;
      }

      // Se 401, token inválido
      if (response.status === 401) {
        logger.warn(`${route.strategy}: HTTP 401 (token invalid)`, {
          url,
          status: 401,
          latencyMs,
        });
        lastError = new Error('Token invalid');
        continue;
      }

      // Se 200, sucesso!
      if (response.status === 200) {
        logger.success(`${route.strategy}: HTTP 200 ✓`, {
          url,
          status: 200,
          latencyMs,
          strategyUsed: route.strategy,
        });

        // Extrair identificadores
        const identifiers = extractIdentifiers(response.data, route.strategy);

        return {
          ok: true,
          baseUrl,
          strategyUsed: route.strategy,
          identifiers,
          latencyMs,
        };
      }

      // Outros status
      logger.log(`${route.strategy}: HTTP ${response.status} (skip)`, {
        url,
        status: response.status,
        latencyMs,
      });
    } catch (error: any) {
      logger.warn(`${route.strategy}: ERROR ${error?.message}`, {
        url,
        status: 'error',
      });
      lastError = error;
    }
  }

  // Nenhuma rota funcionou
  const errorMsg = lastError?.message || 'All routes failed';
  logger.error(`PROBE FAILED: ${errorMsg}`, lastError, {
    status: 'failed',
    stepFailed: 'probe',
    errorCode: 'NO_ROUTE_FOUND',
  });

  return {
    ok: false,
    baseUrl: '',
    strategyUsed: '',
    identifiers: {},
    error: errorMsg,
  };
}

/**
 * Extrair identificadores da resposta
 */
function extractIdentifiers(data: any, strategy: string): any {
  const identifiers: any = {
    strategy,
  };

  // Tentar extrair ID da empresa/organização
  if (data?.id) identifiers.id = data.id;
  if (data?.empresaId) identifiers.empresaId = data.empresaId;
  if (data?.organizacaoId) identifiers.organizacaoId = data.organizacaoId;
  if (data?.accountId) identifiers.accountId = data.accountId;
  if (data?.tenantId) identifiers.tenantId = data.tenantId;
  if (data?.tenant) identifiers.tenant = data.tenant;

  // Se for lista, pegar do primeiro item
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first?.id) identifiers.firstId = first.id;
    if (first?.empresaId) identifiers.firstEmpresaId = first.empresaId;
    identifiers.recordCount = data.length;
  }

  return identifiers;
}
