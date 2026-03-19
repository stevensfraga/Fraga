/**
 * Régua de Cobrança — Job (Cron)
 *
 * Executa a régua de cobrança automaticamente em horário configurado.
 * Padrão: 09:00 e 14:00, segunda a sexta.
 *
 * Env vars:
 *   REGUA_CRON_SCHEDULE=0 9,14 * * 1-5   (padrão)
 *   ALLOW_CRON_ENABLE=true
 *   REGUA_ENABLED=true
 */

import { runRegua } from '../services/reguaCobrancaService';
import { syncPaymentsJob } from '../syncPaymentsJob';

let cronJob: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

const ALLOW_CRON = process.env.ALLOW_CRON_ENABLE === 'true';

// Função para ler REGUA_ENABLED em tempo real (não é constante)
function isReguaEnabled() {
  return process.env.REGUA_ENABLED !== 'false';
}

/**
 * Executar a régua manualmente (chamado pelo router ou cron)
 */
export async function executeReguaJob(dryRun: boolean = false): Promise<void> {
  if (isRunning) {
    console.log('[ReguaJob] ⚠️ Régua já em execução, ignorando nova chamada');
    return;
  }

  isRunning = true;
  console.log(`[ReguaJob] 🚀 Iniciando execução | dryRun=${dryRun}`);

  try {
    const result = await runRegua(dryRun);
    console.log(`[ReguaJob] ✅ Concluído: ${result.sent} enviados | ${result.skipped} pulados | ${result.errors} erros`);
  } catch (error: any) {
    console.error('[ReguaJob] ❌ Erro na execução:', error.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Verificar se é hora de executar a régua (09:00 ou 14:00, seg-sex, horário de Brasília)
 */
function shouldRunNow(): boolean {
  const now = new Date();
  const brStr = now.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Extrair dia da semana e hora
  const dayOfWeek = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' });
  const timeStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const [h, m] = timeStr.split(':').map(Number);

  // Verificar se é dia útil (segunda a sexta)
  const weekday = now.toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
  const isWeekday = !['Sat', 'Sun'].includes(weekday);

  if (!isWeekday) return false;

  // Verificar se é 06:50 (sync), 09:00 ou 14:00 (régua) — tolerância de 1 minuto
  const isReguaTime = (h === 9 && m === 0) || (h === 14 && m === 0);
  const isSyncTime = h === 6 && m === 50;

  return isReguaTime || isSyncTime;
}

/**
 * Inicializar o cron job da régua
 * Verifica a cada minuto se é hora de executar
 */
export function initReguaJob(): void {
  if (!ALLOW_CRON) {
    console.log('[ReguaJob] ℹ️ ALLOW_CRON_ENABLE=false, cron não iniciado');
    return;
  }

  if (!isReguaEnabled()) {
    console.log('[ReguaJob] ℹ️ REGUA_ENABLED=false, cron não iniciado');
    return;
  }

  if (cronJob) {
    console.log('[ReguaJob] ℹ️ Cron já iniciado');
    return;
  }

  console.log('[ReguaJob] ✅ Cron iniciado — verificando a cada minuto (09:00 e 14:00, seg-sex)');

  cronJob = setInterval(async () => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    const timeStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
    const [h, m] = timeStr.split(':').map(Number);

    // 06:50 — sync incremental antes da régua
    if (isWeekday && h === 6 && m === 50) {
      console.log('[ReguaJob] ⏰ 06:50 — Executando sync incremental de pagamentos...');
      try {
        const syncResult = await syncPaymentsJob(60);
        console.log('[ReguaJob] ✅ Sync concluído:', {
          updated: syncResult.updatedCount,
          checked: syncResult.checkedLocal,
          pages: syncResult.pagesFetched,
          durationMs: syncResult.durationMs,
        });
      } catch (err: any) {
        console.error('[ReguaJob] ❌ Erro no sync:', err.message);
      }
    }

    // 09:00 ou 14:00 — régua de cobrança
    if (shouldRunNow()) {
      console.log('[ReguaJob] ⏰ Horário agendado atingido, executando régua...');
      await executeReguaJob(false);
    }
  }, 60 * 1000); // verificar a cada 1 minuto
}

/**
 * Parar o cron job
 */
export function stopReguaJob(): void {
  if (cronJob) {
    clearInterval(cronJob);
    cronJob = null;
    console.log('[ReguaJob] 🛑 Cron parado');
  }
}
