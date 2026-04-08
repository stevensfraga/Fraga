/**
 * TAREFA 3.2 - Sincronização em Massa para Conta Azul
 * POST /api/test/conta-azul/sync-people-to-contaazul?limit=50
 */

import { Router } from 'express';
import { syncPeopleToContaAzul } from './services/syncPeopleToContaAzulService';

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  const headerSecret = req.headers['x-dev-secret'];
  
  if (!devSecret || devSecret !== headerSecret) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  return true;
}

/**
 * POST /sync-people-to-contaazul?limit=50
 * Sincronizar clientes locais para Conta Azul em massa
 */
router.post('/sync-people-to-contaazul', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    
    console.log(`[SyncPeople] Iniciando sincronização (limit=${limit})...`);
    
    const { details, summary } = await syncPeopleToContaAzul(limit);
    
    res.json({
      success: true,
      results: summary,
      details,
    });
  } catch (error: any) {
    console.error(`[SyncPeople] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
      results: {
        total: 0,
        created: 0,
        skipped: 0,
        errors: 1,
        message: error?.message,
      },
    });
  }
});

export default router;
