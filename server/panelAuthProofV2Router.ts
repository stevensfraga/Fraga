import express from 'express';
import ContaAzulTokenManager from './contaAzulTokenManager.js';

const router = express.Router();

/**
 * /api/test/panel/auth-proof-v2
 * 
 * Testa endpoints do painel services.contaazul.com usando SOMENTE OAuth token
 * SEM Playwright, SEM storageState, SEM cookies httpOnly
 * 
 * Objetivo: Provar se OAuth token funciona ou se precisa de web session
 */

router.get('/auth-proof-v2', async (req, res) => {
  const correlationId = `authv2-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  console.log(`[AuthProofV2] Iniciando teste com correlationId: ${correlationId}`);
  
  try {
    // 1. Obter token OAuth válido
    const token = await ContaAzulTokenManager.getValidAccessToken();
    
    if (!token) {
      return res.json({
        ok: false,
        decision: 'REFRESH_BROKEN',
        error: 'Não foi possível obter access_token válido',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    console.log(`[AuthProofV2] Token obtido com sucesso`);
    
    // 2. Testar endpoints A/B/C do painel
    const endpoints = [
      {
        name: 'A',
        url: 'https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/summary',
        description: 'Financial events summary (sem ID específico)',
      },
      {
        name: 'B',
        url: 'https://services.contaazul.com/finance-pro/v1/charge-requests',
        description: 'Charge requests (sem ID específico)',
      },
      {
        name: 'C',
        url: 'https://services.contaazul.com/finance-pro-reader/v1/installment-view?limit=1',
        description: 'Installment view (com limit=1)',
      },
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      console.log(`[AuthProofV2] Testando endpoint ${endpoint.name}: ${endpoint.url}`);
      
      try {
        const response = await fetch(endpoint.url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Origin': 'https://pro.contaazul.com',
            'Referer': 'https://pro.contaazul.com/',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          },
        });
        
        const status = response.status;
        const contentType = response.headers.get('content-type') || '';
        
        let body = null;
        let bodyPreview = null;
        let responseKeys: string[] = [];
        
        if (contentType.includes('application/json')) {
          try {
            body = await response.json();
            responseKeys = Object.keys(body);
            bodyPreview = JSON.stringify(body).substring(0, 300);
          } catch (e) {
            bodyPreview = 'JSON parse error';
          }
        } else {
          const text = await response.text();
          bodyPreview = text.substring(0, 300);
        }
        
        console.log(`[AuthProofV2] Endpoint ${endpoint.name} - Status: ${status}`);
        console.log(`[AuthProofV2] Endpoint ${endpoint.name} - Body preview: ${bodyPreview}`);
        
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          description: endpoint.description,
          status,
          contentType,
          responseKeys,
          bodyPreview,
        });
        
      } catch (error: any) {
        console.error(`[AuthProofV2] Erro no endpoint ${endpoint.name}:`, error.message);
        
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          description: endpoint.description,
          status: 0,
          error: error.message,
          bodyPreview: null,
        });
      }
    }
    
    // 3. Analisar resultados e determinar decisão
    const allFailed = results.every(r => r.status === 401 || r.status === 403 || r.status === 0);
    const anySuccess = results.some(r => r.status === 200);
    
    let decision = 'UNKNOWN';
    
    if (anySuccess) {
      decision = 'OK_PANEL_AUTH';
    } else if (allFailed) {
      // Verificar se é problema de token ou de sessão web
      const has401 = results.some(r => r.status === 401);
      const has403 = results.some(r => r.status === 403);
      
      if (has401 || has403) {
        decision = 'NEEDS_WEB_SESSION';
      } else {
        decision = 'UNKNOWN_ERROR';
      }
    }
    
    console.log(`[AuthProofV2] Decisão final: ${decision}`);
    
    return res.json({
      ok: anySuccess,
      decision,
      results,
      correlationId,
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        success: results.filter(r => r.status === 200).length,
        unauthorized: results.filter(r => r.status === 401).length,
        forbidden: results.filter(r => r.status === 403).length,
        errors: results.filter(r => r.status === 0).length,
      },
    });
    
  } catch (error: any) {
    console.error('[AuthProofV2] Erro fatal:', error);
    
    return res.status(500).json({
      ok: false,
      decision: 'FATAL_ERROR',
      error: error.message,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
