import { Router } from 'express';
import { contaAzulGet } from './contaAzulRequest';
import { getValidAccessToken } from './contaAzulOAuthManager';
import axios from 'axios';

const router = Router();

/**
 * GET /api/test/panel/auth-proof
 * Testa autenticação no painel Conta Azul (services.contaazul.com)
 * Prova D1: Tenta com OAuth, loga 401 completo se falhar
 */
router.get('/auth-proof', async (req, res) => {
  const correlationId = `panel-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    console.log(`[PanelAuth] ${correlationId} Iniciando teste de autenticação no painel...`);

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({
        ok: false,
        decision: 'NO_TOKEN',
        correlationId,
      });
    }

    const steps: any = {};
    const diagnostics: any = {};

    // PASSO A: Tentar com OAuth (esperado falhar com 401)
    try {
      console.log(`[PanelAuth] ${correlationId} PASSO A: Testando com OAuth token...`);

      const testUrl = 'https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/test/summary';

      const response = await axios.get(testUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Origin': 'https://pro.contaazul.com',
          'Referer': 'https://pro.contaazul.com/',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      steps.oauthTest = {
        httpStatus: response.status,
        ok: true,
      };

      console.log(`[PanelAuth] ${correlationId} PASSO A OK: ${response.status}`);
    } catch (err: any) {
      const status = err.response?.status || 0;
      const headers = err.response?.headers || {};
      const data = err.response?.data || {};

      steps.oauthTest = {
        httpStatus: status,
        ok: false,
      };

      // Logar 401 completo
      if (status === 401) {
        diagnostics.oauth401 = {
          status,
          endpoint: '/contaazul-bff/finance/v1/financial-events/test/summary',
          tokenPrefix: accessToken.substring(0, 30) + '...',
          responseHeaders: {
            'www-authenticate': headers['www-authenticate'] || 'N/A',
            'content-type': headers['content-type'] || 'N/A',
            'cache-control': headers['cache-control'] || 'N/A',
          },
          responseData: JSON.stringify(data).substring(0, 500),
          errorMessage: err.message,
        };

        console.error(`[PanelAuth] ${correlationId} 401 COMPLETO:`, diagnostics.oauth401);
      }

      console.log(`[PanelAuth] ${correlationId} PASSO A FALHOU: ${status}`);
    }

    // PASSO B: Tentar com contaAzulGet (que tem retry automático)
    try {
      console.log(`[PanelAuth] ${correlationId} PASSO B: Testando com contaAzulGet (retry automático)...`);

      const result = await contaAzulGet(
        `/contaazul-bff/finance/v1/financial-events/test/summary`,
        undefined,
        correlationId
      );

      steps.contaAzulGetTest = {
        httpStatus: result.status,
        ok: result.ok,
      };

      if (result.ok) {
        console.log(`[PanelAuth] ${correlationId} PASSO B OK: ${result.status}`);
      } else {
        console.log(`[PanelAuth] ${correlationId} PASSO B FALHOU: ${result.status}`);
      }
    } catch (err: any) {
      console.error(`[PanelAuth] ${correlationId} PASSO B ERRO:`, err.message);
      steps.contaAzulGetTest = {
        httpStatus: 500,
        error: err.message,
      };
    }

    // Determinar decisão
    let decision = 'PANEL_AUTH_FAILED';

    if (steps.oauthTest?.ok) {
      decision = 'OK_PANEL_AUTH';
    } else if (steps.contaAzulGetTest?.ok) {
      decision = 'OK_PANEL_AUTH_RETRY';
    } else if (steps.oauthTest?.httpStatus === 401) {
      decision = 'NEED_PANEL_SESSION';
    }

    return res.json({
      ok: decision.startsWith('OK'),
      decision,
      correlationId,
      steps,
      diagnostics,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`[PanelAuth] ${correlationId} Erro fatal:`, error.message);
    return res.status(500).json({
      ok: false,
      decision: 'FATAL_ERROR',
      correlationId,
      error: error.message,
    });
  }
});

export default router;
