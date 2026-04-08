/**
 * BLOCO 11 (D) — CRON DIÁRIO (AUTOMAÇÃO SEG-SEX 07:30)
 * 
 * Pipeline automático de cobrança CONSOLIDADA (mode=client):
 * 1. Verificar safeguards (KILL_SWITCH, TOKEN_GUARD, SAFETY_CAP)
 * 2. Percorrer buckets A→B→C→D
 * 3. Enviar mode=client (1 msg por cliente, anti-spam)
 * 4. Safety cap global: 50/dia
 * 5. Circuit breaker: aborta se falhas > 10%
 * 
 * Safeguards:
 * - Quiet hours: 07:00-20:00 BRT
 * - Circuit breaker: abortar se ZapContábil falhar > 10%
 * - Abortar se tokenContaAzul = REAUTH_REQUIRED
 * 
 * Persistência:
 * - lastRun salvo no banco (tabela cron_state) para sobreviver a hibernações
 * - CronWatchdog verifica a cada hora (07:00-09:00 BRT) se cron rodou hoje
 */

import * as cron from 'node-cron';
import { executeClientBatch } from './clientBatchSender';
import type { BucketCode } from './buckets';
import { checkTokenHealth } from './tokenGuard';
import { checkDailyUsage } from './safetyCap';
import { runFollowupCycle } from './noResponseFollowup';
import { FEATURE_FLAGS } from '../_core/featureFlags';
import { syncPaymentsJob } from '../syncPaymentsJob';
import { saveCronStateToDb, loadCronStateFromDb, didCronRunToday } from './cronStateDb';

// Limites por bucket (mesmos da régua de escalation)
const BUCKET_LIMITS: Record<BucketCode, number> = {
  A: 10,
  B: 15,
  C: 15,
  D: 10,
};

const ESCALATION_SAFETY_CAP = 50;

interface CronStatus {
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  lastResult: {
    timestamp: string;
    totalSent: number;
    totalSkipped: number;
    totalFailed: number;
    bucketBreakdown: Record<BucketCode, { sent: number; skipped: number; failed: number }>;
  } | null;
}

// Auto-enable baseado em ALLOW_CRON_ENABLE (persiste entre restarts)
const AUTO_ENABLE = process.env.ALLOW_CRON_ENABLE === 'true';
let cronEnabled = AUTO_ENABLE; // Se ALLOW_CRON_ENABLE=true, inicia habilitado
let cronTask: ReturnType<typeof cron.schedule> | null = null;
let watchdogTask: ReturnType<typeof cron.schedule> | null = null;
let cronStatus: CronStatus = {
  enabled: AUTO_ENABLE,
  lastRun: null,
  nextRun: null,
  lastResult: null,
};

if (AUTO_ENABLE) {
  console.log('[CronScheduler] ✅ Auto-habilitado via ALLOW_CRON_ENABLE=true');
}

/**
 * Inicializar estado em memória a partir do banco de dados.
 * Chamado no startup para restaurar lastRun após hibernação.
 */
export async function initCronStateFromDb(): Promise<void> {
  try {
    const state = await loadCronStateFromDb();
    if (state.lastRunAt) {
      cronStatus.lastRun = state.lastRunAt.toISOString();
      if (state.lastResult) {
        const r = state.lastResult;
        cronStatus.lastResult = {
          timestamp: state.lastRunAt.toISOString(),
          totalSent: r.totalSent ?? 0,
          totalSkipped: r.totalSkipped ?? 0,
          totalFailed: r.totalFailed ?? 0,
          bucketBreakdown: r.bucketBreakdown ?? {
            A: { sent: 0, skipped: 0, failed: 0 },
            B: { sent: 0, skipped: 0, failed: 0 },
            C: { sent: 0, skipped: 0, failed: 0 },
            D: { sent: 0, skipped: 0, failed: 0 },
          },
        };
      }
      console.log(`[CronScheduler] ✅ Estado restaurado do banco: lastRun=${state.lastRunAt.toISOString()}`);
    } else {
      console.log('[CronScheduler] ℹ️ Nenhum estado anterior no banco (primeira execução)');
    }
  } catch (err: any) {
    console.error('[CronScheduler] ⚠️ Erro ao restaurar estado do banco:', err.message);
  }
}

