/**
 * cronStateDb.ts
 * 
 * Persistência do estado do cron de cobrança no banco de dados.
 * Garante que o lastRun sobreviva a hibernações do sandbox
 * onde variáveis em memória são zeradas sem reiniciar o processo.
 */

import { getDb } from '../db';
import { cronState } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

const CRON_KEY = 'collection_daily';

export interface CronStateRecord {
  lastRunAt: Date | null;
  lastResult: {
    totalSent: number;
    totalSkipped: number;
    totalFailed: number;
    bucketBreakdown?: Record<string, { sent: number; skipped: number; failed: number }>;
  } | null;
  lastStatus: 'success' | 'partial' | 'failed' | 'skipped' | null;
}

/**
 * Carregar estado do cron do banco de dados
 */
export async function loadCronStateFromDb(): Promise<CronStateRecord> {
  try {
    const db = await getDb();
    if (!db) return { lastRunAt: null, lastResult: null, lastStatus: null };
    
    const rows = await db.select().from(cronState).where(eq(cronState.cronKey, CRON_KEY)).limit(1);
    if (rows.length === 0) {
      return { lastRunAt: null, lastResult: null, lastStatus: null };
    }
    const row = rows[0];
    let lastResult = null;
    if (row.lastResult) {
      try { lastResult = JSON.parse(row.lastResult); } catch {}
    }
    return {
      lastRunAt: row.lastRunAt ?? null,
      lastResult,
      lastStatus: row.lastStatus ?? null,
    };
  } catch (err: any) {
    console.error('[CronStateDb] ❌ Erro ao carregar estado:', err.message);
    return { lastRunAt: null, lastResult: null, lastStatus: null };
  }
}

/**
 * Salvar estado do cron no banco de dados (upsert)
 */
export async function saveCronStateToDb(
  lastRunAt: Date,
  lastResult: CronStateRecord['lastResult'],
  lastStatus: 'success' | 'partial' | 'failed' | 'skipped'
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn('[CronStateDb] ⚠️ DB indisponível, estado não persistido');
      return;
    }
    
    const lastResultJson = lastResult ? JSON.stringify(lastResult) : null;
    
    // Tentar update primeiro
    const existing = await db.select({ id: cronState.id })
      .from(cronState)
      .where(eq(cronState.cronKey, CRON_KEY))
      .limit(1);
    
    if (existing.length > 0) {
      await db.update(cronState)
        .set({ lastRunAt, lastResult: lastResultJson, lastStatus })
        .where(eq(cronState.cronKey, CRON_KEY));
    } else {
      await db.insert(cronState).values({
        cronKey: CRON_KEY,
        lastRunAt,
        lastResult: lastResultJson,
        lastStatus,
      });
    }
    
    console.log(`[CronStateDb] ✅ Estado salvo: lastRunAt=${lastRunAt.toISOString()}, status=${lastStatus}`);
  } catch (err: any) {
    console.error('[CronStateDb] ❌ Erro ao salvar estado:', err.message);
    // Não lançar erro — falha na persistência não deve abortar o cron
  }
}

/**
 * Verificar se o cron rodou hoje (usando banco de dados como fonte de verdade)
 */
export async function didCronRunToday(): Promise<boolean> {
  const state = await loadCronStateFromDb();
  if (!state.lastRunAt) return false;
  
  const todayBRT = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lastRunBRT = state.lastRunAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  
  return todayBRT === lastRunBRT;
}
