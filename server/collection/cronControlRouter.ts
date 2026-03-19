/**
 * BLOCO 11 (D) — Endpoints de controle do cron scheduler
 * 
 * GET  /api/collection/cron/status
 * POST /api/collection/cron/enable
 * POST /api/collection/cron/disable
 * POST /api/collection/cron/run-now (manual trigger para testes)
 */

import { Router, Request, Response } from 'express';
import {
  getCronStatus,
  getCronHealth,
  enableCron,
  disableCron,
  runPipelineManually,
  checkAndAlertCronHealth,
} from './cronScheduler';
import { loadCronStateFromDb } from './cronStateDb';

const router = Router();

/**
 * GET /cron/health
 * Retorna health check enriquecido do cron scheduler
 * Campos: enabled, lastRun, lastRunBRT, lastResult (sent/skipped/errors), nextRun, status
 */
router.get('/cron/health', async (req: Request, res: Response) => {
  try {
    // Ler estado do BANCO como fonte de verdade (sobrevive a hibernações)
    const dbState = await loadCronStateFromDb();
    const memHealth = getCronHealth();

    // Usar lastRun do banco se memória estiver vazia ou banco for mais recente
    const lastRunFromDb = dbState.lastRunAt ? dbState.lastRunAt.toISOString() : null;
    const lastRunFromMem = memHealth.lastRun;
    const lastRun = lastRunFromDb && (!lastRunFromMem || lastRunFromDb > lastRunFromMem)
      ? lastRunFromDb
      : lastRunFromMem;

    let lastRunBRT: string | null = null;
    if (lastRun) {
      try {
        lastRunBRT = new Date(lastRun).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          dateStyle: 'short',
          timeStyle: 'medium',
        });
      } catch {
        lastRunBRT = lastRun;
      }
    }

    // lastResult: prefer banco se memória estiver vazia
    let lastResult = memHealth.lastResult;
    if (!lastResult && dbState.lastResult) {
      lastResult = {
        sent: dbState.lastResult.totalSent ?? 0,
        skipped: dbState.lastResult.totalSkipped ?? 0,
        errors: dbState.lastResult.totalFailed ?? 0,
      };
    }

    // Determinar status com base no lastRun real (banco)
    let status: 'ok' | 'warn' | 'error' = 'ok';
    if (!memHealth.enabled) {
      status = 'warn';
    } else if (!lastRun) {
      status = 'warn';
    } else {
      const todayBRT = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const lastRunDate = new Date(lastRun).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (todayBRT !== lastRunDate) {
        status = 'warn';
      } else if (lastResult && lastResult.errors > 0) {
        status = 'warn';
      }
    }

    const health = {
      ...memHealth,
      lastRun,
      lastRunBRT,
      lastResult,
      status,
      source: lastRunFromDb && (!lastRunFromMem || lastRunFromDb >= lastRunFromMem) ? 'db' : 'memory',
    };

    const httpStatus = (health.status as string) === 'error' ? 503 : 200;
    return res.status(httpStatus).json(health);
  } catch (error: any) {
    console.error('[CronControl] Erro ao obter health:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /cron/alert-check
 * Dispara manualmente a verificação de saúde e alerta WhatsApp (para testes)
 */
router.post('/cron/alert-check', async (req: Request, res: Response) => {
  try {
    await checkAndAlertCronHealth();
    return res.json({ success: true, message: 'Verificação de saúde executada' });
  } catch (error: any) {
    console.error('[CronControl] Erro ao verificar saúde:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /cron/status
 * Retorna status atual do cron scheduler
 */
router.get('/cron/status', async (req: Request, res: Response) => {
  try {
    const status = getCronStatus();
    
    return res.json({
      success: true,
      ...status,
    });
  } catch (error: any) {
    console.error('[CronControl] Erro ao obter status:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /cron/enable
 * Habilita execução automática do cron
 */
router.post('/cron/enable', async (req: Request, res: Response) => {
  try {
    // PROTEÇÃO: Habilitar cron exige ALLOW_CRON_ENABLE=true
    if (process.env.ALLOW_CRON_ENABLE !== 'true') {
      console.log('[GUARD] CRON_ENABLE_BLOCKED: ALLOW_CRON_ENABLE!=true');
      return res.status(403).json({
        success: false,
        decision: 'CRON_ENABLE_DISABLED',
        message: 'Habilitação de cron desabilitada. Configure ALLOW_CRON_ENABLE=true para habilitar.',
        hint: 'Esta é uma proteção de segurança para evitar ativação acidental do cron automático.',
        currentState: {
          allowCronEnable: process.env.ALLOW_CRON_ENABLE || 'false',
        },
      });
    }

    enableCron();
    
    return res.json({
      success: true,
      message: 'Cron habilitado com sucesso',
      status: getCronStatus(),
    });
  } catch (error: any) {
    console.error('[CronControl] Erro ao habilitar cron:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /cron/disable
 * Desabilita execução automática do cron
 */
router.post('/cron/disable', async (req: Request, res: Response) => {
  try {
    disableCron();
    
    return res.json({
      success: true,
      message: 'Cron desabilitado com sucesso',
      status: getCronStatus(),
    });
  } catch (error: any) {
    console.error('[CronControl] Erro ao desabilitar cron:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /cron/run-now?mode=real
 * Executa pipeline manualmente (para testes)
 * 
 * Query params:
 * - mode: 'real' para ignorar quiet hours (mas respeitar safeguards)
 */
router.post('/cron/run-now', async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const isRealMode = mode === 'real';
    
    console.log(`[CronControl] Executando pipeline manualmente (mode=${mode || 'default'})...`);
    
    await runPipelineManually(isRealMode);
    
    return res.json({
      success: true,
      message: `Pipeline executado com sucesso (mode=${mode || 'default'})`,
      mode: mode || 'default',
      status: getCronStatus(),
    });
  } catch (error: any) {
    console.error('[CronControl] Erro ao executar pipeline:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
