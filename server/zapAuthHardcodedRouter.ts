import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * GET /api/test/zap/auth-hardcoded
 * 
 * Testa autenticação com credenciais hardcoded para isolar problema de secrets
 */

router.get('/auth-hardcoded', async (req, res) => {
  const correlationId = `zap-auth-hardcoded-${Date.now()}`;
  
  console.log(`[ZapAuthHardcoded] Iniciando teste com credenciais hardcoded correlationId: ${correlationId}`);
  
  try {
    const baseUrl = 'https://api-fraga.zapcontabil.chat';
    const username = 'stevensfraga@gmail.com';
    const password = 'Rafa@123';
    
    console.log(`[ZapAuthHardcoded] Credenciais`, {
      baseUrl,
      username,
      usernameLength: username.length,
      passwordLength: password.length,
    });
    
    // Inicializar ZapAuthManager
    const authManager = initZapAuthManager({
      baseUrl,
      username,
      password,
    });
    
    console.log(`[ZapAuthHardcoded] Fazendo login...`);
    
    // Fazer login
    await authManager.refreshOrLogin();
    
    const tokenInfo = authManager.getTokenInfo();
    
    console.log(`[ZapAuthHardcoded] Login bem-sucedido`, tokenInfo);
    
    // Testar GET /tickets
    console.log(`[ZapAuthHardcoded] Testando GET /tickets...`);
    
    const ticketsResponse = await authManager.get('/tickets', {
      params: {
        pageNumber: 1,
        pageSize: 1,
      },
    });
    
    console.log(`[ZapAuthHardcoded] GET /tickets bem-sucedido`, {
      status: ticketsResponse.status,
    });
    
    return res.json({
      ok: true,
      decision: 'AUTH_SUCCESS',
      tokenInfo,
      ticketsTest: {
        status: ticketsResponse.status,
      },
      correlationId,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    console.error('[ZapAuthHardcoded] Erro:', error);
    
    return res.status(500).json({
      ok: false,
      decision: 'FATAL_ERROR',
      error: error.message,
      httpStatus: error.response?.status,
      httpData: error.response?.data,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
