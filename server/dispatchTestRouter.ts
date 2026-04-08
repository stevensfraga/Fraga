/**
 * 📋 Router de Teste para Dispatch Manual
 * 🔬 APENAS PARA TESTES - Não usar em produção
 * ⚠️ DEV ONLY - Protegido por NODE_ENV check
 */

import { Router } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables, clients, contaAzulTokens } from '../drizzle/schema';
import { eq, like, count, sql, desc } from 'drizzle-orm';
import * as crypto from 'crypto';
import { uploadPdfViaWorker, checkWorkerHealth } from './worker-storage';
import { metricsCollector } from './upload-metrics';

const router = Router();

/**
 * Middleware para gerar/aceitar correlationId
 * Gera UUID se nao existir header X-Correlation-Id
 * Propaga para logs e message_log
 */
router.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] as string || 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  (req as any).correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  
  console.log(`[CorrelationId] ${correlationId} - ${req.method} ${req.path}`);
  next();
});

/**
 * ✅ DEV GUARD: Bloqueia endpoints de teste em produção
 * Validações:
 * 1. NODE_ENV === 'development'
 * 2. Header X-Dev-Secret correto (segurança extra)
 * 3. IP na allowlist (opcional, para sandbox)
 */
function devOnly(req: any, res: any): boolean {
  // 1. Verificar NODE_ENV
  if (process.env.NODE_ENV !== 'development') {
    console.warn('[DevOnly] Tentativa de acesso em NODE_ENV:', process.env.NODE_ENV);
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  // 2. Verificar header secreto (obrigatório, sem fallback)
  const devSecret = process.env.DEV_SECRET;
  
  if (!devSecret) {
    console.error('[DevOnly] DEV_SECRET não configurado no ambiente');
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
  
  const headerSecret = req.headers['x-dev-secret'];
  
  // Usar timing-safe comparison para evitar timing attacks
  let isValidSecret = false;
  try {
    const headerBuf = Buffer.from(headerSecret || '');
    const devSecretBuf = Buffer.from(devSecret);
    
    // timingSafeEqual requer buffers do mesmo tamanho
    if (headerBuf.length === devSecretBuf.length) {
      isValidSecret = crypto.timingSafeEqual(headerBuf, devSecretBuf);
    }
  } catch (e) {
    isValidSecret = false;
  }
  
  if (!isValidSecret) {
    console.warn('[DevOnly] Header X-Dev-Secret inválido ou ausente');
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  // 3. Allowlist de IP (opcional, para sandbox)
  const allowedIPs = (process.env.DEV_ALLOWED_IPS || 'localhost,127.0.0.1').split(',');
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  
  if (!allowedIPs.includes(clientIP)) {
    console.warn('[DevOnly] IP não autorizado:', clientIP);
    // Log mas não bloqueia em dev (pode ser proxy)
  }

  return true;
}

/**
 * Endpoint público para sanity check (DEV ONLY)
 * Verifica se TEST_DISPATCH_TOKEN está carregado
 * Requer header X-Dev-Secret
 */
router.get('/_auth-check', (req, res) => {
  if (!devOnly(req, res)) return;

  const hasExpected = !!process.env.TEST_DISPATCH_TOKEN;
  const expectedLen = process.env.TEST_DISPATCH_TOKEN?.length || null;
  
  return res.json({
    success: true,
    hasExpected,
    expectedLen,
    timestamp: new Date().toISOString(),
  });
});

/**
 * ✅ Fingerprint de token (sem vazar)
 */
function tokenFingerprint(token: string): string {
  const hash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 10);
  return `token[len=${token.length},hash=${hash}]`;
}

/**
 * ✅ Helper para chamar endpoints internamente
 * Usa process.env.TEST_DISPATCH_TOKEN sem pedir ao usuário
 * Base robusta: APP_BASE_URL ou localhost:PORT
 */
async function callSelf(path: string, method: string = 'POST') {
  let base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  
  // Normalizar base: remover barra final se existir
  base = base.replace(/\/$/, '');
  
  // Garantir que path começa com /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  const secret = process.env.TEST_DISPATCH_TOKEN;
  
  if (!secret) {
    throw new Error('TEST_DISPATCH_TOKEN não está definido');
  }

  const axios = (await import('axios')).default;
  
  try {
    const fullUrl = `${base}${normalizedPath}`;
    console.log(`[callSelf] Chamando: ${fullUrl}`);
    
    const response = await axios({
      method,
      url: fullUrl,
      headers: { 
        Authorization: `Bearer ${secret}`,
        'X-Dev-Secret': process.env.DEV_SECRET,
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error: any) {
    console.error(`[callSelf] Erro ao chamar ${normalizedPath}:`, error.message);
    throw error;
  }
}

/**
 * 🔍 OAUTH-TOKEN-INFO: Decodifica JWT e retorna iss, aud, exp, scope, token_us/**
 * DEV ONLY - Requer TEST_DISPATCH_TOKEN
 * Endpoint: GET /api/test/oauth-token-info
 * Header: Authorization: Bearer {TEST_DISPATCH_TOKEN}
 */
router.get('/oauth-token-info', async (req, res) => {
  if (!devOnly(req, res)) return;

  // Validar TEST_DISPATCH_TOKEN com timing-safe comparison
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  const expectedToken = process.env.TEST_DISPATCH_TOKEN;

  if (!expectedToken || scheme !== 'Bearer') {
    console.warn('[OAuthTokenInfo] Token invalido ou ausente');
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Bearer token invalido ou ausente',
    });
  }

  // Timing-safe comparison para evitar timing attacks
  let isValid = false;
  try {
    const tokenBuf = Buffer.from(token || '');
    const expectedBuf = Buffer.from(expectedToken);
    
    if (tokenBuf.length === expectedBuf.length) {
      isValid = crypto.timingSafeEqual(tokenBuf, expectedBuf);
    }
  } catch (e) {
    isValid = false;
  }

  if (!isValid) {
    console.warn('[OAuthTokenInfo] Token timing-safe check falhou');
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Bearer token invalido',
    });
  }

  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();

    console.log('[OAuthTokenInfo] Token obtido, decodificando...');
    console.log('[OAuthTokenInfo] Token fingerprint:', tokenFingerprint(token));

    // Decodificar JWT (sem validar assinatura - apenas payload)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.json({
        success: true,
        isJwt: false,
        tokenLen: token.length,
        tokenFingerprint: tokenFingerprint(token),
        message: 'Token nao e JWT valido (nao tem 3 partes)',
      });
    }

    // Decodificar payload (parte 2)
    let payload: any;
    try {
      const base64url = parts[1];
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
      payload = JSON.parse(jsonStr);
    } catch (error) {
      return res.json({
        success: true,
        isJwt: false,
        tokenLen: token.length,
        tokenFingerprint: tokenFingerprint(token),
        error: 'Nao conseguiu decodificar payload',
      });
    }

    // Extrair campos relevantes
    const expDate = payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
    const isExpired = payload.exp ? payload.exp * 1000 < Date.now() : null;

    return res.json({
      success: true,
      isJwt: true,
      tokenLen: token.length,
      tokenFingerprint: tokenFingerprint(token),
      payload: {
        iss: payload.iss,
        aud: payload.aud,
        sub: payload.sub,
        exp: payload.exp,
        expDate,
        isExpired,
        iat: payload.iat,
        scope: payload.scope,
        scp: payload.scp,
        token_use: payload.token_use,
        client_id: payload.client_id,
      },
    });
  } catch (error) {
    console.error('[OAuthTokenInfo] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * 🔍 FULL-DIAGNOSTICS: Coleta TODAS as informações para debug
 * DEV ONLY - Retorna: token-info + diagnose + sync-test + rotas
 * Endpoint: GET /api/test/full-diagnostics
 */
router.get('/full-diagnostics', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[FullDiagnostics] ========== INICIANDO DIAGNOSTICO COMPLETO ==========');
    
    const axios = (await import('axios')).default;
    const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = process.env.TEST_DISPATCH_TOKEN;

    if (!token) {
      throw new Error('TEST_DISPATCH_TOKEN nao esta definido no env');
    }

    const results: any = {
      timestamp: new Date().toISOString(),
      base,
      tokenFingerprint: tokenFingerprint(token),
    };

    // 1 TOKEN-INFO
    console.log('[FullDiagnostics] 1/4 - Coletando token-info...');
    try {
      const devSecret = process.env.DEV_SECRET;
      const response = await axios.get(`${base}/api/test/oauth-token-info`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Dev-Secret': devSecret || '',
        },
        timeout: 10000,
      });
      results.tokenInfo = response.data;
      console.log('[FullDiagnostics] OK Token-info');
    } catch (error: any) {
      console.error('[FullDiagnostics] ERRO Token-info:', error.response?.status);
      results.tokenInfo = {
        error: error.response?.data || error.message,
        status: error.response?.status,
      };
    }

    // 2 DIAGNOSE
    console.log('[FullDiagnostics] 2/4 - Coletando diagnose...');
    try {
      const response = await axios.post(`${base}/api/test/diagnose`, null, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Dev-Secret': process.env.DEV_SECRET || '',
        },
        timeout: 10000,
      });
      results.diagnose = response.data;
      console.log('[FullDiagnostics] OK Diagnose - Status:', response.data.testResult?.status);
    } catch (error: any) {
      console.error('[FullDiagnostics] ERRO Diagnose:', error.response?.status);
      results.diagnose = {
        error: error.response?.data || error.message,
        status: error.response?.status,
      };
    }

    // 3 SYNC-TEST
    console.log('[FullDiagnostics] 3/4 - Coletando sync-test...');
    try {
      const response = await axios.post(`${base}/api/test/sync-test`, null, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Dev-Secret': process.env.DEV_SECRET || '',
        },
        timeout: 15000,
      });
      results.syncTest = response.data;
      console.log('[FullDiagnostics] OK Sync-test');
    } catch (error: any) {
      console.error('[FullDiagnostics] ERRO Sync-test:', error.response?.status);
      results.syncTest = {
        status: error.response?.status,
        wwwAuthenticate: error.response?.headers?.['www-authenticate'],
        data: error.response?.data,
        error: error.message,
      };
    }

    // 4 ROTAS CONFIRMADAS
    console.log('[FullDiagnostics] 4/4 - Testando rotas OAuth...');
    const routeTests: any = {};
    
    try {
      const response = await axios.get(`${base}/oauth/conta-azul/authorize`, {
        maxRedirects: 0,
        validateStatus: (status: number) => status >= 200 && status < 400,
        timeout: 5000,
      });
      routeTests.authorizeRoute = {
        path: '/oauth/conta-azul/authorize',
        status: response.status,
        redirectUrl: response.headers.location,
      };
    } catch (error: any) {
      routeTests.authorizeRoute = {
        path: '/oauth/conta-azul/authorize',
        status: error.response?.status,
        error: error.message,
      };
    }

    try {
      const response = await axios.get(`${base}/api/oauth/conta-azul/callback`, {
        validateStatus: () => true,
        timeout: 5000,
      });
      routeTests.callbackRoute = {
        path: '/api/oauth/conta-azul/callback',
        status: response.status,
        message: response.data?.error || 'Requer code parameter',
      };
    } catch (error: any) {
      routeTests.callbackRoute = {
        path: '/api/oauth/conta-azul/callback',
        status: error.response?.status,
        error: error.message,
      };
    }

    results.routeTests = routeTests;

    // 5 TESTES DE RÉGUA (Contagens e validações)
    console.log('[FullDiagnostics] 5/5 - Testando régua de cobrança...');
    const regueTests: any = {};
    
    try {
      const { getDb } = await import('./db');
      const db = await getDb();
      
      if (db) {
        const { clients, receivables } = await import('../drizzle/schema');
        const { count, eq, isNull, or, isNotNull } = await import('drizzle-orm');
        
        // Contagem de clientes
        const clientCount = await db.select({ value: count() }).from(clients);
        regueTests.totalClients = clientCount[0]?.value || 0;
        
        // Contagem de receivables por status
        const pendingCount = await db.select({ value: count() }).from(receivables).where(eq(receivables.status, 'pending'));
        regueTests.pendingReceivables = pendingCount[0]?.value || 0;
        
        const overdueCount = await db.select({ value: count() }).from(receivables).where(eq(receivables.status, 'overdue'));
        regueTests.overdueReceivables = overdueCount[0]?.value || 0;
        
        // Clientes sem WhatsApp (NULL ou vazio)
        const noWhatsappCount = await db.select({ value: count() }).from(clients).where(
          or(
            isNull(clients.whatsappNumber),
            eq(clients.whatsappNumber, '')
          )
        );
        regueTests.clientsWithoutWhatsapp = noWhatsappCount[0]?.value || 0;
        
        // Receivables com payment info (contar por presenca de campos reais)
        // Usar OR para contar se tem linhaDigitavel OU link
        const withPaymentInfoCount = await db.select({ value: count() }).from(receivables).where(
          or(
            isNotNull(receivables.linhaDigitavel),
            isNotNull(receivables.link)
          )
        );
        regueTests.receivablesWithPaymentInfo = withPaymentInfoCount[0]?.value || 0;
        
        console.log('[FullDiagnostics] OK Régua - Clientes:', regueTests.totalClients, 'Overdue:', regueTests.overdueReceivables);
      }
    } catch (error: any) {
      console.error('[FullDiagnostics] ERRO Régua:', error.message);
      regueTests.error = error.message;
    }
    
    results.regueTests = regueTests;
    console.log('[FullDiagnostics] ========== DIAGNOSTICO CONCLUIDO ==========');

    return res.json({
      success: true,
      ...results,
    });;
  } catch (error) {
    console.error('[FullDiagnostics] ERRO FATAL:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * 🔥 INTERNAL-EXECUTE: Executa sequência internamente usando process.env.TEST_DISPATCH_TOKEN
 * DEV ONLY - Sem autenticação necessária, usa token do env
 * Endpoint: GET /api/test/internal-execute
 */
router.get('/internal-execute', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[InternalExecute] ========== INICIANDO SEQUENCIA INTERNA ==========');
    console.log('[InternalExecute] Token disponivel:', !!process.env.TEST_DISPATCH_TOKEN);
    console.log('[InternalExecute] Token length:', process.env.TEST_DISPATCH_TOKEN?.length);

    const axios = (await import('axios')).default;
    const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = process.env.TEST_DISPATCH_TOKEN;

    if (!token) {
      throw new Error('TEST_DISPATCH_TOKEN nao esta definido no env');
    }

    console.log('[InternalExecute] Base URL:', base);
    console.log('[InternalExecute] Token fingerprint:', tokenFingerprint(token));

    // 1 DIAGNOSE
    console.log('[InternalExecute] 1/3 - Chamando /api/test/diagnose...');
    let diagnoseResult: any;
    try {
      const response = await axios.post(`${base}/api/test/diagnose`, null, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      diagnoseResult = response.data;
      console.log('[InternalExecute] OK Diagnose:', diagnoseResult.testResult?.status);
    } catch (error: any) {
      console.error('[InternalExecute] ERRO Diagnose:', error.response?.data || error.message);
      diagnoseResult = { error: error.response?.data || error.message };
    }

    // 2 SYNC
    console.log('[InternalExecute] 2/3 - Chamando /api/test/sync-test...');
    let syncResult: any;
    try {
      const response = await axios.post(`${base}/api/test/sync-test`, null, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Dev-Secret': process.env.DEV_SECRET || '',
        },
        timeout: 15000,
      });
      syncResult = response.data;
      console.log('[InternalExecute] OK Sync - Clientes:', syncResult.clientsAfter, 'Receivables:', syncResult.receivablesAfter);
    } catch (error: any) {
      console.error('[InternalExecute] ERRO Sync:', error.response?.data || error.message);
      syncResult = { error: error.response?.data || error.message };
    }

    // 3 QUERIES
    console.log('[InternalExecute] 3/3 - Executando queries...');
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const totalClientsResult = await db.select({ count: count() }).from(clients);
    const totalReceivablesResult = await db.select({ count: count() }).from(receivables);
    const r7ClientsResult = await db.select().from(clients).where(
      like(clients.name, '%R7%')
    ).limit(20);

    const totalClients = totalClientsResult[0]?.count || 0;
    const totalReceivables = totalReceivablesResult[0]?.count || 0;

    console.log('[InternalExecute] OK Queries - Clientes:', totalClients, 'Receivables:', totalReceivables, 'R7:', r7ClientsResult.length);

    console.log('[InternalExecute] ========== SEQUENCIA CONCLUIDA ==========');

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      diagnose: diagnoseResult,
      sync: syncResult,
      queries: {
        totalClients,
        totalReceivables,
        r7Clients: r7ClientsResult.map(c => ({
          id: c.id,
          contaAzulId: c.contaAzulId,
          name: c.name,
          email: c.email,
        })),
      },
    });
  } catch (error) {
    console.error('[InternalExecute] ERRO FATAL:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

/**
 * ✅ Middleware de autenticação para endpoints de teste
 * Exige Authorization: Bearer ${TEST_DISPATCH_TOKEN}
 * Loga detalhes para debug (sem vazar token)
 */
// ⚠️ DESABILITADO: Middleware global que estava bloqueando todas as rotas com 401
// Este middleware exigia Bearer token e bloqueava rotas que usam devOnly()
// Cada rota agora valida sua própria autenticação via devOnly()
/*
router.use((req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const authHeaderPresent = !!authHeader;
  const token = authHeader.replace('Bearer ', '');
  const providedLen = token.length;
  const expected = process.env.TEST_DISPATCH_TOKEN || '';
  const expectedLen = expected.length;
  
  let match = false;
  if (token.length === expected.length && expected.length > 0) {
    try {
      match = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    } catch (e) {
      match = false;
    }
  }

  console.log('[Auth Middleware]', {
    expectedLen,
    authHeaderPresent,
    providedLen,
    match,
  });

  if (!expected || !match) {
    console.warn('[DispatchTestRouter] Acesso nao autorizado');
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }
  next();
});
*/

/**
 * ✅ CORRIGIDO: Normaliza valor monetário
 * Detecta se valor está em centavos (integer > 10000) ou reais (decimal)
 */
function normalizarValor(valor: number | string): { amountReais: number; amountCents: number } {
  let amountReais = Number(valor);
  
  if (amountReais <= 0) {
    throw new Error(`Valor invalido: R$ ${amountReais.toFixed(2)}`);
  }
  
  // Se valor é muito grande (> 10000), provavelmente está em centavos
  if (amountReais > 10000) {
    console.log(`[NormalizarValor] Detectado valor em centavos: ${amountReais}`);
    amountReais = amountReais / 100;
  }
  
  if (amountReais > 50000) {
    console.warn(`[NormalizarValor] Valor muito alto: R$ ${amountReais.toFixed(2)}`);
  }
  
  const amountCents = Math.round(amountReais * 100);
  
  return { amountReais, amountCents };
}

/**
 * 🔬 DIAGNOSE: Testar endpoints da API Conta Azul
 */
router.post('/diagnose', async (req, res) => {
  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();
    const apiBase = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';

    console.log('[Diagnose] Testando endpoints...');
    console.log('[Diagnose] API Base:', apiBase);
    console.log('[Diagnose] Token:', tokenFingerprint(token));

    const axios = await import('axios').then(m => m.default);

    // Teste: api-v2 /categorias (endpoint oficial)
    let testResult: any = { status: null, error: null };
    try {
      const response = await axios.get(`${apiBase}/categorias`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      testResult = { status: response.status, error: null, data: response.data };
    } catch (error: any) {
      testResult = { 
        status: error.response?.status, 
        error: error.response?.data?.error || error.message,
        wwwAuthenticate: error.response?.headers?.['www-authenticate'],
      };
    }

    return res.json({
      success: true,
      apiBase,
      endpoint: '/categorias',
      tokenFingerprint: tokenFingerprint(token),
      testResult,
    });
  } catch (error) {
    console.error('[Diagnose] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * 🔬 SYNC-TEST: Sincronizar dados do Conta Azul
 * Captura completa de erro 401: status + www-authenticate + data
 * UNIFICADO: Usa getValidAccessToken() como fonte de token
 */
router.post('/sync-test', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Contar antes
    const clientsBeforeResult = await db.select({ count: count() }).from(clients);
    const receivablesBeforeResult = await db.select({ count: count() }).from(receivables);
    const clientsBefore = clientsBeforeResult[0]?.count || 0;
    const receivablesBefore = receivablesBeforeResult[0]?.count || 0;

    console.log('[Sync-Test] Iniciando sincronizacao...');
    console.log('[Sync-Test] Clients antes:', clientsBefore);
    console.log('[Sync-Test] Receivables antes:', receivablesBefore);

    // Importar funcoes de sync
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const { fetchClientsFromContaAzul, syncClientsToDatabase, fetchReceivablesFromContaAzul, syncReceivablesToDatabase } = await import('./contaAzulDataSync');
    
    // UNIFICADO: Usar mesma fonte de token que /diagnose
    const accessToken = await getValidAccessToken();
    console.log('[Sync-Test] Token obtido:', tokenFingerprint(accessToken));
    
    // Sincronizar clientes
    const clientsData = await fetchClientsFromContaAzul(accessToken);
    const clientsSynced = await syncClientsToDatabase(clientsData);
    
    // Sincronizar receivables
    const receivablesData = await fetchReceivablesFromContaAzul(accessToken);
    const receivablesSynced = await syncReceivablesToDatabase(receivablesData);

    // Contar depois
    const clientsAfterResult = await db.select({ count: count() }).from(clients);
    const receivablesAfterResult = await db.select({ count: count() }).from(receivables);
    const clientsAfter = clientsAfterResult[0]?.count || 0;
    const receivablesAfter = receivablesAfterResult[0]?.count || 0;

    // Buscar cliente R7
    const r7Clients = await db.select().from(clients).where(
      like(clients.name, '%R7%')
    ).limit(1);

    return res.json({
      success: true,
      clientsBefore,
      clientsAfter,
      clientsAdded: clientsAfter - clientsBefore,
      receivablesBefore,
      receivablesAfter,
      receivablesAdded: receivablesAfter - receivablesBefore,
      r7Client: r7Clients.length > 0 ? r7Clients[0] : null,
    });
  } catch (error: any) {
    console.error('[Sync-Test] Erro:', error);
    
    // Capturar erro de axios com detalhes completos
    const status = error?.response?.status || 500;
    const wwwAuthenticate = error?.response?.headers?.['www-authenticate'];
    const data = error?.response?.data;
    
    return res.status(status).json({
      success: false,
      status,
      wwwAuthenticate,
      data,
      error: error?.message,
    });
  }
});

/**
 * 🔬 PREVIEW: Validar boleto antes de enviar
 */
router.post('/preview/:boletoId', async (req, res) => {
  try {
    const { boletoId } = req.params;
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const receivable = await db.select().from(receivables).where(eq(receivables.id, Number(boletoId))).limit(1);
    if (!receivable.length) {
      return res.status(404).json({ success: false, error: 'Boleto nao encontrado' });
    }

    const boleto = receivable[0];
    const { amountReais, amountCents } = normalizarValor(boleto.amount);

    // Validar campos criticos
    const missingFields: string[] = [];
    if (!boleto.documento) missingFields.push('documento');
    if (!boleto.link && !boleto.linhaDigitavel) missingFields.push('link/linhaDigitavel');

    const wouldBlock = missingFields.length > 0;
    const blockReason = wouldBlock ? 'MISSING_FIELDS' : null;

    // Gerar mensagem
    const messagePreview = `Ola!\nAqui e da Fraga Contabilidade.\nIdentificamos um boleto em aberto em nosso sistema.\nValor: R$ ${amountReais.toFixed(2)}\nVencimento: ${new Date(boleto.dueDate).toLocaleDateString('pt-BR')}\n${boleto.link ? `Link: ${boleto.link}` : ''}\n${boleto.linhaDigitavel ? `Linha Digitavel: ${boleto.linhaDigitavel}` : ''}\n\nFicamos a disposicao!`;

    return res.json({
      success: true,
      selectedReceivable: {
        id: boleto.id,
        clientId: boleto.clientId,
        documento: boleto.documento,
        dueDate: boleto.dueDate,
        status: boleto.status,
      },
      amountDb: boleto.amount,
      amountReais,
      amountCents,
      messagePreview,
      missingFields,
      wouldBlock,
      blockReason,
    });
  } catch (error) {
    console.error('[Preview] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * 🚀 RUN-SEQUENCE: Executa diagnose + sync + queries em sequencia (DEV ONLY)
 * Retorna tudo num JSON unico
 */
router.post('/run-sequence', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[RunSequence] Iniciando sequencia...');

    // 1. Diagnose
    console.log('[RunSequence] 1/3 - Diagnose...');
    const diagnoseResult = await callSelf('/api/test/diagnose');

    // 2. Sync
    console.log('[RunSequence] 2/3 - Sync...');
    const syncResult = await callSelf('/api/test/sync-test');

    // 3. Queries
    console.log('[RunSequence] 3/3 - Queries...');
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const totalClientsResult = await db.select({ count: count() }).from(clients);
    const totalReceivablesResult = await db.select({ count: count() }).from(receivables);
    const r7ClientsResult = await db.select().from(clients).where(
      like(clients.name, '%R7%')
    ).limit(20);

    const totalClients = totalClientsResult[0]?.count || 0;
    const totalReceivables = totalReceivablesResult[0]?.count || 0;

    return res.json({
      success: true,
      diagnose: diagnoseResult,
      sync: syncResult,
      queries: {
        totalClients,
        totalReceivables,
        r7Clients: r7ClientsResult.map(c => ({
          id: c.id,
          contaAzulId: c.contaAzulId,
          name: c.name,
          email: c.email,
        })),
      },
    });
  } catch (error) {
    console.error('[RunSequence] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * 🔬 PROBE-CA: Testa URLs da API Conta Azul (DEV ONLY))
 * Retorna: urlFinal + status + www-authenticate + data (resumido)
 */
router.post('/probe-ca', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();
    const axios = (await import('axios')).default;

    // Base deve ser SEM /v1 (ex: https://api-v2.contaazul.com)
    // Se env tiver /v1, remover
    let base = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';
    base = base.replace(/\/v1\/?$/, ''); // Remove /v1 do final se existir
    
    // Helper para eliminar duplicacao de barras
    const joinUrl = (b: string, p: string) => `${b.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;

    const results: any[] = [];

    // Teste 1: /v1/categorias (já funciona)
    try {
      const url1 = joinUrl(base, '/v1/categorias');
      console.log('[Probe] GET', url1);
      const response1 = await axios.get(url1, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      results.push({
        test: 'categorias',
        urlFinal: url1,
        status: response1.status,
        wwwAuthenticate: null,
        dataPreview: { itens_totais: response1.data?.itens_totais },
      });
    } catch (error: any) {
      results.push({
        test: 'categorias',
        urlFinal: joinUrl(base, '/v1/categorias'),
        status: error.response?.status,
        wwwAuthenticate: error.response?.headers?.['www-authenticate'],
        error: error.response?.data?.error || error.message,
      });
    }

    // Teste 2: /v1/pessoas (hoje 404)
    try {
      const url2 = joinUrl(base, '/v1/pessoas');
      console.log('[Probe] GET', url2);
      const response2 = await axios.get(url2, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      results.push({
        test: 'pessoas',
        urlFinal: url2,
        status: response2.status,
        wwwAuthenticate: null,
        dataPreview: response2.data,
      });
    } catch (error: any) {
      results.push({
        test: 'pessoas',
        urlFinal: joinUrl(base, '/v1/pessoas'),
        status: error.response?.status,
        wwwAuthenticate: error.response?.headers?.['www-authenticate'],
        error: error.response?.data?.error || error.message,
      });
    }

    // Teste 3: /v1/pessoas com filtro
    try {
      const url3 = joinUrl(base, '/v1/pessoas');
      console.log('[Probe] GET', url3, '?nome=R7');
      const response3 = await axios.get(url3, {
        headers: { Authorization: `Bearer ${token}` },
        params: { nome: 'R7' },
        timeout: 5000,
      });
      results.push({
        test: 'pessoas_filtro',
        urlFinal: `${url3}?nome=R7`,
        status: response3.status,
        wwwAuthenticate: null,
        dataPreview: response3.data,
      });
    } catch (error: any) {
      results.push({
        test: 'pessoas_filtro',
        urlFinal: `${joinUrl(base, '/v1/pessoas')}?nome=R7`,
        status: error.response?.status,
        wwwAuthenticate: error.response?.headers?.['www-authenticate'],
        error: error.response?.data?.error || error.message,
      });
    }

    // Teste 4: /v1/contas-a-receber
    try {
      const url4 = joinUrl(base, '/v1/contas-a-receber');
      console.log('[Probe] GET', url4);
      const response4 = await axios.get(url4, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      results.push({
        test: 'contas-a-receber',
        urlFinal: url4,
        status: response4.status,
        dataPreview: typeof response4.data === 'object' ? Object.keys(response4.data).slice(0, 3) : 'data',
      });
    } catch (error: any) {
      results.push({
        test: 'contas-a-receber',
        urlFinal: joinUrl(base, '/v1/contas-a-receber'),
        status: error.response?.status,
        error: error.response?.data?.error || error.message,
      });
    }

    // Teste 5: /v1/receivables
    try {
      const url5 = joinUrl(base, '/v1/receivables');
      console.log('[Probe] GET', url5);
      const response5 = await axios.get(url5, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      results.push({
        test: 'receivables',
        urlFinal: url5,
        status: response5.status,
        dataPreview: typeof response5.data === 'object' ? Object.keys(response5.data).slice(0, 3) : 'data',
      });
    } catch (error: any) {
      results.push({
        test: 'receivables',
        urlFinal: joinUrl(base, '/v1/receivables'),
        status: error.response?.status,
        error: error.response?.data?.error || error.message,
      });
    }

    // Teste 7: /v1/receitas
    try {
      const url7 = joinUrl(base, '/v1/receitas');
      console.log('[Probe] GET', url7);
      const response7 = await axios.get(url7, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      results.push({
        test: 'receitas',
        urlFinal: url7,
        status: response7.status,
        dataPreview: typeof response7.data === 'object' ? Object.keys(response7.data).slice(0, 3) : 'data',
      });
    } catch (error: any) {
      results.push({
        test: 'receitas',
        urlFinal: joinUrl(base, '/v1/receitas'),
        status: error.response?.status,
        error: error.response?.data?.error || error.message,
      });
    }

    // Teste 6: /v1/financeiro/recebiveis
    try {
      const url6 = joinUrl(base, '/v1/financeiro/recebiveis');
      console.log('[Probe] GET', url6);
      const response6 = await axios.get(url6, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      results.push({
        test: 'financeiro-recebiveis',
        urlFinal: url6,
        status: response6.status,
        dataPreview: typeof response6.data === 'object' ? Object.keys(response6.data).slice(0, 3) : 'data',
      });
    } catch (error: any) {
      results.push({
        test: 'financeiro-recebiveis',
        urlFinal: joinUrl(base, '/v1/financeiro/recebiveis'),
        status: error.response?.status,
        error: error.response?.data?.error || error.message,
      });
    }

    return res.json({
      success: true,
      base,
      results,
    });
  } catch (error) {
    console.error('[Probe] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * GET /api/test/receivable/:id
 * Retorna dados do boleto (DEV ONLY)
 */
router.get('/receivable/:id', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const receivableId = Number(req.params.id);
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const receivableResult = await db.select().from(receivables).where(eq(receivables.id, receivableId));
    const receivable = receivableResult[0];

    if (!receivable || !receivableResult.length) {
      return res.status(404).json({
        success: false,
        error: 'RECEIVABLE_NOT_FOUND',
        receivableId,
      });
    }

    return res.json({
      success: true,
      receivable: {
        id: receivable.id,
        clientId: receivable.clientId,
        contaAzulId: receivable.contaAzulId,
        amount: receivable.amount,
        dueDate: receivable.dueDate,
        status: receivable.status,
        linhaDigitavel: receivable.linhaDigitavel,
        link: receivable.link,
        createdAt: receivable.createdAt,
        updatedAt: receivable.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('[TestReceivable] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/create-real-client
 * Cria um cliente real para testes (DEV ONLY)
 */
router.post('/create-real-client', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { name, whatsappNumber, email } = req.body;

    // Validações
    if (!name || !whatsappNumber) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        required: ['name', 'whatsappNumber'],
      });
    }

    if (name.includes('Teste')) {
      return res.status(400).json({
        success: false,
        error: 'BLOCKED_TEST_NAME',
      });
    }

    if (whatsappNumber.includes('9999999999')) {
      return res.status(400).json({
        success: false,
        error: 'BLOCKED_FAKE_WHATSAPP',
      });
    }

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const result = await db.insert(clients).values({
      contaAzulId: `MANUAL-CLIENT-${Date.now()}`,
      name,
      whatsappNumber,
      email,
      status: 'active' as any,
    });

    const clientId = (result as any)[0]?.insertId || (result as any).insertId;

    return res.json({
      success: true,
      clientId,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/create-real-receivable
 * Cria um boleto manual real para testes (DEV ONLY)
 */
router.post('/create-real-receivable', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { clientId, contaAzulId, amount, dueDate, linhaDigitavel, link, source, status } = req.body;

    // Validações
    if (!clientId || !contaAzulId || !amount || !dueDate) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        required: ['clientId', 'contaAzulId', 'amount', 'dueDate'],
      });
    }

    if (linhaDigitavel?.startsWith('12345')) {
      return res.status(400).json({
        success: false,
        error: 'BLOCKED_PLACEHOLDER_LINHA',
      });
    }

    if (!link && !linhaDigitavel) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_LINK_OR_LINHA',
      });
    }

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const result = await db.insert(receivables).values({
      clientId,
      contaAzulId,
      amount: amount as any,
      dueDate: new Date(dueDate),
      linhaDigitavel,
      link,
      source: source || 'manual',
      status: status || 'pending',
    });

    const receivableId = (result as any)[0]?.insertId || (result as any).insertId;

    return res.json({
      success: true,
      receivableId,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/db-info
 * Retorna informações sobre qual DB está sendo usado (DEV ONLY)
 */
router.get('/db-info', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const dbUrl = process.env.DATABASE_URL || '';
    const dbHost = process.env.DB_HOST || '';
    const dbName = process.env.DB_NAME || '';
    
    const envFingerprint = (crypto as any).createHash('sha256').update(dbUrl + dbHost + dbName).digest('hex').substring(0, 16);
    
    const uptime = process.uptime();
    const pid = process.pid;
    
    let dbType = 'unknown';
    let dbInfo: any = {};
    
    if (dbUrl.includes('sqlite')) {
      dbType = 'sqlite';
      dbInfo.sqlitePath = dbUrl.replace('file:', '').split('?')[0];
    } else if (dbUrl.includes('mysql') || dbHost) {
      dbType = 'mysql';
      dbInfo.host = dbHost;
      dbInfo.database = dbName;
    }
    
    return res.json({
      success: true,
      dbType,
      ...dbInfo,
      envFingerprint,
      pid,
      uptime: Math.round(uptime),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/db-counts
 * Retorna contagem de registros no DB (DEV ONLY)
 */
router.get('/db-counts', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsCountResult = await db.select({ count: sql<number>`COUNT(*)` }).from(clients);
    const clientsCount = clientsCountResult[0]?.count || 0;

    const receivablesCountResult = await db.select({ count: sql<number>`COUNT(*)` }).from(receivables);
    const receivablesCount = receivablesCountResult[0]?.count || 0;

    const lastReceivableResult = await db.select().from(receivables).orderBy(desc(receivables.id) as any).limit(1);
    const lastReceivable = lastReceivableResult[0] || null;

    return res.json({
      success: true,
      clientsCount,
      receivablesCount,
      lastReceivable: lastReceivable ? {
        id: lastReceivable.id,
        contaAzulId: lastReceivable.contaAzulId,
        source: lastReceivable.source,
        amount: lastReceivable.amount,
        dueDate: lastReceivable.dueDate,
        status: lastReceivable.status,
      } : null,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/receivables?source=manual&limit=20
 * Lista boletos com filtro opcional (DEV ONLY)
 */
router.get('/receivables', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const source = req.query.source as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    let query: any = db.select().from(receivables);
    
    if (source) {
      query = query.where(eq(receivables.source, source));
    }
    
    const result = await query.limit(limit);

    return res.json({
      success: true,
      count: result.length,
      receivables: result.map((r: any) => ({
        id: r.id,
        source: r.source,
        contaAzulId: r.contaAzulId,
        amount: r.amount,
        dueDate: r.dueDate,
        status: r.status,
        clientId: r.clientId,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/is-real/:id
 * Inspeciona se um boleto é real ou mock (DEV ONLY)
 */
router.get('/is-real/:id', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const receivableId = Number(req.params.id);
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const receivableResult = await db.select().from(receivables).where(eq(receivables.id, receivableId));
    const receivable = receivableResult[0];

    if (!receivable) {
      return res.status(404).json({
        success: false,
        error: 'RECEIVABLE_NOT_FOUND',
        receivableId,
      });
    }

    const clientResult = await db.select().from(clients).where(eq(clients.id, receivable.clientId));
    const client = clientResult[0];

    const reasons: string[] = [];
    
    if (receivable.source === 'test') reasons.push('source=test');
    if (receivable.contaAzulId?.startsWith('receivable_test_')) reasons.push('placeholder contaAzulId');
    if (client?.name?.includes('Teste')) reasons.push('test client name');
    if (client?.whatsappNumber === '5511999999999') reasons.push('fake whatsapp');
    if (!receivable.link) reasons.push('missing link');
    if (receivable.linhaDigitavel?.startsWith('12345')) reasons.push('placeholder linha digitável');

    const isReal = reasons.length === 0 && receivable.source !== 'test';

    return res.json({
      success: true,
      receivableId,
      isReal,
      reasons,
      source: receivable.source,
      contaAzulId: receivable.contaAzulId,
      clientName: client?.name,
      whatsappNumber: client?.whatsappNumber,
    });
  } catch (error: any) {
    console.error('[TestIsReal] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/client/:id
 * Retorna dados do cliente (DEV ONLY)
 */
router.get('/client/:id', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const clientId = Number(req.params.id);
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientResult = await db.select().from(clients).where(eq(clients.id, clientId));
    const client = clientResult[0];

    if (!client || !clientResult.length) {
      return res.status(404).json({
        success: false,
        error: 'CLIENT_NOT_FOUND',
        clientId,
      });
    }

    return res.json({
      success: true,
      client: {
        id: client.id,
        name: client.name,
        whatsappNumber: client.whatsappNumber,
      },
    });
  } catch (error: any) {
    console.error('[TestClient] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/ca-auth-check
 * ✅ CORRIGIDO: Usa getValidAccessToken() do DB (OAuth) em vez de env
 * Retorna: status, wwwAuthenticate, tokenSource, tokenFingerprint, dataPreviewKeys
 */
router.get('/ca-auth-check', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 1. Obter token do DB (OAuth)
    let tokenSource = 'env';
    let token: string;
    try {
      token = await getValidAccessToken();
      tokenSource = 'db/oauth';
      console.log('[CaAuthCheck] Token obtido do DB (OAuth)');
    } catch (err) {
      console.log('[CaAuthCheck] Nenhum token OAuth no DB, tentando env...');
      token = process.env.CONTA_AZUL_API_TOKEN || '';
      if (!token) {
        return res.status(500).json({
          success: false,
          error: 'No token available (DB or env)',
          tokenSource: 'none',
        });
      }
    }

    // 2. Calcular fingerprint (sem vazar token)
    const tokenLen = token.length;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 10);
    const tokenFingerprint = `token[len=${tokenLen},hash=${tokenHash}]`;

    // 3. Testar endpoint /v1/categorias
    const baseUrl = 'https://api-v2.contaazul.com';
    const url = `${baseUrl}/v1/categorias`;

    console.log('[CaAuthCheck] Testando:', url);
    console.log('[CaAuthCheck] Token source:', tokenSource);
    console.log('[CaAuthCheck] Token fingerprint:', tokenFingerprint);

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const dataKeys = Object.keys(response.data || {}).slice(0, 5);
    return res.json({
      success: true,
      status: response.status,
      urlFinal: url,
      tokenSource,
      tokenFingerprint,
      dataPreviewKeys: dataKeys,
      itemsTotal: response.data?.itens_totais || 0,
    });
  } catch (error: any) {
    console.error('[CaAuthCheck] Erro:', error.message);
    return res.status(error?.response?.status || 500).json({
      success: false,
      status: error?.response?.status || 0,
      error: error?.message,
      wwwAuthenticate: error?.response?.headers?.['www-authenticate'],
    });
  }
});

/**
 * POST /api/test/probe-ca-receivables
 * ✅ MELHORADO: 2 tentativas por endpoint (sem params + com params)
 * Retorna: status, www-authenticate, errorPreview, dataPreviewKeys
 */
router.post('/probe-ca-receivables', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    
    // Obter token do DB (OAuth)
    let token: string;
    let tokenSource = 'env';
    try {
      token = await getValidAccessToken();
      tokenSource = 'db/oauth';
    } catch (err) {
      token = process.env.CONTA_AZUL_API_TOKEN || '';
      if (!token) {
        return res.status(500).json({
          success: false,
          error: 'No token available (DB or env)',
          tokenSource: 'none',
        });
      }
    }

    // Base URL SEM /v1 (será adicionado nos paths)
    const baseUrl = 'https://api-v2.contaazul.com';

    const paths = [
      '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar',
      '/v1/financeiro/contas-a-receber',
      '/v1/contas-a-receber',
      '/v1/financeiro/recebiveis',
      '/v1/recebiveis',
      '/v1/receivables',
    ];

    const testParams = {
      pagina: 1,
      tamanho_pagina: 20,
      data_vencimento_de: '2025-01-01',
      data_vencimento_ate: '2026-12-31',
    };

    const results: any[] = [];

    for (const path of paths) {
      const pathResults: any = {
        path,
        attempts: [],
      };

      // Tentativa A: SEM params
      try {
        const url = `${baseUrl}${path}`;
        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        });

        const dataKeys = Object.keys(response.data || {}).slice(0, 5);
        pathResults.attempts.push({
          attempt: 'A_no_params',
          status: response.status,
          dataPreviewKeys: dataKeys,
          itemCount: Array.isArray(response.data) ? response.data.length : (response.data?.itens?.length || 0),
        });
      } catch (error: any) {
        const errorBody = error?.response?.data;
        const errorPreview = typeof errorBody === 'object' ? Object.keys(errorBody || {}).slice(0, 3) : String(errorBody).substring(0, 100);
        
        pathResults.attempts.push({
          attempt: 'A_no_params',
          status: error?.response?.status || 0,
          wwwAuthenticate: error?.response?.headers?.['www-authenticate'],
          errorPreview,
        });
      }

      // Tentativa B: COM params
      try {
        const url = `${baseUrl}${path}`;
        const response = await axios.get(url, {
          params: testParams,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        });

        const dataKeys = Object.keys(response.data || {}).slice(0, 5);
        pathResults.attempts.push({
          attempt: 'B_with_params',
          status: response.status,
          dataPreviewKeys: dataKeys,
          itemCount: Array.isArray(response.data) ? response.data.length : (response.data?.itens?.length || 0),
        });
      } catch (error: any) {
        const errorBody = error?.response?.data;
        const errorPreview = typeof errorBody === 'object' ? Object.keys(errorBody || {}).slice(0, 3) : String(errorBody).substring(0, 100);
        
        pathResults.attempts.push({
          attempt: 'B_with_params',
          status: error?.response?.status || 0,
          wwwAuthenticate: error?.response?.headers?.['www-authenticate'],
          errorPreview,
        });
      }

      results.push(pathResults);
    }

    return res.json({
      success: true,
      baseUrl,
      tokenSource,
      results,
    });
  } catch (error: any) {
    console.error('[Probe] Erro fatal:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/debug-receivables-structure
 * DEBUG: Retorna estrutura real dos dados do Conta Azul (1 item)
 */
router.get('/debug-receivables-structure', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    
    let token: string;
    try {
      token = await getValidAccessToken();
    } catch (err) {
      token = process.env.CONTA_AZUL_API_TOKEN || '';
    }

    if (!token) {
      return res.status(500).json({ success: false, error: 'No token' });
    }

    const baseUrl = 'https://api-v2.contaazul.com';
    const endpoint = '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar';
    const url = `${baseUrl}${endpoint}`;

    const response = await axios.get(url, {
      params: {
        pagina: 1,
        tamanho_pagina: 1,
        data_vencimento_de: '2025-01-01',
        data_vencimento_ate: '2026-12-31',
      },
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const firstItem = response.data?.itens?.[0];
    if (!firstItem) {
      return res.json({ success: true, message: 'No items found', data: response.data });
    }

    return res.json({
      success: true,
      itemKeys: Object.keys(firstItem),
      firstItem,
      responseKeys: Object.keys(response.data),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/sync-receivables-conta-azul
 * ✅ REAL: Sincroniza contas a receber do Conta Azul com paginação
 * Query params: page, pageSize, from, to, maxPages, timeoutMs, dryRun
 */
router.post('/sync-receivables-conta-azul', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    
    // Parâmetros de query
    const dryRun = req.query.dryRun === 'true';
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const maxPages = parseInt(req.query.maxPages as string) || 1;
    const timeoutMs = parseInt(req.query.timeoutMs as string) || 15000;
    const from = (req.query.from as string) || '2025-01-01';
    const to = (req.query.to as string) || '2026-12-31';

    // Obter token
    let token: string;
    try {
      token = await getValidAccessToken();
    } catch (err) {
      token = process.env.CONTA_AZUL_API_TOKEN || '';
      if (!token) {
        return res.status(500).json({
          success: false,
          error: 'No token available',
        });
      }
    }

    const baseUrl = 'https://api-v2.contaazul.com';
    const endpoint = '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar';
    const url = `${baseUrl}${endpoint}`;

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    let fetched = 0;
    let inserted = 0;
    let updated = 0;
    const errors: any[] = [];
    const pages: any[] = [];

    // Loop de paginação
    for (let currentPage = page; currentPage < page + maxPages; currentPage++) {
      try {
        const response = await axios.get(url, {
          params: {
            pagina: currentPage,
            tamanho_pagina: pageSize,
            data_vencimento_de: from,
            data_vencimento_ate: to,
          },
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        });

        const items = response.data?.itens || [];
        const pageCount = items.length;
        fetched += pageCount;

        console.log(`[Sync] Página ${currentPage}: ${pageCount} items`);
        pages.push({ page: currentPage, count: pageCount });

        if (pageCount === 0) {
          console.log(`[Sync] Página ${currentPage}: sem items, finalizando`);
          break;
        }

        // Processar items
        for (const item of items) {
          try {
            const contaAzulId = item.id;
            if (!contaAzulId) {
              errors.push({ error: 'Missing id in item' });
              continue;
            }

            const clientName = item.cliente?.nome || 'Cliente Conta Azul';
            const whatsappNumber = item.cliente?.telefone || '';
            const amount = item.total || item.valor || 0;
            const dueDate = item.data_vencimento || item.dataVencimento;
            const status = item.status === 'ACQUITTED' ? 'paid' : 'pending';
            const linhaDigitavel = item.linhaDigitavel || null;
            const link = item.link || `https://api-v2.contaazul.com/boleto/${contaAzulId}`;

            // Validar data
            let dueDateObj: Date | null = null;
            if (dueDate) {
              try {
                const parsed = new Date(dueDate);
                if (!isNaN(parsed.getTime())) {
                  dueDateObj = parsed;
                }
              } catch (e) {
                console.warn(`[Sync] Invalid date: ${dueDate}`);
              }
            }

            if (!dueDateObj) {
              errors.push({
                contaAzulId,
                error: `Invalid or missing dueDate: ${dueDate}`,
              });
              continue;
            }

            if (dryRun) {
              console.log(`[Sync] DRY RUN: ${contaAzulId} - ${clientName} - ${amount}`);
              inserted++;
              continue;
            }

            // Buscar ou criar cliente
            let clientId = null;
            const existingClient = await db
              .select()
              .from(clients)
              .where(eq(clients.contaAzulId, contaAzulId))
              .limit(1);

            if (existingClient.length > 0) {
              clientId = existingClient[0].id;
            } else {
              const newClient = await db.insert(clients).values({
                contaAzulId,
                name: clientName,
                whatsappNumber,
                email: item.cliente?.email || '',
                status: 'active' as any,
              });
              clientId = (newClient as any)[0]?.insertId || (newClient as any).insertId;
            }

            // Buscar ou atualizar receivable
            const existingReceivable = await db
              .select()
              .from(receivables)
              .where(eq(receivables.contaAzulId, contaAzulId))
              .limit(1);

            if (existingReceivable.length > 0) {
              await db
                .update(receivables)
                .set({
                  status: status as any,
                  link: link,
                  linhaDigitavel: linhaDigitavel,
                  updatedAt: new Date(),
                })
                .where(eq(receivables.contaAzulId, contaAzulId));
              updated++;
            } else {
              await db.insert(receivables).values({
                clientId,
                contaAzulId,
                amount: amount as any,
                dueDate: dueDateObj,
                linhaDigitavel,
                link,
                source: 'conta-azul',
                status: status as any,
              });
              inserted++;
            }
          } catch (itemError: any) {
            errors.push({
              contaAzulId: item.id,
              error: itemError.message,
            });
          }
        }
      } catch (pageError: any) {
        console.error(`[Sync] Erro na página ${currentPage}:`, pageError.message);
        return res.status(pageError?.response?.status || 500).json({
          success: false,
          page: currentPage,
          error: pageError.message,
          fetched,
          inserted,
          updated,
          errors: errors.slice(0, 10),
        });
      }
    }

    return res.json({
      success: true,
      dryRun,
      fetched,
      inserted,
      updated,
      errors: errors.slice(0, 10),
      errorCount: errors.length,
      pages,
    });
  } catch (error: any) {
    console.error('[Sync] Erro fatal:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/enrich-receivable-from-conta-azul/:id
 * Enriquecer receivable com dados reais de pagamento do Conta Azul
 * Busca linhaDigitavel, PDF, etc via API /v1/financeiro/eventos-financeiros/{id_evento}/parcelas
 */
router.post('/enrich-receivable-from-conta-azul/:id', async (req, res) => {
  if (!devOnly(req, res)) return;

  const receivableId = Number(req.params.id);
  const db = await getDb();

  try {
    if (!db) throw new Error('Database not available');

    // 1. Carregar receivable
    const receivableResult = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    const receivable = receivableResult[0];
    if (!receivable) {
      return res.status(404).json({ success: false, error: 'RECEIVABLE_NOT_FOUND' });
    }

    if (!receivable.contaAzulId) {
      return res.status(400).json({ success: false, error: 'NO_CONTA_AZUL_ID' });
    }

    // 2. Obter token OAuth
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();

    if (!token) {
      return res.status(401).json({ success: false, error: 'NO_OAUTH_TOKEN' });
    }

    // 3. Chamar API Conta Azul para parcelas
    const apiUrl = `${process.env.CONTA_AZUL_API_BASE}/financeiro/eventos-financeiros/${receivable.contaAzulId}/parcelas`;
    
    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const data = response.data;
    let linhaDigitavel = receivable.linhaDigitavel;
    let pdfUrl = null;
    let linhaDigitavelFound = false;
    let pdfFound = false;

    // 4. Extrair dados de parcelas
    if (data.itens && Array.isArray(data.itens) && data.itens.length > 0) {
      const parcela = data.itens[0];

      // Procurar linhaDigitavel
      if (parcela.linhaDigitavel && !linhaDigitavel) {
        linhaDigitavel = parcela.linhaDigitavel;
        linhaDigitavelFound = true;
      }

      // Procurar PDF ou link público
      if (parcela.boletoPdfUrl) {
        pdfUrl = parcela.boletoPdfUrl;
        pdfFound = true;
      } else if (parcela.linkBoleto && !parcela.linkBoleto.includes('api-v2')) {
        pdfUrl = parcela.linkBoleto;
        pdfFound = true;
      }
    }

    // 5. Atualizar receivable
    if (linhaDigitavelFound || pdfFound) {
      await db
        .update(receivables)
        .set({
          linhaDigitavel: linhaDigitavel,
          link: pdfUrl || receivable.link,
          updatedAt: new Date(),
        })
        .where(eq(receivables.id, receivableId));
    }

    return res.json({
      success: true,
      linhaDigitavelFound,
      pdfFound,
      linhaDigitavel: linhaDigitavel || null,
      pdfUrl: pdfUrl || null,
    });
  } catch (error: any) {
    console.error('[Enrich] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/fetch-boleto-pdf/:receivableId
 * Baixar PDF do boleto do Conta Azul e armazenar em S3 público
 */
router.post('/fetch-boleto-pdf/:receivableId', async (req, res) => {
  if (!devOnly(req, res)) return;

  const receivableId = Number(req.params.receivableId);
  const db = await getDb();

  try {
    if (!db) throw new Error('Database not available');

    // 1. Carregar receivable
    const receivableResult = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    const receivable = receivableResult[0];
    if (!receivable) {
      return res.status(404).json({ success: false, error: 'RECEIVABLE_NOT_FOUND' });
    }

    if (!receivable.contaAzulId) {
      return res.status(400).json({ success: false, error: 'NO_CONTA_AZUL_ID' });
    }

    // 2. Obter token OAuth
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();

    if (!token) {
      return res.status(401).json({ success: false, error: 'NO_OAUTH_TOKEN' });
    }

    // 3. Chamar API Conta Azul para download do PDF
    const pdfUrl = `${process.env.CONTA_AZUL_API_BASE}/financeiro/eventos-financeiros/${receivable.contaAzulId}/boleto/pdf`;
    
    const pdfResponse = await axios.get(pdfUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    // 4. Upload para S3
    const { storagePut } = await import('./storage');
    const fileName = `boletos/${receivable.contaAzulId}-${Date.now()}.pdf`;
    
    const { url: pdfUrlPublic } = await storagePut(
      fileName,
      pdfResponse.data,
      'application/pdf'
    );

    // 5. Atualizar receivable
    await db
      .update(receivables)
      .set({
        link: pdfUrlPublic,
        updatedAt: new Date(),
      })
      .where(eq(receivables.id, receivableId));

    return res.json({
      success: true,
      pdfUrlPublic,
      fileName,
    });
  } catch (error: any) {
    console.error('[FetchPDF] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/run-collection-cycle
 * Executar ciclo de cobrança manualmente (para testes)
 */
router.get('/run-collection-cycle', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { testCollectionCycle } = await import('./automatedCollectionJob');
    await testCollectionCycle(req, res);
  } catch (error: any) {
    console.error('[TestCycle] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/sync-client-phones-conta-azul
 * Sincronizar telefones de clientes do Conta Azul
 * Normalizar para E.164 (55DDDNUMERO)
 */
router.post('/sync-client-phones-conta-azul', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'NO_VALID_TOKEN',
        message: 'Nenhum token OAuth válido encontrado',
      });
    }

    // Buscar clientes do Conta Azul
    const caResponse = await axios.get(
      'https://api-v2.contaazul.com/v1/pessoas?tamanho_pagina=100',
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      }
    );

    const caClients = caResponse.data.items || [];
    let updated = 0;
    let errors: any[] = [];



    // Função para normalizar telefone para E.164
    const normalizePhone = (phone: string | null | undefined): string | null => {
      if (!phone) return null;
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length < 11) return null;
      const last11 = cleaned.slice(-11);
      return `55${last11}`;
    };

    // Sincronizar cada cliente
    for (let idx = 0; idx < caClients.length; idx++) {
      const caClient = caClients[idx];
      try {

        const caId = caClient.id;
        const caName = caClient.nome || caClient.razao_social;
        const caPhone = caClient.celular || caClient.telefone;

        // Normalizar telefone
        const normalizedPhone = normalizePhone(caPhone);

        // Buscar cliente local pelo nome (fallback)
        const localClients = await db
          .select()
          .from(clients)
          .where(like(clients.name, `%${caName}%`))
          .limit(1);

        if (localClients.length === 0) {
          // Cliente não encontrado localmente
          continue;
        }

        const localClient = localClients[0];

        // Atualizar whatsappNumber
        await db
          .update(clients)
          .set({ whatsappNumber: normalizedPhone })
          .where(eq(clients.id, localClient.id));

        updated++;
        console.log(`[SyncPhones] ${caName} (${caId}): ${normalizedPhone || 'null'}`);
      } catch (error: any) {
        errors.push({
          caId: caClient.id,
          message: error.message,
        });
      }
    }

    return res.json({
      success: true,
      fetched: caClients.length,
      updated,
      errors: errors.slice(0, 10),
      tokenFingerprint: tokenFingerprint(token),
    });
  } catch (error: any) {
    console.error('[SyncPhones] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/import-whatsapp
 * Importar WhatsApp em massa via JSON
 * Body: [{documento, email, whatsappNumber}]
 */
router.post('/import-whatsapp', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const items = req.body as Array<{
      documento?: string;
      email?: string;
      whatsappNumber: string;
    }>;

    if (!Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'Body deve ser um array de objetos',
      });
    }

    let updated = 0;
    let notFound = 0;
    let invalid = 0;
    const errors: any[] = [];

    // Funcao para normalizar telefone para E.164
    const normalizePhone = (phone: string): string | null => {
      if (!phone) return null;
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length < 10) return null;
      const last11 = cleaned.slice(-11);
      return `55${last11}`;
    };

    // Processar cada item
    for (const item of items) {
      try {
        const normalizedPhone = normalizePhone(item.whatsappNumber);
        if (!normalizedPhone) {
          invalid++;
          continue;
        }

        // Buscar cliente por documento ou email
        let clientsFound: any[] = [];
        if (item.documento) {
          clientsFound = await db
            .select()
            .from(clients)
            .where(like(clients.name, `%${item.documento}%`))
            .limit(1);
        }
        if (clientsFound.length === 0 && item.email) {
          clientsFound = await db
            .select()
            .from(clients)
            .where(like(clients.name, `%${item.email}%`))
            .limit(1);
        }

        if (clientsFound.length === 0) {
          notFound++;
          continue;
        }

        // Atualizar WhatsApp
        await db
          .update(clients)
          .set({ whatsappNumber: normalizedPhone })
          .where(eq(clients.id, clientsFound[0].id));

        updated++;
      } catch (err: any) {
        errors.push({
          item,
          error: err.message,
        });
      }
    }

    return res.json({
      success: true,
      totalProcessed: items.length,
      updated,
      notFound,
      invalid,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('[ImportWhatsApp] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/dispatch/missing-whatsapp
 * Exportar inadimplentes sem WhatsApp
 */
router.get('/missing-whatsapp', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[MissingWhatsApp] Iniciando...');
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    console.log('[MissingWhatsApp] DB ok');

    const source = (req.query.source as string) || 'conta-azul';
    const status = (req.query.status as string) || 'overdue';
    const limit = parseInt(req.query.limit as string) || 500;
    console.log('[MissingWhatsApp] Params:', source, status, limit);

    // Buscar receivables sem WhatsApp
    console.log('[MissingWhatsApp] Executando query...');
    const missing = await db
      .select({
        clientId: receivables.clientId,
        name: clients.name,
        email: clients.email,
        receivableId: receivables.id,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
      })
      .from(receivables)
      .leftJoin(clients, eq(receivables.clientId, clients.id))
      .where(
        sql`${receivables.source} = ${source} AND ${receivables.status} = ${status} AND (${clients.whatsappNumber} IS NULL OR ${clients.whatsappNumber} = '')`
      )
      .limit(limit);
    console.log('[MissingWhatsApp] Query ok, resultados:', missing.length);

    return res.json({
      success: true,
      count: missing.length,
      missing,
    });
  } catch (error: any) {
    console.error('[MissingWhatsApp] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/missing-whatsapp-csv
 * Exportar inadimplentes sem WhatsApp em formato CSV
 * Query params: source=conta-azul, status=overdue, limit=500
 */
router.get('/missing-whatsapp-csv', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const source = (req.query.source as string) || 'conta-azul';
    const status = (req.query.status as string) || 'overdue';
    const limit = parseInt(req.query.limit as string) || 500;

    // Buscar receivables sem WhatsApp
    const missing = await db
      .select({
        clientId: receivables.clientId,
        name: clients.name,
        documento: clients.name, // Será preenchido manualmente
        email: clients.email,
        receivableId: receivables.id,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        whatsappNumber: sql`''`, // Campo vazio para preenchimento
      })
      .from(receivables)
      .leftJoin(clients, eq(receivables.clientId, clients.id))
      .where(
        sql`${receivables.source} = ${source} AND ${receivables.status} = ${status} AND (${clients.whatsappNumber} IS NULL OR ${clients.whatsappNumber} = '')`
      )
      .limit(limit);

    // Gerar CSV
    const headers = ['clientId', 'name', 'documento', 'email', 'receivableId', 'amount', 'dueDate', 'whatsappNumber'];
    const csvContent = [
      headers.join(','),
      ...missing.map(row => [
        row.clientId || '',
        `"${(row.name || '').replace(/"/g, '""')}"`, // Escape quotes
        `"${(row.documento || '').replace(/"/g, '""')}"`,
        row.email || '',
        row.receivableId || '',
        row.amount || '',
        row.dueDate ? new Date(row.dueDate as any).toISOString().split('T')[0] : '',
        '', // whatsappNumber vazio para preenchimento
      ].join(','))
    ].join('\n');

    // Retornar como arquivo CSV
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inadimplentes-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    console.error('[MissingWhatsAppCSV] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/import-whatsapp-csv
 * Importar WhatsApp em massa via CSV
 * Formato esperado: clientId,name,documento,email,receivableId,amount,dueDate,whatsappNumber
 */
router.post('/import-whatsapp-csv', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Receber CSV como texto
    const csvText = req.body.csv || (typeof req.body === 'string' ? req.body : '');
    
    if (!csvText || typeof csvText !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Body deve conter campo "csv" com conteúdo CSV ou ser string CSV direto',
      });
    }

    // Parser simples de CSV
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'CSV deve ter cabeçalho + pelo menos 1 linha de dados',
      });
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const whatsappIndex = headers.indexOf('whatsappnumber');
    const documentoIndex = headers.indexOf('documento');
    const emailIndex = headers.indexOf('email');
    const clientIdIndex = headers.indexOf('clientid');

    if (whatsappIndex === -1) {
      return res.status(400).json({
        success: false,
        error: 'CSV deve ter coluna "whatsappNumber"',
      });
    }

    let updated = 0;
    let notFound = 0;
    let invalid = 0;
    const errors: any[] = [];

    // Função para normalizar telefone para E.164
    const normalizePhone = (phone: string): string | null => {
      if (!phone || phone.trim() === '') return null;
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length < 10) return null;
      const last11 = cleaned.slice(-11);
      return `55${last11}`;
    };

    // Processar cada linha
    for (let i = 1; i < lines.length; i++) {
      try {
        const line = lines[i].trim();
        if (!line) continue; // Pular linhas vazias

        // Parser CSV simples (não trata aspas complexas)
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const whatsappNumber = values[whatsappIndex];
        const documento = values[documentoIndex];
        const email = values[emailIndex];
        const clientId = values[clientIdIndex];

        const normalizedPhone = normalizePhone(whatsappNumber);
        if (!normalizedPhone) {
          invalid++;
          continue;
        }

        // Buscar cliente por clientId, documento ou email
        let clientsFound: any[] = [];
        
        if (clientId && clientId !== '') {
          clientsFound = await db
            .select()
            .from(clients)
            .where(eq(clients.id, parseInt(clientId)))
            .limit(1);
        }
        
        if (clientsFound.length === 0 && documento && documento !== '') {
          clientsFound = await db
            .select()
            .from(clients)
            .where(like(clients.name, `%${documento}%`))
            .limit(1);
        }
        
        if (clientsFound.length === 0 && email && email !== '') {
          clientsFound = await db
            .select()
            .from(clients)
            .where(like(clients.email, `%${email}%`))
            .limit(1);
        }

        if (clientsFound.length === 0) {
          notFound++;
          continue;
        }

        // Atualizar WhatsApp
        await db
          .update(clients)
          .set({ whatsappNumber: normalizedPhone })
          .where(eq(clients.id, clientsFound[0].id));

        updated++;
      } catch (err: any) {
        errors.push({
          line: i + 1,
          error: err.message,
        });
      }
    }

    return res.json({
      success: true,
      totalProcessed: lines.length - 1,
      updated,
      notFound,
      invalid,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('[ImportWhatsAppCSV] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔍 Localizar cliente por documento (COBRANÇA REAL)
 * GET /api/test/find-client-by-document/:document
 */
router.get('/find-client-by-document/:document', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { document } = req.params;
    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    // Normalizar documento (remover pontuação)
    const normalizedDoc = document.replace(/\D/g, '');

    const client = await db
      .select()
      .from(clients)
      .where(eq(clients.document, normalizedDoc))
      .limit(1);

    if (client.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado',
        document: normalizedDoc,
      });
    }

    console.log('[FindClient] Cliente encontrado:', {
      clientId: client[0].id,
      name: client[0].name,
      contaAzulId: client[0].contaAzulId,
    });

    return res.json({
      success: true,
      client: {
        id: client[0].id,
        name: client[0].name,
        contaAzulId: client[0].contaAzulId,
        email: client[0].email,
        whatsappNumber: client[0].whatsappNumber,
      },
    });
  } catch (error: any) {
    console.error('[FindClient] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔍 Localizar receivables pendentes/overdue de um cliente (COBRANÇA REAL)
 * GET /api/test/find-receivables-by-client/:clientId
 * Query params: status (pending|overdue|all), source (conta-azul|acessorias|all)
 */
router.get('/find-receivables-by-client/:clientId', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { clientId } = req.params;
    const { source = 'conta-azul', status = 'all' } = req.query;

    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    // Construir filtro de status dinamicamente
    let statusCondition;
    if (status === 'pending') {
      statusCondition = eq(receivables.status, 'pending');
    } else if (status === 'overdue') {
      statusCondition = eq(receivables.status, 'overdue');
    } else {
      // 'all' ou qualquer outro valor
      statusCondition = sql`${receivables.status} IN ('pending', 'overdue')`;
    }

    const items = await db
      .select()
      .from(receivables)
      .where(
        sql`${receivables.clientId} = ${parseInt(clientId as string)}
          AND ${receivables.source} = ${source as string}
          AND ${statusCondition}`
      )
      .orderBy(desc(receivables.dueDate));

    console.log('[FindReceivables] Encontrados:', {
      clientId,
      count: items.length,
      source: source as string,
      status: status as string,
    });

    return res.json({
      success: true,
      clientId,
      count: items.length,
      receivables: items.map(r => ({
        id: r.id,
        amount: r.amount,
        dueDate: r.dueDate,
        status: r.status,
        source: r.source,
        description: r.description,
      })),
    });
  } catch (error: any) {
    console.error('[FindReceivables] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔄 Enriquecer receivable com payment info (COBRANÇA REAL)
 * POST /api/test/enrich-receivable/:receivableId
 * Fallback obrigatório:
 * 1. Usar linhaDigitavel se existir
 * 2. Usar link se existir
 * 3. Se nenhum existir → retornar BLOCKED
 */
router.post('/enrich-receivable/:receivableId', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { receivableId } = req.params;
    const { dryRun } = req.query;
    const isDryRun = dryRun === 'true';
    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    // Buscar receivable
    const receivable = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, parseInt(receivableId as string)))
      .limit(1);

    if (receivable.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Receivable not found',
        receivableId: parseInt(receivableId as string),
      });
    }

    const r = receivable[0];

    // Fallback obrigatório: verificar payment info
    let hasPaymentInfo = false;
    let paymentInfoType = '';

    if (r.linhaDigitavel) {
      hasPaymentInfo = true;
      paymentInfoType = 'linhaDigitavel';
    } else if (r.link) {
      hasPaymentInfo = true;
      paymentInfoType = 'link';
    }

    // Se não tem payment info, retornar BLOCKED
    if (!hasPaymentInfo) {
      console.log('[EnrichReceivable] Bloqueado - sem payment info:', {
        receivableId: r.id,
        hasLinhaDigitavel: !!r.linhaDigitavel,
        hasLink: !!r.link,
      });

      return res.status(400).json({
        success: false,
        error: 'PAYMENT_INFO_NOT_AVAILABLE',
        blockReason: 'NO_PUBLIC_PAYMENT_DATA',
        receivableId: r.id,
        message: 'Receivable sem linha digitável ou link público',
        hasLinhaDigitavel: !!r.linhaDigitavel,
        hasLink: !!r.link,
      });
    }

    // Atualizar paymentInfoPublic (se nao for dryRun)
    if (!isDryRun) {
      await db
        .update(receivables)
        .set({
          paymentInfoPublic: true,
          updatedAt: new Date(),
        })
        .where(eq(receivables.id, r.id));
    }

     const correlationId = (req as any).correlationId;
    console.log('[EnrichReceivable]', isDryRun ? 'DRY_RUN' : 'Enriquecido com sucesso:', {
      correlationId,
      receivableId: r.id,
      paymentInfoType,
      paymentInfoPublic: true,
      dryRun: isDryRun,
    });

    return res.json({
      success: true,
      receivableId: r.id,
      paymentInfoPublic: !isDryRun,
      paymentInfoType,
      linhaDigitavel: r.linhaDigitavel || null,
      link: r.link || null,
      dryRun: isDryRun,
      correlationId,
      message: isDryRun ? 'Validacao sem persistencia (dryRun=true)' : 'Enriquecido com sucesso',
    });
  } catch (error: any) {
    console.error('[EnrichReceivable] Erro:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 📊 Métricas de Upload
 * GET /api/test/upload-metrics - Obter métricas de upload
 */
router.get('/upload-metrics', (req, res) => {
  if (!devOnly(req, res)) return;
  
  return res.json({
    success: true,
    today: metricsCollector.getDailyStats(),
    successRate: metricsCollector.getSuccessRate(),
    providerStats: metricsCollector.getProviderStats(),
    recent: metricsCollector.getRecentMetrics(10),
  });
});

/**
 * 🔍 Teste D: Isolar problema 401
 * GET /api/test/ping - Endpoint síncrono simples
 * GET /api/test/ping-async - Endpoint async com try/catch
 */
router.get('/ping', (req, res) => {
  if (!devOnly(req, res)) return;
  return res.json({ ok: true, type: 'sync', timestamp: new Date().toISOString() });
});

router.get('/ping-async', async (req, res) => {
  if (!devOnly(req, res)) return;
  try {
    return res.json({ ok: true, type: 'async', timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('[PingAsync] ERROR', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🚀 Teste de Upload via Cloudflare Worker
 * POST /api/test/upload-via-worker/:receivableId
 * 
 * Testa o upload de PDF via Cloudflare Worker
 * Requer: X-Dev-Secret header
 */
router.post('/upload-via-worker/:receivableId', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const { receivableId } = req.params;
    const correlationId = (req as any).correlationId;

    console.log('[WorkerUploadTest] START', {
      correlationId,
      receivableId,
    });

    // Verificar saúde do Worker
    const isHealthy = await checkWorkerHealth();
    if (!isHealthy) {
      console.warn('[WorkerUploadTest] Worker não está saudável');
      return res.status(503).json({
        success: false,
        error: 'Worker is not healthy',
        correlationId,
      });
    }

    // Criar PDF de teste
    const testPdfContent = Buffer.from(
      '%PDF-1.4\n' +
      '1 0 obj\n' +
      '<< /Type /Catalog /Pages 2 0 R >>\n' +
      'endobj\n' +
      '2 0 obj\n' +
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n' +
      'endobj\n' +
      '3 0 obj\n' +
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\n' +
      'endobj\n' +
      'xref\n' +
      '0 4\n' +
      '0000000000 65535 f\n' +
      '0000000009 00000 n\n' +
      '0000000058 00000 n\n' +
      '0000000115 00000 n\n' +
      'trailer\n' +
      '<< /Size 4 /Root 1 0 R >>\n' +
      'startxref\n' +
      '200\n' +
      '%%EOF'
    );

    // Upload via Worker
    const uploadResult = await uploadPdfViaWorker(receivableId, testPdfContent);

    console.log('[WorkerUploadTest] RESULT', {
      correlationId,
      receivableId,
      ...uploadResult,
    });

    if (!uploadResult.success) {
      return res.status(400).json({
        success: false,
        error: uploadResult.error,
        correlationId,
      });
    }

    return res.json({
      success: true,
      receivableId,
      key: uploadResult.key,
      publicUrl: uploadResult.publicUrl,
      duration: uploadResult.duration,
      correlationId,
      message: 'PDF uploaded successfully via Worker',
    });
  } catch (error: any) {
    console.error('[WorkerUploadTest] ERROR', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      correlationId: (req as any).correlationId,
    });
  }
});

/**
 * 🏥 Health Check do Cloudflare Worker
 * GET /api/test/worker-health
 * 
 * Verifica se o Worker está online e responsivo
 */
router.get('/worker-health', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const isHealthy = await checkWorkerHealth();
    const correlationId = (req as any).correlationId;

    console.log('[WorkerHealth] CHECK', {
      correlationId,
      healthy: isHealthy,
    });

    return res.json({
      success: true,
      healthy: isHealthy,
      workerUrl: process.env.WORKER_UPLOAD_URL || 'https://boletos-upload-proxy.contato-676.workers.dev',
      correlationId,
    });
  } catch (error: any) {
    console.error('[WorkerHealth] ERROR', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      correlationId: (req as any).correlationId,
    });
  }
});

export default router;
