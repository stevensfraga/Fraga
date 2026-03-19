/**
 * 🤖 Automated Collection Job
 * Executa diariamente 07:30 (horário de Brasília)
 * Sincroniza receivables e enfileira cobrança automática
 */

import { CronJob } from 'cron';
import axios from 'axios';
import { getDb } from './db';
import { receivables, collectionMessages } from '../drizzle/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';

interface CollectionLog {
  timestamp: string;
  action: string;
  status: 'success' | 'error' | 'skipped';
  details: any;
}

const logs: CollectionLog[] = [];

function log(action: string, status: 'success' | 'error' | 'skipped', details: any = {}) {
  const entry: CollectionLog = {
    timestamp: new Date().toISOString(),
    action,
    status,
    details,
  };
  logs.push(entry);
  console.log(`[Collection] ${action} [${status}]`, details);
}

/**
 * Verificar quiet hours (respeitar horário comercial)
 * Envios apenas entre 08:00 e 18:00 de seg-sex
 */
function isWithinQuietHours(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = domingo, 1 = segunda, etc.

  // Fora do horário comercial (08:00-18:00)
  if (hour < 8 || hour >= 18) {
    log('quiet_hours_check', 'skipped', { reason: 'Outside business hours', hour });
    return false;
  }

  // Fim de semana
  if (day === 0 || day === 6) {
    log('quiet_hours_check', 'skipped', { reason: 'Weekend', day });
    return false;
  }

  return true;
}

/**
 * Sincronizar receivables do Conta Azul
 */
async function syncReceivables(): Promise<{ fetched: number; inserted: number; updated: number }> {
  try {
    const baseUrl = 'http://localhost:3000';
    const testToken = process.env.TEST_DISPATCH_TOKEN;

    if (!testToken) {
      log('sync_receivables', 'error', { reason: 'TEST_DISPATCH_TOKEN not found' });
      return { fetched: 0, inserted: 0, updated: 0 };
    }

    const response = await axios.post(
      `${baseUrl}/api/test/sync-receivables-conta-azul?page=1&pageSize=50&maxPages=2`,
      {},
      {
        headers: { Authorization: `Bearer ${testToken}` },
        timeout: 60000,
      }
    );

    const { fetched = 0, inserted = 0, updated = 0, errors = [] } = response.data;

    if (errors.length > 0) {
      log('sync_receivables', 'error', { fetched, inserted, updated, errors: errors.slice(0, 5) });
    } else {
      log('sync_receivables', 'success', { fetched, inserted, updated });
    }

    return { fetched, inserted, updated };
  } catch (error: any) {
    log('sync_receivables', 'error', { message: error.message });
    return { fetched: 0, inserted: 0, updated: 0 };
  }
}

/**
 * Obter candidatos elegíveis para cobrança
 */
async function getCandidates(): Promise<any[]> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Buscar receivables pendentes/vencidos
    const candidates = await db
      .select({
        id: receivables.id,
        contaAzulId: receivables.contaAzulId,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        status: receivables.status,
        link: receivables.link,
        linhaDigitavel: receivables.linhaDigitavel,
      })
      .from(receivables)
      .where(
        and(
          eq(receivables.source, 'conta-azul'),
          eq(receivables.status, 'overdue') // Rodar somente inadimplentes
        )
      )
      .limit(50);

    // Filtrar: ignorar já enviados
    const db2 = await getDb();
    if (!db2) throw new Error('Database not available');

    const alreadySent = await db2
      .select({ receivableId: collectionMessages.receivableId })
      .from(collectionMessages)
      .where(eq(collectionMessages.status, 'sent'));

    const sentIds = new Set(alreadySent.map(m => m.receivableId));
    const filtered = candidates.filter(c => !sentIds.has(c.id));

    log('get_candidates', 'success', { total: candidates.length, filtered: filtered.length });
    return filtered;
  } catch (error: any) {
    log('get_candidates', 'error', { message: error.message });
    return [];
  }
}

/**
 * Gerar link público para candidato (fallback)
 */
