/**
 * Endpoint temporário para testar syncCertificatesToSieg() manualmente
 * GET /api/test/sieg-sync
 * 
 * Requer header: x-admin-key: <FRAGA_ADMIN_KEY>
 */

import { Router } from 'express';
import { syncCertificatesToSieg } from '../jobs/syncCertificatesToSieg';

const router = Router();

function validateAdminKey(req: any, res: any, next: any) {
  const adminKey = req.headers['x-admin-key'];
  const expectedKey = process.env.FRAGA_ADMIN_KEY || 'Fraga@123';
  if (!adminKey || adminKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized: x-admin-key inválida' });
  }
  next();
}

router.get('/test/sieg-sync', validateAdminKey, async (req: any, res: any) => {
  try {
    console.log('[TEST-SIEG-SYNC] 🚀 Iniciando sincronização manual...');
    
    const result = await syncCertificatesToSieg();
    
    console.log('[TEST-SIEG-SYNC] ✅ Sincronização concluída');
    
    res.json({
      success: result.success,
      message: result.message,
      stats: result.stats,
    });
  } catch (error) {
    console.error('[TEST-SIEG-SYNC] ❌ Erro:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

export default router;