/**
 * Verificar se está dentro do horário permitido (07:00-20:00 BRT)
 * Usa timezone America/Sao_Paulo para evitar erros com UTC.
 * Inicia às 07:00 para ser compatível com o cron de 07:30.
 */
function isWithinQuietHours(): boolean {
  const now = new Date();
  const hourBRT = parseInt(
    now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }),
    10
  );
  return hourBRT >= 7 && hourBRT < 20;
}

/**
 * Verificar se é dia útil (seg-sex) em BRT
 */
function isWeekday(): boolean {
  const now = new Date();
  const weekdayBRT = now.toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
  return !['Sat', 'Sun'].includes(weekdayBRT);
}

/**
 * Pipeline automático de cobrança CONSOLIDADA
 * 
 * Usa mode=client (1 msg por cliente) em vez de mode=receivable.
 * 
 * @param ignoreQuietHours - Se true, ignora verificação de quiet hours (mas respeita safeguards)
 */
async function runAutomatedCollectionPipeline(ignoreQuietHours: boolean = false) {
  console.log('[CronScheduler] 🚀 Iniciando pipeline automático de cobrança CONSOLIDADA...');
  
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  const emptyBreakdown: Record<BucketCode, { sent: number; skipped: number; failed: number }> = {
    A: { sent: 0, skipped: 0, failed: 0 },
    B: { sent: 0, skipped: 0, failed: 0 },
    C: { sent: 0, skipped: 0, failed: 0 },
    D: { sent: 0, skipped: 0, failed: 0 },
  };
  
  // Verificar se é dia útil
  if (!isWeekday()) {
    console.log('[CronScheduler] ⏸️ Hoje não é dia útil. Pulando execução.');
    return;
  }
  
  // Verificar quiet hours (a menos que ignoreQuietHours=true)
  if (!ignoreQuietHours && !isWithinQuietHours()) {
    console.log('[CronScheduler] ⏸️ Fora do horário permitido (07:00-20:00 BRT). Pulando execução.');
    return;
  }
  
  if (ignoreQuietHours) {
    console.log('[CronScheduler] ⚠️ MODO REAL: Ignorando quiet hours (07:00-20:00 BRT)');
  }
  
  try {
    // KILL_SWITCH: Abortar tudo se KILL_SWITCH=true
    if (process.env.KILL_SWITCH === 'true') {
      console.error('[KILL_SWITCH] ❌ CRON ABORTADO POR KILL_SWITCH');
      throw new Error('KILLED_BY_OWNER: Sistema abortado por KILL_SWITCH ativo');
    }
    
    // STEP 0: TOKEN GUARD
    console.log('[CronScheduler] 🔒 STEP 0: Verificando token Conta Azul...');
    const tokenHealth = await checkTokenHealth();
    
    if (tokenHealth.decision !== 'TOKEN_OK') {
      console.error(`[CronScheduler] ❌ TOKEN GUARD ABORTA: ${tokenHealth.decision}`);
      console.error('[CronScheduler] Motivo:', tokenHealth.message);
      
      const runAt = new Date(timestamp);
      cronStatus.lastRun = timestamp;
      cronStatus.lastResult = {
        timestamp,
        totalSent: 0,
        totalSkipped: 0,
        totalFailed: 0,
        bucketBreakdown: { ...emptyBreakdown },
      };
      await saveCronStateToDb(runAt, { totalSent: 0, totalSkipped: 0, totalFailed: 0 }, 'failed');
      return;
    }
    
    console.log('[CronScheduler] ✅ TOKEN GUARD OK');
    
    // STEP 0.5: SYNC DE PAGAMENTOS (antes de calcular elegíveis)
    // Garante que títulos pagos no Conta Azul não entrem na régua
    console.log('[CronScheduler] 🔄 STEP 0.5: Sincronizando pagamentos do Conta Azul (janela: 120 dias)...');
    try {
      const syncResult = await syncPaymentsJob(120);
      if (syncResult.success) {
        console.log(`[CronScheduler] ✅ Sync OK: ${syncResult.checkedLocal} checados, ${syncResult.resolvedCount} atualizados para paid/cancelled, duração: ${syncResult.durationMs}ms`);
      } else {
        console.warn('[CronScheduler] ⚠️ Sync de pagamentos retornou erro (modo degradado — continuando com status local)');
      }
    } catch (syncErr: any) {
      // Não abortar o pipeline se o sync falhar — usar status local
      console.warn(`[CronScheduler] ⚠️ Sync de pagamentos falhou: ${syncErr.message} (modo degradado — continuando com status local)`);
    }
    
    // STEP 1: SAFETY CAP
    console.log('[CronScheduler] 🛡️ STEP 1: Verificando limite diário...');
    const dailyUsage = await checkDailyUsage();
    
    if (dailyUsage.exceeded) {
      console.error('[CronScheduler] ❌ SAFETY CAP ABORTA: Limite diário excedido');
      
      const runAt = new Date(timestamp);
      cronStatus.lastRun = timestamp;
      cronStatus.lastResult = {
        timestamp,
        totalSent: 0,
        totalSkipped: 0,
        totalFailed: 0,
        bucketBreakdown: { ...emptyBreakdown },
      };
      await saveCronStateToDb(runAt, { totalSent: 0, totalSkipped: 0, totalFailed: 0 }, 'skipped');
      return;
    }
    
    console.log(`[CronScheduler] ✅ SAFETY CAP OK: ${dailyUsage.sentToday}/${dailyUsage.maxDaily}`);
    
    // STEP 2: EXECUTAR CICLO POR BUCKET (MODE=CLIENT)
    console.log('[CronScheduler] 📤 STEP 2: Disparar lotes CONSOLIDADOS por bucket...');
    
    const bucketBreakdown: Record<BucketCode, { sent: number; skipped: number; failed: number }> = {
      ...emptyBreakdown,
    };
    
    const bucketOrder: BucketCode[] = ['A', 'B', 'C', 'D'];
    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let remainingCap = Math.min(ESCALATION_SAFETY_CAP, dailyUsage.remaining);
    
    for (const bucket of bucketOrder) {
      if (remainingCap <= 0) {
        console.log(`[CronScheduler] ⏸️ Safety cap atingido, pulando bucket ${bucket}`);
        continue;
      }
      
      const bucketLimit = Math.min(BUCKET_LIMITS[bucket], remainingCap);
      console.log(`[CronScheduler] 📤 Bucket ${bucket}: limit=${bucketLimit} (cap restante: ${remainingCap})`);
      
      try {
        // Executar batch CONSOLIDADO (mode=client)
        const result = await executeClientBatch(bucket, bucketLimit, false);
        
        bucketBreakdown[bucket] = {
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
        };
        
        totalSent += result.sent;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
        remainingCap -= result.sent;
        
        console.log(`[CronScheduler] ✅ Bucket ${bucket}: sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}`);
        
        // CIRCUIT BREAKER GLOBAL
        const totalAttempted = totalSent + totalFailed;
        if (totalAttempted > 5 && totalFailed / totalAttempted > 0.10) {
          console.error(`[CronScheduler] ❌ CIRCUIT BREAKER: failureRate > 10%, abortando`);
          break;
        }
        
      } catch (error: any) {
        console.error(`[CronScheduler] ❌ Erro no bucket ${bucket}: ${error.message}`);
        bucketBreakdown[bucket].failed = 1;
        totalFailed++;
      }
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`[CronScheduler] ✅ Pipeline CONSOLIDADO concluído em ${duration}ms`);
    console.log(`[CronScheduler] 📊 Resumo: ${totalSent} enviados, ${totalSkipped} pulados, ${totalFailed} falhas`);
    
    // ---- FOLLOW-UP AUTOMÁTICO (após pipeline principal) ----
    if (FEATURE_FLAGS.FOLLOWUP_ENABLED) {
      try {
        console.log('[CronScheduler] 🔁 Iniciando follow-up automático...');
        const followupResult = await runFollowupCycle(10, false);
        console.log(`[CronScheduler] ✅ Follow-up: ${followupResult.sent} enviados, ${followupResult.skipped} pulados, ${followupResult.failed} falhas`);
      } catch (error: any) {
        console.error(`[CronScheduler] ❌ Erro no follow-up: ${error.message}`);
      }
    } else {
      console.log('[CronScheduler] 🔒 FOLLOWUP_ENABLED=false, pulando follow-up');
    }
    
    // Atualizar status em memória
    cronStatus.lastRun = timestamp;
    cronStatus.lastResult = {
      timestamp,
      totalSent,
      totalSkipped,
      totalFailed,
      bucketBreakdown,
    };
    
    // ✅ PERSISTIR NO BANCO (sobrevive a hibernações)
    const lastStatus = totalFailed > 0 ? 'partial' : 'success';
    await saveCronStateToDb(new Date(timestamp), {
      totalSent,
      totalSkipped,
      totalFailed,
      bucketBreakdown,
    }, lastStatus);
    
  } catch (error: any) {
    console.error('[CronScheduler] ❌ Erro no pipeline:', error.message);
    throw error;
  }
}

