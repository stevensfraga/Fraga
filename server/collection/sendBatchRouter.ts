/**
 * BLOCO 11 (C) — ESCALAR LOTE (SAFE RAMP-UP)
 * 
 * POST /api/collection/send-batch
 * 
 * Suporta 2 modos:
 * - mode=receivable (legado): 1 msg por receivable
 * - mode=client (consolidado): 1 msg por cliente (anti-spam)
 * 
 * Proteções:
 * - dryRun=true por padrão (modo preview)
 * - dryRun=false exige confirm=true
 * - Rate-limit de 2s entre envios reais
 * - Anti-spam: máx 1 msg/cliente/dia + 48h cooldown (mode=client)
 */

import { Router, Request, Response } from 'express';
import { executeBatch } from './batchSender';
import { executeClientBatch } from './clientBatchSender';
import type { BucketCode } from './buckets';

const router = Router();

/**
 * POST /send-batch
 * 
 * Body:
 * {
 *   "bucketCode": "B|C|D|A",
 *   "limit": 20,              // default 10, max 100
 *   "dryRun": true,           // default true
 *   "confirm": false,         // default false
 *   "mode": "client"          // "client" (consolidado) | "receivable" (legado), default "client"
 * }
 */
router.post('/send-batch', async (req: Request, res: Response) => {
  try {
    const {
      bucketCode = 'B',
      limit = 10,
      dryRun = true,
      confirm = false,
      mode = 'client', // Default: consolidado por cliente
    } = req.body;

    // Validação de bucket
    const validBuckets: BucketCode[] = ['A', 'B', 'C', 'D'];
    if (!validBuckets.includes(bucketCode)) {
      return res.status(400).json({
        error: 'Invalid bucketCode',
        validBuckets,
      });
    }

    // Validação de mode
    const validModes = ['client', 'receivable'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode',
        validModes,
        hint: 'mode=client (consolidado, 1 msg/cliente) ou mode=receivable (legado, 1 msg/receivable)',
      });
    }

    // Validação de limit
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: 'Invalid limit',
        message: 'limit must be between 1 and 100',
      });
    }

    // PROTEÇÃO 1: dryRun=false exige confirm=true
    if (dryRun === false && confirm !== true) {
      console.log('[GUARD] REAL_SEND_BLOCKED: confirm=false');
      return res.status(400).json({
        success: false,
        decision: 'CONFIRM_REQUIRED',
        message: 'Para envio real (dryRun=false), você DEVE passar confirm=true',
        hint: 'Adicione "confirm": true no body da requisição',
        example: {
          bucketCode,
          limit: limitNum,
          dryRun: false,
          confirm: true,
          mode,
        },
      });
    }

    // PROTEÇÃO 2: dryRun=false exige ALLOW_REAL_SEND=true
    if (dryRun === false && process.env.ALLOW_REAL_SEND !== 'true') {
      console.log('[GUARD] REAL_SEND_BLOCKED: ALLOW_REAL_SEND!=true');
      return res.status(403).json({
        success: false,
        decision: 'REAL_SEND_DISABLED',
        message: 'Envio real desabilitado. Configure ALLOW_REAL_SEND=true para habilitar.',
        currentState: {
          dryRun,
          confirm,
          mode,
          allowRealSend: process.env.ALLOW_REAL_SEND || 'false',
        },
      });
    }

    console.log(`[SendBatch] Iniciando lote: bucket=${bucketCode}, limit=${limitNum}, dryRun=${dryRun}, mode=${mode}`);

    // Executar lote no modo correto
    if (mode === 'client') {
      // MODO CONSOLIDADO: 1 msg por cliente
      const result = await executeClientBatch(bucketCode, limitNum, dryRun);

      console.log(`[SendBatch] ✅ Lote CONSOLIDADO concluído: ${result.sent} enviados, ${result.skipped} pulados, ${result.failed} falhas`);

      return res.json({
        success: true,
        decision: dryRun ? 'DRY_RUN' : 'SENT',
        timestamp: new Date().toISOString(),
        bucketCode,
        mode: 'client',
        summary: {
          total: result.total,
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
        },
        results: result.results.slice(0, 30),
        _meta: {
          dryRun,
          confirm,
          mode: 'client',
          batchId: result.batchId,
        },
      });
    } else {
      // MODO LEGADO: 1 msg por receivable
      const result = await executeBatch(bucketCode, limitNum, dryRun);

      console.log(`[SendBatch] ✅ Lote RECEIVABLE concluído: ${result.sent} enviados, ${result.skipped} pulados, ${result.failed} falhas`);

      return res.json({
        success: true,
        decision: dryRun ? 'DRY_RUN' : 'SENT',
        timestamp: new Date().toISOString(),
        bucketCode,
        mode: 'receivable',
        summary: {
          total: result.total,
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
        },
        results: result.results.slice(0, 20),
        _meta: {
          dryRun,
          confirm,
          mode: 'receivable',
          batchId: result.batchId,
        },
      });
    }
  } catch (error: any) {
    console.error('[SendBatch] ❌ Erro:', error.message);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

export default router;
