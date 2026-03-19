import { CronJob } from 'cron';
import { sendReactivation, getReactivationCandidates } from '../services/reactivationService';

let scheduler: CronJob | null = null;

export function initReactivationScheduler() {
  const enabled = process.env.ENABLE_REACTIVATION_SCHEDULER === 'true';
  
  if (!enabled) {
    console.log('[ReactivationScheduler] Desabilitado (ENABLE_REACTIVATION_SCHEDULER != true)');
    return;
  }

  // Cron: 08:05 America/Sao_Paulo (10:05 UTC)
  // Formato: segundo minuto hora dia mês dia-semana
  // 0 5 8 * * * = 08:05 UTC-3 (America/Sao_Paulo)
  // Mas como o cron roda em UTC, precisamos de 10:05 UTC
  // 0 5 10 * * *
  const cronExpression = '0 5 10 * * *';

  scheduler = new CronJob(
    cronExpression,
    async () => {
      await runReactivationBatch();
    },
    null,
    true,
    'America/Sao_Paulo'
  );

  console.log('[ReactivationScheduler] ✅ Scheduler de reativação iniciado (08:05 diariamente)');
}

export async function runReactivationBatch() {
  console.log('[ReactivationBatch] START - Iniciando lote de reativação');
  
  try {
    // Buscar candidatos (máximo 10)
    const candidates = await getReactivationCandidates(10);
    console.log(`[ReactivationBatch] FOUND ${candidates.length} candidatos elegíveis`);

    if (candidates.length === 0) {
      console.log('[ReactivationBatch] DONE sent=0 skipped=0 blocked=0');
      return;
    }

    let sent = 0;
    let skipped = 0;
    let blocked = 0;

    // Enviar para cada candidato
    for (const candidate of candidates) {
      const result = await sendReactivation(candidate.id);
      
      if (result.success) {
        sent++;
      } else if (result.error === 'DUPLICATE_BLOCKED') {
        skipped++;
      } else {
        blocked++;
      }

      // Rate limit: 100ms entre mensagens
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[ReactivationBatch] DONE sent=${sent} skipped=${skipped} blocked=${blocked}`);
  } catch (error: any) {
    console.error(`[ReactivationBatch] ERROR: ${error.message}`);
  }
}

export function stopReactivationScheduler() {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
    console.log('[ReactivationScheduler] Scheduler parado');
  }
}