/**
 * Iniciar cron scheduler
 */
export function startCronScheduler() {
  if (cronTask) {
    console.log('[CronScheduler] ⚠️ Cron já está rodando');
    return;
  }
  
  // Cron expression: "0 30 7 * * 1-5" = 07:30 seg-sex (America/Sao_Paulo)
  cronTask = cron.schedule('0 30 7 * * 1-5', async () => {
    if (!cronEnabled) {
      console.log('[CronScheduler] ⏸️ Cron desabilitado. Pulando execução.');
      return;
    }
    
    console.log('[CronScheduler] ⏰ Trigger: 07:30 seg-sex');
    
    try {
      await runAutomatedCollectionPipeline();
    } catch (error: any) {
      console.error('[CronScheduler] ❌ Erro na execução do cron:', error.message);
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });
  
  console.log('[CronScheduler] ✅ Cron scheduler iniciado (07:30 seg-sex, America/Sao_Paulo)');
}

/**
 * Parar cron scheduler
 */
export function stopCronScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[CronScheduler] ⏹️ Cron scheduler parado');
  }
  if (watchdogTask) {
    watchdogTask.stop();
    watchdogTask = null;
    console.log('[CronWatchdog] ⏹️ Watchdog parado');
  }
}

/**
 * Habilitar cron
 */
