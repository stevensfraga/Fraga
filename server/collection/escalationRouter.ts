/**
 * RÉGUA AUTOMÁTICA DE COBRANÇA — ESCALATION CYCLE
 * 
 * POST /api/collection/escalation/run
 * 
 * Executa ciclo completo de escalonamento:
 * 1. Verifica safeguards (KILL_SWITCH, TOKEN_GUARD, SAFETY_CAP)
 * 2. Percorre buckets A→B→C→D
 * 3. Envia mode=client (consolidado) para cada bucket
 * 4. Respeita safety cap global (50/dia)
 * 5. Anti-spam: 48h cooldown + 1 msg/cliente/dia
 * 6. Circuit breaker: aborta se falhas > 10%
 * 
 * Query params:
 * - dryRun=true (default) → apenas preview
 * - dryRun=false&confirm=true → envio real
 */

import { Router, Request, Response } from 'express';
import { executeClientBatch, ClientBatchResult } from './clientBatchSender';
import { getEligibleClientsForBucket } from './clientConsolidation';
import { checkTokenHealth } from './tokenGuard';
import { checkDailyUsage } from './safetyCap';
import type { BucketCode } from './buckets';

const router = Router();

// Limites por bucket na régua automática
const BUCKET_LIMITS: Record<BucketCode, number> = {
  A: 10,  // Lembrete leve (D+1 a D+3)
  B: 15,  // Cobrança formal (D+4 a D+15)
  C: 15,  // Cobrança firme (D+16 a D+30)
  D: 10,  // Pré-jurídico (+30 dias)
};

// Safety cap global por dia
const ESCALATION_SAFETY_CAP = 50;

interface EscalationResult {
  cycleId: string;
  timestamp: string;
  dryRun: boolean;
  safeguards: {
    killSwitch: boolean;
    tokenGuard: { decision: string; message: string };
    safetyCap: { sentToday: number; remaining: number; maxDaily: number };
  };
  buckets: Record<BucketCode, {
    eligible: number;
    sent: number;
    skipped: number;
    failed: number;
    blocked: number;
    batchId?: string;
  }>;
  totals: {
    eligible: number;
    sent: number;
    skipped: number;
    failed: number;
  };
  duration: number;
}

/**
 * POST /escalation/run
 * 
 * Query:
 * - dryRun: "true" (default) | "false"
 * - confirm: "true" (required when dryRun=false)
 */
