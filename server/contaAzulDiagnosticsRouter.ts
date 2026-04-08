/**
 * 🔍 Conta Azul Diagnostics Router
 * Endpoints para testar probe, tenant-check e validação de /pessoas
 */

import { Router, Request, Response } from 'express';
import { probeContaAzulEndpoints, testPessoasEndpoint } from './contaAzulProbe';
import { tenantCheckMultiStrategy, validatePessoasEndpoint } from './contaAzulTenantCheckMultiStrategy';

const router = Router();

/**
 * GET /api/test/diagnostics/probe
 * Executa probe automático para descobrir endpoints corretos
 */
router.get('/probe', async (req: Request, res: Response) => {
  try {
    console.log('[Diagnostics] Starting probe...');
    const result = await probeContaAzulEndpoints();

    res.json({
      success: result.ok,
      probe: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/test/diagnostics/tenant-check
 * Executa tenant-check multi-strategy
 */
router.get('/tenant-check', async (req: Request, res: Response) => {
  try {
    console.log('[Diagnostics] Starting tenant-check...');
    const result = await tenantCheckMultiStrategy();

    res.json({
      success: result.ok,
      tenantCheck: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/test/diagnostics/pessoas
 * Testa especificamente /v1/pessoas?limit=1
 */
router.get('/pessoas', async (req: Request, res: Response) => {
  try {
    console.log('[Diagnostics] Testing /pessoas endpoint...');
    const result = await validatePessoasEndpoint();

    if (result.ok) {
      res.json({
        success: true,
        latencyMs: result.latencyMs,
        recordCount: result.recordCount,
        firstRecord: result.firstRecord,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        latencyMs: result.latencyMs,
        error: result.error,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message,
        timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/test/diagnostics/full
 * Executa diagnóstico completo: probe → tenant-check → /pessoas
 */
router.get('/full', async (req: Request, res: Response) => {
  const results: any = {
    timestamp: new Date().toISOString(),
    steps: {},
  };

  try {
    // PASSO 1: Probe
    console.log('[Diagnostics] STEP 1: Probe...');
    results.steps.probe = await probeContaAzulEndpoints();

    // PASSO 2: Tenant-check
    console.log('[Diagnostics] STEP 2: Tenant-check...');
    results.steps.tenantCheck = await tenantCheckMultiStrategy();

    // PASSO 3: Validate /pessoas
    console.log('[Diagnostics] STEP 3: Validate /pessoas...');
    results.steps.pessoas = await validatePessoasEndpoint();

    // Resumo
    results.summary = {
      probeOk: results.steps.probe?.ok,
      tenantCheckOk: results.steps.tenantCheck?.ok,
      pessoasOk: results.steps.pessoas?.ok,
      allOk: results.steps.probe?.ok && results.steps.tenantCheck?.ok && results.steps.pessoas?.ok,
    };

    res.json(results);
  } catch (error: any) {
    results.error = error?.message;
    results.summary = {
      allOk: false,
    };
    res.status(500).json(results);
  }
});

export default router;