export function enableCron() {
  cronEnabled = true;
  cronStatus.enabled = true;
  console.log('[CronScheduler] ✅ Cron habilitado');
}

/**
 * Desabilitar cron
 */
export function disableCron() {
  cronEnabled = false;
  cronStatus.enabled = false;
  console.log('[CronScheduler] ⏸️ Cron desabilitado');
}

/**
 * Obter status do cron
 */
export function getCronStatus(): CronStatus {
  return {
    ...cronStatus,
    nextRun: cronTask && cronEnabled ? 'Próxima execução: 07:30 seg-sex (America/Sao_Paulo)' : null,
  };
}

/**
 * Obter health check do cron com status enriquecido
 * Retorna: enabled, lastRun, lastRunBRT, lastResult (sent/skipped/errors), nextRun, status
 */
export function getCronHealth(): {
  enabled: boolean;
  lastRun: string | null;
  lastRunBRT: string | null;
  lastResult: { sent: number; skipped: number; errors: number } | null;
  nextRun: string | null;
  status: 'ok' | 'warn' | 'error';
  reguaEnabled: boolean;
  allowCronEnable: boolean;
} {
  const s = getCronStatus();

  // Converter lastRun para BRT
  let lastRunBRT: string | null = null;
  if (s.lastRun) {
    try {
      lastRunBRT = new Date(s.lastRun).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium',
      });
    } catch {
      lastRunBRT = s.lastRun;
    }
  }

  // Simplificar lastResult
  let lastResult: { sent: number; skipped: number; errors: number } | null = null;
  if (s.lastResult) {
    lastResult = {
      sent: s.lastResult.totalSent,
      skipped: s.lastResult.totalSkipped,
      errors: s.lastResult.totalFailed,
    };
  }

  // Determinar status geral
  let status: 'ok' | 'warn' | 'error' = 'ok';
  if (!s.enabled) {
    status = 'warn';
  } else if (!s.lastRun) {
    status = 'warn'; // habilitado mas nunca rodou
  } else {
    // Verificar se rodou hoje
    const todayBRT = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const lastRunDate = new Date(s.lastRun).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (todayBRT !== lastRunDate) {
      status = 'warn'; // não rodou hoje
    } else if (lastResult && lastResult.errors > 0) {
      status = 'warn'; // rodou mas com erros
    }
  }

  return {
    enabled: s.enabled,
    lastRun: s.lastRun,
    lastRunBRT,
    lastResult,
    nextRun: s.nextRun,
    status,
    reguaEnabled: process.env.REGUA_ENABLED !== 'false',
    allowCronEnable: process.env.ALLOW_CRON_ENABLE === 'true',
  };
}