async function generatePublicLink(candidateId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const apiUrl = process.env.VITE_FRONTEND_FORGE_API_URL || 'http://localhost:3000';
    const publicLink = `${apiUrl}/boleto/${candidateId}`;

    // Atualizar link no DB
    await db
      .update(receivables)
      .set({ link: publicLink })
      .where(eq(receivables.id, candidateId));

    log('generate_public_link', 'success', {
      receivableId: candidateId,
      link: publicLink,
    });
    return true;
  } catch (error: any) {
    log('generate_public_link', 'error', {
      receivableId: candidateId,
      message: error.message,
    });
    return false;
  }
}

/**
 * Enfileirar envio para candidatos
 */
async function queueDispatches(candidates: any[]): Promise<number> {
  let queued = 0;
  let linkGenerated = 0;

  for (const candidate of candidates) {
    try {
      // 1. Gerar link público se não existir
      if (!candidate.link || candidate.link.includes('api-v2.contaazul.com')) {
        const linkSuccess = await generatePublicLink(candidate.id);
        if (linkSuccess) {
          linkGenerated++;
        }
      }

      // 2. Enfileirar envio
      const baseUrl = 'http://localhost:3000';

      const response = await axios.post(
        `${baseUrl}/api/dispatch/send-boleto/${candidate.id}`,
        {},
        { timeout: 15000 }
      );

      if (response.data.success) {
        queued++;
        log('queue_dispatch', 'success', {
          receivableId: candidate.id,
          jobId: response.data.jobId,
        });
      } else {
        log('queue_dispatch', 'skipped', {
          receivableId: candidate.id,
          reason: response.data.error,
          message: response.data.message,
        });
      }
    } catch (error: any) {
      const errorData = error.response?.data || {};
      log('queue_dispatch', 'error', {
        receivableId: candidate.id,
        status: error.response?.status,
        reason: errorData.error || error.message,
        message: errorData.message,
      });
    }
  }

  log('queue_dispatch_summary', 'success', { linkGenerated, queued, total: candidates.length });
  return queued;
}

/**
 * Executar ciclo completo de cobrança
 */
async function executeCollectionCycle(skipQuietHours: boolean = false) {
  console.log('\n========================================');
  console.log('🤖 AUTOMATED COLLECTION CYCLE STARTED');
  console.log('========================================\n');

  logs.length = 0; // Limpar logs anteriores

  // 1. Verificar quiet hours (exceto se skipQuietHours=true)
  if (!skipQuietHours && !isWithinQuietHours()) {
    console.log('⏸️  Skipped: Outside business hours');
    return;
  }

  // 2. Sincronizar receivables
  const syncResult = await syncReceivables();

  // 3. Obter candidatos
  const candidates = await getCandidates();

  // 4. Enfileirar envios (com enriquecimento automático)
  const queued = await queueDispatches(candidates);

  // 5. Resumo
  console.log('\n========================================');
  console.log('✅ COLLECTION CYCLE COMPLETED');
  console.log('========================================');
  console.log(`Synced: ${syncResult.fetched} receivables`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Queued: ${queued} dispatches`);
  console.log(`\nDetailed Logs:`);
  logs.forEach(l => {
    console.log(`  [${l.timestamp}] ${l.action} [${l.status}]`, l.details);
  });
  console.log('========================================\n');
}

/**
 * Inicializar cron job
 * Executa diariamente às 07:30 (horário de Brasília = UTC-3)
 */
export function initializeCollectionCron() {
  try {
    // Cron: 30 07 * * * (07:30 todos os dias)
    // Timezone: America/Sao_Paulo (Brasília)
    const job = new CronJob(
      '30 07 * * *',
      executeCollectionCycle,
      null,
      true,
      'America/Sao_Paulo'
    );

    console.log('[Collection] Cron job initialized: 07:30 daily (São Paulo timezone)');
    return job;
  } catch (error: any) {
    console.error('[Collection] Failed to initialize cron job:', error.message);
    return null;
  }
}

/**
 * Endpoint para testar execução manual
 * GET /api/test/run-collection-cycle?skipQuietHours=true
 */
export async function testCollectionCycle(req: any, res: any) {
  try {
    const skipQuietHours = req.query.skipQuietHours === 'true';
    await executeCollectionCycle(skipQuietHours);
    return res.json({
      success: true,
      message: 'Collection cycle executed',
      logs,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
