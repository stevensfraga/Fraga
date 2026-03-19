import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * GET /api/test/zap/auth-proof
 * 
 * Testa autenticação do Zap Contábil:
 * 1. Faz login programático via POST /auth/login
 * 2. Faz GET /tickets?pageNumber=1&pageSize=1 com Authorization Bearer
 * 
 * Critério: HTTP 200
 */

router.get('/auth-proof', async (req, res) => {
  const correlationId = `zap-auth-proof-${Date.now()}`;
  
  console.log(`[ZapAuthProof] Iniciando teste de autenticação correlationId: ${correlationId}`);
  
  try {
    // Obter credenciais do ambiente
    const baseUrl = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
    const username = process.env.ZAP_CONTABIL_USER;
    const password = process.env.ZAP_CONTABIL_PASS;
    
    if (!username || !password) {
      return res.status(500).json({
        ok: false,
        decision: 'MISSING_CREDENTIALS',
        error: 'ZAP_CONTABIL_USER e ZAP_CONTABIL_PASS não configurados',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    console.log(`[ZapAuthProof] Inicializando ZapAuthManager`, {
      baseUrl,
      username,
      hasPassword: !!password,
      usernameLength: username?.length,
      passwordLength: password?.length,
    });
    
    // Inicializar ZapAuthManager
    const authManager = initZapAuthManager({
      baseUrl,
      username,
      password,
    });
    
    console.log(`[ZapAuthProof] Fazendo login programático...`);
    
    // Fazer login (automático via refreshOrLogin)
    await authManager.refreshOrLogin();
    
    const tokenInfo = authManager.getTokenInfo();
    
    console.log(`[ZapAuthProof] Login bem-sucedido`, {
      hasToken: tokenInfo.hasToken,
      isExpired: tokenInfo.isExpired,
      expiresAt: new Date(tokenInfo.expiresAt || 0).toISOString(),
      tokenHash: tokenInfo.tokenHash,
    });
    
    // Testar GET /tickets
    console.log(`[ZapAuthProof] Testando GET /tickets...`);
    
    const ticketsResponse = await authManager.get('/tickets', {
      params: {
        pageNumber: 1,
        pageSize: 1,
      },
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
      },
    });
    
    console.log(`[ZapAuthProof] GET /tickets bem-sucedido`, {
      status: ticketsResponse.status,
      hasData: !!ticketsResponse.data,
      dataKeys: Object.keys(ticketsResponse.data || {}),
    });
    
    return res.json({
      ok: true,
      decision: 'AUTH_SUCCESS',
      tokenInfo: {
        hasToken: tokenInfo.hasToken,
        isExpired: tokenInfo.isExpired,
        expiresAt: new Date(tokenInfo.expiresAt || 0).toISOString(),
        tokenHash: tokenInfo.tokenHash,
      },
      ticketsTest: {
        status: ticketsResponse.status,
        dataKeys: Object.keys(ticketsResponse.data || {}),
      },
      correlationId,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    console.error('[ZapAuthProof] Erro fatal:', error);
    
    const errorDetails: any = {
      ok: false,
      decision: 'FATAL_ERROR',
      error: error.message,
      correlationId,
      timestamp: new Date().toISOString(),
    };
    
    // Adicionar detalhes do erro HTTP se disponível
    if (error.response) {
      errorDetails.httpStatus = error.response.status;
      errorDetails.httpData = error.response.data;
      errorDetails.url = error.config?.url;
      errorDetails.hasAuthHeader = !!error.config?.headers?.Authorization;
    }
    
    return res.status(500).json(errorDetails);
  }
});

export default router;
