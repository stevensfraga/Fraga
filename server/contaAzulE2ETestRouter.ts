/**
 * 🧪 Conta Azul E2E Test Router
 * Endpoints para testar fluxo completo: probe → tenant-check → /pessoas → bootstrap → send-precharge
 */

import { Router, Request, Response } from 'express';
import { probeContaAzulEndpoints, testPessoasEndpoint } from './contaAzulProbe';
import { tenantCheckMultiStrategy, validatePessoasEndpoint } from './contaAzulTenantCheckMultiStrategy';
import axios from 'axios';

const router = Router();

/**
 * GET /api/test/e2e/full
 * Executa teste E2E completo: probe → tenant-check → /pessoas
 */
router.get('/full', async (req: Request, res: Response) => {
  const results: any = {
    timestamp: new Date().toISOString(),
    steps: {},
  };

  try {
    // PASSO 1: Probe
    console.log('[E2E] STEP 1: Probe...');
    results.steps.probe = await probeContaAzulEndpoints();

    if (!results.steps.probe.ok) {
      return res.status(422).json({
        success: false,
        error: 'Probe failed',
        results,
      });
    }

    // PASSO 2: Tenant-check
    console.log('[E2E] STEP 2: Tenant-check...');
    results.steps.tenantCheck = await tenantCheckMultiStrategy();

    if (!results.steps.tenantCheck.ok) {
      return res.status(422).json({
        success: false,
        error: 'Tenant-check failed',
        results,
      });
    }

    // PASSO 3: Validate /pessoas
    console.log('[E2E] STEP 3: Validate /pessoas...');
    results.steps.pessoas = await validatePessoasEndpoint();

    if (!results.steps.pessoas.ok) {
      return res.status(422).json({
        success: false,
        error: 'Pessoas validation failed',
        results,
      });
    }

    // PASSO 4: Bootstrap (opcional)
    const clientId = req.query.clientId as string;
    if (clientId) {
      console.log('[E2E] STEP 4: Bootstrap...');
      try {
        const bootstrapUrl = `http://localhost:${process.env.PORT || 3000}/api/test/reactivation/bootstrap-conta-azul/${clientId}`;
        const bootstrapResponse = await axios.post(
          bootstrapUrl,
          { documento: req.query.documento || '21918918000194' },
          {
            headers: {
              'X-Dev-Secret': process.env.DEV_SECRET || 'Contabil1',
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        results.steps.bootstrap = bootstrapResponse.data;
      } catch (error: any) {
        results.steps.bootstrap = {
          success: false,
          error: error?.message,
        };
      }
    }

    // Resumo
    results.summary = {
      probeOk: results.steps.probe?.ok,
      tenantCheckOk: results.steps.tenantCheck?.ok,
      pessoasOk: results.steps.pessoas?.ok,
      bootstrapOk: results.steps.bootstrap?.success,
      allOk: results.steps.probe?.ok && results.steps.tenantCheck?.ok && results.steps.pessoas?.ok,
    };

    res.json({
      success: results.summary.allOk,
      results,
    });
  } catch (error: any) {
    results.error = error?.message;
    results.summary = { allOk: false };
    res.status(500).json({
      success: false,
      results,
    });
  }
});

/**
 * POST /api/test/e2e/send-precharge
 * Testa envio E2E completo com ZapContábil
 * Body: { clientId: 30004, documento?: "21918918000194" }
 */
router.post('/send-precharge', async (req: Request, res: Response) => {
  const { clientId, documento } = req.body;

  if (!clientId) {
    return res.status(400).json({
      success: false,
      error: 'clientId is required',
    });
  }

  try {
    console.log(`[E2E] Testing send-precharge for clientId=${clientId}...`);

    const sendUrl = `http://localhost:${process.env.PORT || 3000}/api/test/reactivation/send-precharge-manual/${clientId}`;
    const response = await axios.post(
      sendUrl,
      { documento },
      {
        headers: {
          'X-Dev-Secret': process.env.DEV_SECRET || 'Contabil1',
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    console.log('[E2E] send-precharge completed');

    res.json({
      success: response.data.success,
      data: response.data,
    });
  } catch (error: any) {
    console.error('[E2E] send-precharge error:', error?.message);

    res.status(error?.response?.status || 500).json({
      success: false,
      error: error?.message,
      details: error?.response?.data,
    });
  }
});

/**
 * GET /api/test/e2e/status
 * Retorna status do sistema (OAuth, token, endpoints)
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const { hasValidToken } = await import('./contaAzulOAuthManager');

    const tokenValid = await hasValidToken();
    let token: string | null = null;

    if (tokenValid) {
      try {
        token = await getValidAccessToken();
      } catch (e) {
        // Token não disponível
      }
    }

    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';

    res.json({
      success: true,
      system: {
        tokenValid,
        tokenAvailable: !!token,
        baseUrl,
        timestamp: new Date().toISOString(),
      },
      endpoints: {
        probe: '/api/test/diagnostics/probe',
        tenantCheck: '/api/test/diagnostics/tenant-check',
        pessoas: '/api/test/diagnostics/pessoas',
        fullDiagnostics: '/api/test/diagnostics/full',
        e2eFull: '/api/test/e2e/full',
        e2eSendPrecharge: '/api/test/e2e/send-precharge (POST)',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
