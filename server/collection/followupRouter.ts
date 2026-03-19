/**
 * ENDPOINTS ADMIN PARA FOLLOW-UP AUTOMÁTICO
 * 
 * POST /api/collection/followup/run?dryRun=true|false&limit=10
 * GET  /api/collection/followup/status
 * GET  /api/collection/followup/debug?limit=20
 * 
 * Proteção: x-admin-key
 */
import { Router, Request, Response } from 'express';
import {
  runFollowupCycle,
  getFollowupKPIs,
  getFollowupDebug,
  stopFollowupForClient,
} from './noResponseFollowup';
import { FEATURE_FLAGS } from '../_core/featureFlags';

const router = Router();

const ADMIN_KEY = process.env.FRAGA_ADMIN_KEY || process.env.DEV_SECRET || '';

/**
 * Middleware de autenticação admin
 */
function requireAdminKey(req: Request, res: Response, next: Function) {
  const key = req.headers['x-admin-key'] as string;
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: x-admin-key inválida' });
  }
  next();
}

/**
 * POST /api/collection/followup/run
 * 
 * Executa ciclo de follow-up
 * Query params:
 * - dryRun: true|false (default: true)
 * - limit: number (default: 10, max: 30)
 */
router.post('/run', requireAdminKey, async (req: Request, res: Response) => {
  try {
    const dryRun = req.query.dryRun !== 'false'; // default true
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 30);

    console.log(`[FollowupRouter] POST /run: dryRun=${dryRun}, limit=${limit}`);

    // Verificar feature flag
    if (!FEATURE_FLAGS.FOLLOWUP_ENABLED && !dryRun) {
      return res.status(400).json({
        error: 'FOLLOWUP_ENABLED=false. Ative a feature flag para envio real.',
        hint: 'Use dryRun=true para testar sem enviar.',
      });
    }

    const result = await runFollowupCycle(limit, dryRun);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[FollowupRouter] ❌ Erro no /run:', error.message);
    res.status(500).json({
      error: 'Erro ao executar follow-up',
      message: error.message,
    });
  }
});

/**
 * GET /api/collection/followup/status
 * 
 * KPIs: active, completed, stopped por motivo, elegíveis agora
 */
router.get('/status', requireAdminKey, async (req: Request, res: Response) => {
  try {
    const kpis = await getFollowupKPIs();

    res.status(200).json({
      featureFlag: FEATURE_FLAGS.FOLLOWUP_ENABLED,
      killSwitch: FEATURE_FLAGS.KILL_SWITCH,
      allowRealSend: FEATURE_FLAGS.ALLOW_REAL_SEND,
      kpis,
    });
  } catch (error: any) {
    console.error('[FollowupRouter] ❌ Erro no /status:', error.message);
    res.status(500).json({
      error: 'Erro ao buscar status',
      message: error.message,
    });
  }
});

/**
 * GET /api/collection/followup/debug
 * 
 * Lista top bloqueados com motivos
 * Query params:
 * - limit: number (default: 20, max: 100)
 */
router.get('/debug', requireAdminKey, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const entries = await getFollowupDebug(limit);

    res.status(200).json({
      count: entries.length,
      data: entries,
    });
  } catch (error: any) {
    console.error('[FollowupRouter] ❌ Erro no /debug:', error.message);
    res.status(500).json({
      error: 'Erro ao buscar debug',
      message: error.message,
    });
  }
});

/**
 * POST /api/collection/followup/stop
 * 
 * Parar follow-up manualmente para um cliente
 * Body: { clientId: number }
 */
router.post('/stop', requireAdminKey, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.body;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório' });
    }

    const stopped = await stopFollowupForClient(clientId, 'manual');

    res.status(200).json({
      success: stopped,
      clientId,
      reason: 'manual',
    });
  } catch (error: any) {
    console.error('[FollowupRouter] ❌ Erro no /stop:', error.message);
    res.status(500).json({
      error: 'Erro ao parar follow-up',
      message: error.message,
    });
  }
});

export default router;