// ─── ALERTA AUTOMÁTICO 08:00 BRT ───────────────────────────────────────────────

/**
 * Enviar alerta WhatsApp quando o cron não rodou no dia
 */
async function sendCronAlertWhatsApp(message: string): Promise<void> {
  const phone = process.env.CONTADOR_PHONE;
  if (!phone) {
    console.warn('[CronAlert] ⚠️ CONTADOR_PHONE não configurado, alerta não enviado');
    return;
  }

  const zapApiUrl = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
  const zapApiKey = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

  if (!zapApiKey) {
    console.warn('[CronAlert] ⚠️ ZAP_CONTABIL_API_KEY não configurada, alerta não enviado');
    return;
  }

  try {
    const phoneDigits = phone.replace(/\D/g, '');
    const axios = (await import('axios')).default;
    await axios.post(
      `${zapApiUrl}/api/send/${phoneDigits}`,
      { body: message, connectionFrom: 0 },
      {
        headers: { Authorization: `Bearer ${zapApiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    console.log(`[CronAlert] ✅ Alerta enviado para ${phoneDigits}`);
  } catch (err: any) {
    console.error(`[CronAlert] ❌ Falha ao enviar alerta: ${err.message}`);
  }
}

/**
 * Verificar se o cron rodou hoje e alertar se não rodou
 * Chamado pelo cron de 08:00 BRT
 */
export async function checkAndAlertCronHealth(): Promise<void> {
  const health = getCronHealth();
  const todayBRT = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (!health.enabled) {
    const msg = `⚠️ Régua automática DESABILITADA (08:00 BRT ${todayBRT}).\nVerifique ALLOW_CRON_ENABLE no painel.`;
    console.warn('[CronAlert]', msg);
    await sendCronAlertWhatsApp(msg);
    return;
  }

  if (!health.lastRun) {
    const msg = `⚠️ Régua automática NÃO rodou hoje (${todayBRT}).\nMotivo: nenhuma execução registrada.\nVerifique o sistema.`;
    console.warn('[CronAlert]', msg);
    await sendCronAlertWhatsApp(msg);
    return;
  }

  const lastRunDate = new Date(health.lastRun).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (lastRunDate !== todayBRT) {
    const msg = `⚠️ Régua automática NÃO rodou hoje (${todayBRT}).\nÚltima execução: ${health.lastRunBRT || health.lastRun}.\nVerifique o sistema.`;
    console.warn('[CronAlert]', msg);
    await sendCronAlertWhatsApp(msg);
    return;
  }

  console.log(`[CronAlert] ✅ Cron rodou hoje (${health.lastRunBRT}). Nenhum alerta necessário.`);
}

/**
 * Catch-up: Se o servidor reiniciou após 07:30 e o cron não rodou hoje, executar agora.
 * Agora usa o BANCO como fonte de verdade (não memória).
 * Chamado no startup do servidor.
 */
export async function runCatchUpIfNeeded(): Promise<void> {
  const hourBRT = parseInt(
    new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }),
    10
  );
  
  // Só rodar catch-up se for depois das 07:30 (hora >= 8)
  if (hourBRT < 8) {
    console.log('[CronCatchUp] ⏭️ Servidor iniciou antes das 08:00 BRT, pulando catch-up');
    return;
  }
  
  // Verificar no BANCO se o cron já rodou hoje (não depende de memória)
  const ranToday = await didCronRunToday();
  
  if (ranToday) {
    console.log('[CronCatchUp] ✅ Cron já rodou hoje (confirmado no banco), nenhum catch-up necessário');
    return;
  }
  
  // Cron não rodou hoje e servidor iniciou após 07:30 → executar catch-up
  console.log('[CronCatchUp] 🔄 Cron não rodou hoje (banco confirma) → executando catch-up...');
  try {
    await runAutomatedCollectionPipeline(false); // respeita quiet hours
    console.log('[CronCatchUp] ✅ Catch-up executado com sucesso');
  } catch (error: any) {
    console.error('[CronCatchUp] ❌ Erro ao executar catch-up:', error.message);
  }
}

/**
 * CronWatchdog — Vigilante periódico (07:00-09:00 BRT, a cada hora, seg-sex)
 * 
 * Resolve o problema de hibernação do sandbox:
 * quando o processo não reinicia mas as variáveis em memória são zeradas,
 * o watchdog detecta que o cron não rodou e executa automaticamente.
 * 
 * Usa o BANCO como fonte de verdade para verificar se rodou hoje.
 */
export function startCronWatchdog(): void {
  if (watchdogTask) {
    console.log('[CronWatchdog] ⚠️ Watchdog já está rodando');
    return;
  }

  // Roda a cada hora entre 07:00 e 09:00 BRT, seg-sex
  // "0 0 7-9 * * 1-5" = às 07:00, 08:00 e 09:00 BRT, seg-sex
  watchdogTask = cron.schedule('0 0 7-9 * * 1-5', async () => {
    if (!cronEnabled) {
      console.log('[CronWatchdog] ⏸️ Cron desabilitado, watchdog pulando verificação');
      return;
    }

    const hourBRT = parseInt(
      new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }),
      10
    );

    // Só verificar a partir das 08:00 (dar tempo para o cron de 07:30 rodar)
    if (hourBRT < 8) {
      console.log('[CronWatchdog] ⏭️ Ainda são 07:xx BRT, aguardando cron das 07:30...');
      return;
    }

    try {
      const ranToday = await didCronRunToday();

      if (ranToday) {
        console.log('[CronWatchdog] ✅ Cron já rodou hoje, nenhuma ação necessária');
        return;
      }

      const timeBRT = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      console.log(`[CronWatchdog] ⚠️ Cron NÃO rodou hoje (${hourBRT}:00 BRT) — executando catch-up automático...`);
      await runAutomatedCollectionPipeline(false);
      console.log('[CronWatchdog] ✅ Catch-up executado com sucesso');

      // Obter resultado do banco para incluir no alerta
      const stateAfter = await loadCronStateFromDb();
      const r = stateAfter.lastResult;
      const sent = r?.totalSent ?? 0;
      const skipped = r?.totalSkipped ?? 0;
      const errors = r?.totalFailed ?? 0;

      // Enviar alerta WhatsApp informando o catch-up
      const alertMsg =
        `⚠️ *CronWatchdog — Catch-up automático*\n\n` +
        `A régua não disparou no horário programado.\n` +
        `✅ Executada automaticamente às ${timeBRT} BRT\n` +
        `📊 Resultado: ${sent} enviadas, ${skipped} puladas, ${errors} erros`;
      await sendCronAlertWhatsApp(alertMsg);

    } catch (err: any) {
      console.error('[CronWatchdog] ❌ Erro no watchdog:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[CronWatchdog] ✅ Watchdog iniciado (07:00-09:00 BRT, a cada hora, seg-sex)');
}

/**
 * Inicializar cron de alerta (08:00 BRT, seg-sex)
 * Verifica se o cron de 07:30 rodou e alerta se não
 */
export function startAlertScheduler(): void {
  cron.schedule('0 0 8 * * 1-5', async () => {
    console.log('[CronAlert] ⏰ Verificando saúde do cron (08:00 BRT)...');
    await checkAndAlertCronHealth();
  }, { timezone: 'America/Sao_Paulo' });
  console.log('[CronAlert] ✅ Alerta scheduler iniciado (08:00 BRT, seg-sex)');
}

/**
 * Executar pipeline manualmente (para testes)
 * 
 * @param ignoreQuietHours - Se true, ignora verificação de quiet hours (mas respeita safeguards)
 */
export async function runPipelineManually(ignoreQuietHours: boolean = false) {
  console.log(`[CronScheduler] 🔧 Execução manual do pipeline CONSOLIDADO (ignoreQuietHours=${ignoreQuietHours})...`);
  await runAutomatedCollectionPipeline(ignoreQuietHours);
}
