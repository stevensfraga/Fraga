/**
 * Data Quality Resolve Router
 * Endpoints para resolver UUIDs de Pessoas na Conta Azul
 */

import { Router } from 'express';
import { resolvePersonIdsFinal } from './services/resolvePersonIdsServiceFinal';

const router = Router();

function devOnly(req: any, res: any): boolean {
  // 1. Verificar NODE_ENV
  if (process.env.NODE_ENV !== 'development') {
    console.warn('[DevOnly] NODE_ENV não é development:', process.env.NODE_ENV);
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  // 2. Verificar header secreto (simples)
  const devSecret = process.env.DEV_SECRET;
  const headerSecret = req.headers['x-dev-secret'];
  
  console.log('[DevOnly] Checking:', { devSecret: devSecret ? 'SET' : 'UNSET', headerSecret: headerSecret ? 'SET' : 'UNSET', match: devSecret === headerSecret });
  
  if (!devSecret) {
    console.error('[DevOnly] DEV_SECRET não configurado');
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
  
  if (devSecret !== headerSecret) {
    console.warn('[DevOnly] Header X-Dev-Secret inválido:', { expected: devSecret, got: headerSecret });
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  return true;
}

/**
 * POST /resolve-person-ids
 * Resolver UUIDs de Pessoas na Conta Azul
 * (Registrado em /api/test/data-quality no server bootstrap)
 */
router.post('/resolve-person-ids', async (req: any, res: any) => {
  console.log('[PersonResolve] ROUTER: POST /resolve-person-ids called');
  if (!devOnly(req, res)) return;

  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const onlyManaged = req.query.onlyManaged === 'true';
    
    console.log(`[PersonResolve] ROUTER: limit=${limit}, onlyManaged=${onlyManaged}`);
    console.log(`[PersonResolve] Iniciando resolução (limit=${limit}, onlyManaged=${onlyManaged})...`);
    
    const { details, summary } = await resolvePersonIdsFinal(limit, onlyManaged);
    
    res.json({
      success: true,
      results: summary,
      details,
    });
  } catch (error: any) {
    console.error(`[PersonResolve] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
      results: {
        total: 0,
        updated: 0,
        blocked: 0,
        errors: 1,
        baseEmpty: false,
        message: error?.message,
      },
    });
  }
});

export default router;