router.post('/escalation/run', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const cycleId = `escalation_${Date.now()}`;
  const dryRunParam = req.query.dryRun !== 'false';
  const confirmParam = req.query.confirm === 'true';

  console.log(`[Escalation] 🚀 Iniciando ciclo: cycleId=${cycleId}, dryRun=${dryRunParam}`);

  try {
    // ====== SAFEGUARD 1: KILL_SWITCH ======
    if (process.env.KILL_SWITCH === 'true') {
      console.error('[Escalation] ❌ KILL_SWITCH ATIVO — abortando');
      return res.status(503).json({
        success: false,
        decision: 'KILLED',
        message: 'Sistema abortado por KILL_SWITCH ativo',
      });
    }

    // ====== SAFEGUARD 2: ALLOW_REAL_SEND (se não é dry run) ======
    if (!dryRunParam && process.env.ALLOW_REAL_SEND !== 'true') {
      console.log('[Escalation] ❌ ALLOW_REAL_SEND não está true');
      return res.status(403).json({
        success: false,
        decision: 'REAL_SEND_DISABLED',
        message: 'Envio real desabilitado. Configure ALLOW_REAL_SEND=true.',
      });
    }

    // ====== SAFEGUARD 3: CONFIRM (se não é dry run) ======
    if (!dryRunParam && !confirmParam) {
      return res.status(400).json({
        success: false,
        decision: 'CONFIRM_REQUIRED',
        message: 'Para envio real, adicione ?dryRun=false&confirm=true',
      });
    }

    // ====== SAFEGUARD 4: TOKEN_GUARD ======
    console.log('[Escalation] 🔒 Verificando token Conta Azul...');
    const tokenHealth = await checkTokenHealth();

    if (tokenHealth.decision !== 'TOKEN_OK') {
      console.error(`[Escalation] ❌ TOKEN_GUARD: ${tokenHealth.decision}`);
      return res.status(503).json({
        success: false,
        decision: 'TOKEN_GUARD_FAILED',
        tokenGuard: tokenHealth,
        message: `Token Conta Azul inválido: ${tokenHealth.message}`,
      });
    }
    console.log('[Escalation] ✅ TOKEN_GUARD OK');

    // ====== SAFEGUARD 5: SAFETY_CAP ======
    console.log('[Escalation] 🛡️ Verificando safety cap diário...');
    const dailyUsage = await checkDailyUsage();

    if (dailyUsage.exceeded) {
      console.error('[Escalation] ❌ SAFETY_CAP excedido');
      return res.status(429).json({
        success: false,
        decision: 'SAFETY_CAP_EXCEEDED',
        safetyCap: dailyUsage,
        message: `Limite diário excedido: ${dailyUsage.sentToday}/${dailyUsage.maxDaily}`,
      });
    }
    console.log(`[Escalation] ✅ SAFETY_CAP OK: ${dailyUsage.sentToday}/${dailyUsage.maxDaily}`);

    // ====== EXECUTAR CICLO POR BUCKET ======
    const bucketOrder: BucketCode[] = ['A', 'B', 'C', 'D'];
    const bucketResults: Record<BucketCode, {
      eligible: number;
      sent: number;
      skipped: number;
      failed: number;
      blocked: number;
      batchId?: string;
    }> = {
      A: { eligible: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 },
      B: { eligible: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 },
      C: { eligible: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 },
      D: { eligible: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 },
    };

    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let totalEligible = 0;
    let remainingCap = Math.min(ESCALATION_SAFETY_CAP, dailyUsage.remaining);

    for (const bucket of bucketOrder) {
      if (remainingCap <= 0) {
        console.log(`[Escalation] ⏸️ Safety cap atingido, pulando bucket ${bucket}`);
        continue;
      }

      const bucketLimit = Math.min(BUCKET_LIMITS[bucket], remainingCap);
      console.log(`[Escalation] 📤 Bucket ${bucket}: limit=${bucketLimit} (cap restante: ${remainingCap})`);

      try {
        // Primeiro verificar quantos elegíveis existem
        const eligible = await getEligibleClientsForBucket(bucket, bucketLimit * 2);
        const eligibleCount = eligible.filter(c => c.eligible).length;
        const blockedCount = eligible.filter(c => !c.eligible).length;

        bucketResults[bucket].eligible = eligibleCount;
        bucketResults[bucket].blocked = blockedCount;
        totalEligible += eligibleCount;

        if (eligibleCount === 0) {
          console.log(`[Escalation] ⏸️ Bucket ${bucket}: 0 elegíveis, pulando`);
          continue;
        }

        // Executar batch consolidado
        const batchResult = await executeClientBatch(bucket, bucketLimit, dryRunParam);

        bucketResults[bucket].sent = batchResult.sent;
        bucketResults[bucket].skipped = batchResult.skipped;
        bucketResults[bucket].failed = batchResult.failed;
        bucketResults[bucket].batchId = batchResult.batchId;

        totalSent += batchResult.sent;
        totalSkipped += batchResult.skipped;
        totalFailed += batchResult.failed;

        // Atualizar cap restante
        if (!dryRunParam) {
          remainingCap -= batchResult.sent;
        }

        console.log(`[Escalation] ✅ Bucket ${bucket}: sent=${batchResult.sent}, skipped=${batchResult.skipped}, failed=${batchResult.failed}`);

        // CIRCUIT BREAKER GLOBAL: se falhas > 10% do total, abortar
        const totalAttempted = totalSent + totalFailed;
        if (!dryRunParam && totalAttempted > 5 && totalFailed / totalAttempted > 0.10) {
          console.error(`[Escalation] ❌ CIRCUIT BREAKER GLOBAL: failureRate=${((totalFailed / totalAttempted) * 100).toFixed(1)}%`);
          break;
        }

      } catch (error: any) {
        console.error(`[Escalation] ❌ Erro no bucket ${bucket}: ${error.message}`);
        bucketResults[bucket].failed = 1;
        totalFailed++;
      }
    }

    const duration = Date.now() - startTime;

    const result: EscalationResult = {
      cycleId,
      timestamp: new Date().toISOString(),
      dryRun: dryRunParam,
      safeguards: {
        killSwitch: false,
        tokenGuard: { decision: tokenHealth.decision, message: tokenHealth.message },
        safetyCap: {
          sentToday: dailyUsage.sentToday,
          remaining: dailyUsage.remaining,
          maxDaily: dailyUsage.maxDaily,
        },
      },
      buckets: bucketResults,
      totals: {
        eligible: totalEligible,
        sent: totalSent,
        skipped: totalSkipped,
        failed: totalFailed,
      },
      duration,
    };

    console.log(`[Escalation] ✅ Ciclo concluído em ${duration}ms: sent=${totalSent}, skipped=${totalSkipped}, failed=${totalFailed}`);

    return res.json({
      success: true,
      decision: dryRunParam ? 'DRY_RUN' : 'EXECUTED',
      ...result,
    });

  } catch (error: any) {
    console.error(`[Escalation] ❌ Erro fatal: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      cycleId,
      duration: Date.now() - startTime,
    });
  }
});

/**
 * GET /escalation/status
 * Retorna preview dos elegíveis por bucket sem enviar nada
 */
router.get('/escalation/status', async (req: Request, res: Response) => {
  try {
    const bucketOrder: BucketCode[] = ['A', 'B', 'C', 'D'];
    const preview: Record<BucketCode, { eligible: number; blocked: number; totalDebt: number; topClients: string[] }> = {
      A: { eligible: 0, blocked: 0, totalDebt: 0, topClients: [] },
      B: { eligible: 0, blocked: 0, totalDebt: 0, topClients: [] },
      C: { eligible: 0, blocked: 0, totalDebt: 0, topClients: [] },
      D: { eligible: 0, blocked: 0, totalDebt: 0, topClients: [] },
    };

    let totalEligible = 0;
    let totalBlocked = 0;
    let totalDebt = 0;

    for (const bucket of bucketOrder) {
      const clients = await getEligibleClientsForBucket(bucket, 50);
      const eligible = clients.filter(c => c.eligible);
      const blocked = clients.filter(c => !c.eligible);

      preview[bucket] = {
        eligible: eligible.length,
        blocked: blocked.length,
        totalDebt: eligible.reduce((sum, c) => sum + c.totalDebt, 0),
        topClients: eligible.slice(0, 3).map(c => `${c.clientName} (R$ ${c.totalDebt.toFixed(2)})`),
      };

      totalEligible += eligible.length;
      totalBlocked += blocked.length;
      totalDebt += preview[bucket].totalDebt;
    }

    // Verificar safeguards
    const tokenHealth = await checkTokenHealth();
    const dailyUsage = await checkDailyUsage();

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      safeguards: {
        killSwitch: process.env.KILL_SWITCH === 'true',
        allowRealSend: process.env.ALLOW_REAL_SEND === 'true',
        allowCronEnable: process.env.ALLOW_CRON_ENABLE === 'true',
        tokenGuard: tokenHealth.decision,
        safetyCap: `${dailyUsage.sentToday}/${dailyUsage.maxDaily} (${dailyUsage.remaining} restantes)`,
      },
      totals: {
        eligible: totalEligible,
        blocked: totalBlocked,
        totalDebt: Math.round(totalDebt * 100) / 100,
      },
      buckets: preview,
      limits: BUCKET_LIMITS,
      safetyCap: ESCALATION_SAFETY_CAP,
    });

  } catch (error: any) {
    console.error(`[Escalation] ❌ Erro no status: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
