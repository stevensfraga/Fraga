import { Router } from 'express';

const router = Router();

/**
 * Health check endpoint
 * GET /api/health
 * 
 * Retorna status do servidor e informações de versão
 */
// Handler compartilhado para ambas as rotas
const healthHandler = async (req: any, res: any) => {
  try {
    const version = process.env.npm_package_version || '1.0.0';
    const commit = process.env.GIT_COMMIT || 'unknown';
    const buildAt = process.env.BUILD_AT || new Date().toISOString();
    const environment = process.env.NODE_ENV || 'development';
    const uptime = process.uptime();

    console.log('[HealthCheck] GET /api/health');
    console.log('[HealthCheck] ✅ Server is running');
    console.log('[HealthCheck] version:', version);
    console.log('[HealthCheck] commit:', commit);
    console.log('[HealthCheck] buildAt:', buildAt);
    console.log('[HealthCheck] environment:', environment);
    console.log('[HealthCheck] uptime:', Math.round(uptime), 'segundos');

    return res.status(200).json({
      ok: true,
      version,
      commit,
      buildAt,
      environment,
      uptime: Math.round(uptime),
      timestamp: new Date().toISOString(),
      backend: 'Node.js Express',
      message: 'Backend is running and responding correctly'
    });
  } catch (error: any) {
    console.error('[HealthCheck] ❌ Error:', error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      commit: process.env.GIT_COMMIT || 'unknown'
    });
  }
};

// Rota /api/health (principal)
router.get('/health', healthHandler);

// Rota /health (alias - à prova de proxy)
router.get('/health', healthHandler);

// ─── Automation Health Check ─────────────────────────────────────────────────
import { runAutomationHealthCheck } from './services/automationHealthService';

/**
 * GET /api/automation-health
 * Retorna status completo da automação: OAuth, refresh cron, régua, sync
 */
router.get('/automation-health', async (req: any, res: any) => {
  try {
    const result = await runAutomationHealthCheck();
    const statusCode = result.overall === 'critical' ? 503 : 200;
    return res.status(statusCode).json(result);
  } catch (error: any) {
    console.error('[AutomationHealth] Error:', error.message);
    return res.status(500).json({
      overall: 'critical',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
