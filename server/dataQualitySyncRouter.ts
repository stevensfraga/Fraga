/**
 * 🔄 Data Quality Sync Router
 * Endpoints para sincronizar dados com Conta Azul e liberar scheduler
 * 
 * POST /api/test/data-quality/run-doc-sync?limit=50
 * POST /api/test/data-quality/run-whatsapp-sync?limit=50
 * POST /api/test/data-quality/quarantine-invalid-receivables
 * GET /api/test/data-quality/sync-status
 */

import { Router } from 'express';
import * as crypto from 'crypto';
import { syncDocumentsFromContaAzul } from './services/syncDocumentService';
import { syncWhatsappFromContaAzul } from './services/syncWhatsappService';
import { quarantineInvalidReceivables } from './services/fixReceivableSourceService';

const router = Router();

/**
 * DEV ONLY: Middleware para validar X-Dev-Secret
 */
function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  if (!devSecret) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }

  const headerSecret = req.headers['x-dev-secret'];
  let isValidSecret = false;
  try {
    const headerBuf = Buffer.from(headerSecret || '');
    const devSecretBuf = Buffer.from(devSecret);
    if (headerBuf.length === devSecretBuf.length) {
      isValidSecret = crypto.timingSafeEqual(headerBuf, devSecretBuf);
    }
  } catch (e) {
    isValidSecret = false;
  }

  if (!isValidSecret) {
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  return true;
}

/**
 * POST /api/test/data-quality/run-doc-sync?limit=50
 * Sincronizar documentos (CPF/CNPJ) de clientes com Conta Azul
 */
router.post('/run-doc-sync', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const limit = parseInt(req.query.limit as string) || 50;

    console.log(`[DataQualitySync] Iniciando sincronização de documentos (limit=${limit})`);

    const results = await syncDocumentsFromContaAzul(limit);

    const updated = results.filter(r => r.status === 'UPDATED').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    return res.json({
      success: true,
      operation: 'sync-documents',
      limit,
      results: {
        total: results.length,
        updated,
        blocked,
        errors,
      },
      details: results,
    });
  } catch (err: any) {
    console.error('[DataQualitySync] Error in run-doc-sync:', err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

/**
 * POST /api/test/data-quality/run-whatsapp-sync?limit=50
 * Sincronizar WhatsApp de clientes com Conta Azul
 */
router.post('/run-whatsapp-sync', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const limit = parseInt(req.query.limit as string) || 50;

    console.log(`[DataQualitySync] Iniciando sincronização de WhatsApp (limit=${limit})`);

    const results = await syncWhatsappFromContaAzul(limit);

    const updated = results.filter(r => r.status === 'UPDATED').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    return res.json({
      success: true,
      operation: 'sync-whatsapp',
      limit,
      results: {
        total: results.length,
        updated,
        blocked,
        errors,
      },
      details: results,
    });
  } catch (err: any) {
    console.error('[DataQualitySync] Error in run-whatsapp-sync:', err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

/**
 * POST /api/test/data-quality/quarantine-invalid-receivables
 * Quarentena de receivables com source inválido
 */
router.post('/quarantine-invalid-receivables', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[DataQualitySync] Iniciando quarentena de receivables inválidos`);

    const results = await quarantineInvalidReceivables();

    const quarantined = results.filter(r => r.status === 'QUARANTINED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    return res.json({
      success: true,
      operation: 'quarantine-receivables',
      results: {
        total: results.length,
        quarantined,
        errors,
      },
      details: results,
    });
  } catch (err: any) {
    console.error('[DataQualitySync] Error in quarantine-invalid-receivables:', err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

/**
 * GET /api/test/data-quality/sync-status
 * Status de sincronização (estatísticas)
 */
router.get('/sync-status', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[DataQualitySync] Obtendo status de sincronização`);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Use /api/test/data-quality/sanitation-summary para obter status completo'
    });
  } catch (err: any) {
    console.error('[DataQualitySync] Error in sync-status:', err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

export default router;
