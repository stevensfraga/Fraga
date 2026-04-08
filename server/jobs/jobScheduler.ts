/**
 * Job Scheduler — Collection Shield Production
 *
 * Ordem crítica dos jobs (horários em São Paulo):
 *   06:50 SP → recon.lite (pagos últimos 60 dias)
 *   07:10 SP → recon.full (reconciliação completa)
 *   07:30 SP → collection.run (régua de cobrança)
 *
 * Isso garante que:
 *   1. Pagamentos recentes são sincronizados primeiro
 *   2. Reconciliação completa valida integridade
 *   3. Régua roda com dados atualizados e validados
 */

import cron, { ScheduledTask } from 'node-cron';
import { startReconciliationJob } from './reconciliationJob';
import { runFullSync } from '../fullSyncRouter';
import { syncPaymentsJob } from '../syncPaymentsJob';
import { syncCertificatesToSieg } from './syncCertificatesToSieg';
import { reconcileSiegCertificates } from './reconcileSiegCertificates';
import { startCertificateWatcher } from './certificateWatcher';
import { getDb } from '../db';
import { syncCursor } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

const logger = {
  info: (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`),
  warn: (msg: string) => console.warn(`[${new Date().toISOString()}] ${msg}`),
  error: (msg: string) => console.error(`[${new Date().toISOString()}] ${msg}`),
};

/**
 * Persistir resultado do sync no syncCursor para rastreamento de lastSyncAt
 */
async function persistSyncCursor(result: Awaited<ReturnType<typeof syncPaymentsJob>>) {
  try {
    const db = await getDb();
    if (!db) return;
    const existing = await db.select().from(syncCursor)
      .where(eq(syncCursor.syncType, 'payments_lite'))
      .limit(1);
    const lastResult = JSON.stringify({
      checkedLocal: result.checkedLocal,
      resolvedCount: result.resolvedCount,
      updatedCount: result.updatedCount,
      windowDays: result.windowDays,
      durationMs: result.durationMs,
      error: result.error,
    });
    if (existing.length > 0) {
      await db.update(syncCursor)
        .set({
          lastSyncAt: new Date(),
          lastStatus: result.success ? 'success' : 'failed',
          lastResult,
        })
        .where(eq(syncCursor.syncType, 'payments_lite'));
    } else {
      await db.insert(syncCursor).values({
        syncType: 'payments_lite',
        lastSyncAt: new Date(),
        lastStatus: result.success ? 'success' : 'failed',
        lastResult,
      });
    }
  } catch (err: any) {
    logger.error(`[JobScheduler] Erro ao persistir syncCursor: ${err.message}`);
  }
}

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export interface JobScheduleConfig {
  name: string;
  cronExpression: string; // 6-field cron: sec min hour day month dayOfWeek
  description: string;
  handler: () => Promise<void>;
  enabled: boolean;
}

interface JobStatus {
  name: string;
  enabled: boolean;
  nextRun?: Date;
}

// ─── JOBS ────────────────────────────────────────────────────────────────────

const jobConfigs: JobScheduleConfig[] = [
  {
    name: 'recon-lite',
    cronExpression: '0 50 6 * * 1-5', // 06:50 seg-sex (SP = UTC-3)
    description: 'Sincroniza pagamentos dos últimos 60 dias',
    handler: async () => {
      logger.info('[JobScheduler] 🔄 Iniciando recon.lite (pagos últimos 60 dias)');
      // TODO: Implementar recon.lite
      // await reconLiteService.run();
    },
    enabled: true,
  },
  {
    name: 'recon-full',
    cronExpression: '0 10 7 * * 1-5', // 07:10 seg-sex (SP = UTC-3)
    description: 'Reconciliação completa Conta Azul × DB',
    handler: async () => {
      logger.info('[JobScheduler] 🔄 Iniciando recon.full (reconciliação completa)');
      // Usar job existente
      await startReconciliationJob();
    },
    enabled: true,
  },
  {
    name: 'collection-run',
    cronExpression: '0 30 7 * * 1-5', // 07:30 seg-sex (SP = UTC-3)
    description: 'Régua de cobrança com validação em tempo real',
    handler: async () => {
      logger.info('[JobScheduler] 📧 Iniciando collection.run (régua de cobrança)');
      // TODO: Implementar collection.run
      // await reguaCobrancaService.executeRegua();
    },
    enabled: true,
  },
  {
    // Sync de pagamentos a cada 15 min — horário comercial (07:00-19:00 BRT, seg-sab)
    // BRT = UTC-3, então 07:00-19:00 BRT = 10:00-22:00 UTC
    name: 'sync-payments-15min',
    cronExpression: '0 */15 10-22 * * 1-6', // a cada 15 min, 10:00-22:00 UTC = 07:00-19:00 BRT
    description: 'Sync incremental de pagamentos (360 dias) — horário comercial',
    handler: async () => {
      logger.info('[SyncPayments] 🔄 Iniciando sync automático de pagamentos (360 dias)');
      const result = await syncPaymentsJob(360);
      await persistSyncCursor(result);
      if (result.success) {
        logger.info(`[SyncPayments] ✅ Sync automático concluído: checked=${result.checkedLocal}, updated=${result.updatedCount}, duration=${result.durationMs}ms`);
      } else {
        logger.error(`[SyncPayments] ❌ Sync automático falhou: ${result.error}`);
      }
    },
    enabled: process.env.ALLOW_CRON_ENABLE === 'true',
  },
  {
    // Full sync semanal — todo domingo às 02:00 BRT (= 05:00 UTC)
    // Importa títulos novos criados no CA desde o último sync
    name: 'full-sync-semanal',
    cronExpression: '0 0 5 * * 0', // domingo 05:00 UTC = 02:00 BRT
    description: 'Full sync semanal: importa títulos novos do Conta Azul (180 dias)',
    handler: async () => {
      logger.info('[JobScheduler] 🔄 Iniciando full-sync-semanal (domingo 02:00 BRT)');
      const result = await runFullSync(180);
      logger.info(`[JobScheduler] ✅ full-sync-semanal concluído: imported=${result.imported} | updated=${result.updated} | errors=${result.errors}`);
    },
    enabled: true,
  },
  {
    // Sincronização de certificados com SIEG — diariamente às 08:00 BRT (= 11:00 UTC)
    name: 'sieg-sync-daily',
    cronExpression: '0 0 11 * * *', // todos os dias 11:00 UTC = 08:00 BRT
    description: 'Sincroniza certificados com SIEG (piloto + lote automático)',
    handler: async () => {
      logger.info('[JobScheduler] 🔐 Iniciando sieg-sync-daily (08:00 BRT)');
      const result = await syncCertificatesToSieg();
      if (result.success) {
        logger.info(`[JobScheduler] ✅ sieg-sync-daily concluído: sent=${result.stats.sent}, failed=${result.stats.failed}`);
      } else {
        logger.error(`[JobScheduler] ❌ sieg-sync-daily falhou: ${result.message}`);
      }
    },
    enabled: process.env.ALLOW_CRON_ENABLE === 'true',
  },
  {
    // Reconciliação SIEG ↔ banco local — diáriamente às 07:30 BRT (= 10:30 UTC)
    // Roda ANTES do sieg-sync-daily (08:00) para garantir visão completa
    name: 'sieg-recon-daily',
    cronExpression: '0 30 10 * * *', // todos os dias 10:30 UTC = 07:30 BRT
    description: 'Reconcilia certificados SIEG ↔ banco local (atualiza campos de reconciliação)',
    handler: async () => {
      logger.info('[JobScheduler] 🔄 Iniciando sieg-recon-daily (07:30 BRT)');
      const result = await reconcileSiegCertificates();
      if (result.success) {
        logger.info(
          `[JobScheduler] ✅ sieg-recon-daily concluído: ` +
          `local_ok=${result.stats.local_ok}, sieg_only=${result.stats.sieg_only}, ` +
          `local_only=${result.stats.local_only}, divergent=${result.stats.divergent}, ` +
          `criados=${result.stats.created}, erros=${result.stats.errors}`
        );
      } else {
        logger.error(`[JobScheduler] ❌ sieg-recon-daily falhou: ${result.errors[0]?.error || 'Erro desconhecido'}`);
      }
    },
    enabled: process.env.ALLOW_CRON_ENABLE === 'true',
  },
];

// ─── GERENCIADOR DE JOBS ─────────────────────────────────────────────────────

const scheduledJobs = new Map<string, ScheduledTask>();

export const startAllJobs = initializeJobs;

export function initializeJobs(): void {
  // Inicializar watcher de certificados
  startCertificateWatcher();

  logger.info('[JobScheduler] 🚀 Iniciando scheduler de jobs');

  for (const config of jobConfigs) {
    if (!config.enabled) {
      logger.warn(`[JobScheduler] ⏭️ Job desabilitado: ${config.name}`);
      continue;
    }

    try {
      const task = cron.schedule(config.cronExpression, async () => {
        logger.info(`[JobScheduler] ▶️ Executando: ${config.name} - ${config.description}`);
        try {
          await config.handler();
          logger.info(`[JobScheduler] ✅ Concluído: ${config.name}`);
        } catch (error: any) {
          logger.error(`[JobScheduler] ❌ Erro em ${config.name}: ${error.message}`);
        }
      });

      scheduledJobs.set(config.name, task);
      logger.info(`[JobScheduler] ✅ Job agendado: ${config.name} @ ${config.cronExpression}`);
    } catch (error: any) {
      logger.error(`[JobScheduler] ❌ Erro ao agendar ${config.name}: ${error.message}`);
    }
  }
}

export function stopAllJobs(): void {
  logger.info('[JobScheduler] 🛑 Parando todos os jobs');
  scheduledJobs.forEach((task, name) => {
    task.stop();
    logger.info(`[JobScheduler] ⏹️ Job parado: ${name}`);
  });
  scheduledJobs.clear();
}

export function getJobStatus(): JobStatus[] {
  return jobConfigs.map(config => {
    return {
      name: config.name,
      enabled: config.enabled,
      nextRun: undefined, // node-cron não expõe nextDate publicamente
    };
  });
}
