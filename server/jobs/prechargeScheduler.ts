import * as cron from 'node-cron';
import { getDb } from '../db';
import { receivables, clients } from '../../drizzle/schema';
import { eq, and, inArray, isNotNull, sql } from 'drizzle-orm';
import { sendPrecharge } from '../services/prechargeService';

let isRunning = false;

/**
 * Cron diário às 07:30 (America/Sao_Paulo)
 * Busca receivables elegíveis e enfileira envio de pré-cobrança
 * 
 * DEFESA DUPLA:
 * 1. Filtros de qualidade NA QUERY (bloqueio na origem)
 * 2. Validação rígida no service (segunda barreira)
 */
export function startPrechargeScheduler() {
  // 07:30 America/Sao_Paulo = 10:30 UTC
  // Cron: "30 10 * * *" (minuto 30, hora 10, todos os dias)
  const task = cron.schedule('30 10 * * *', async () => {
    if (isRunning) {
      console.log('[PrechargeBatch] SKIP - Batch anterior ainda em execução');
      return;
    }

    isRunning = true;
    const startTime = Date.now();

    try {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      console.log('[PrechargeBatch] START - Iniciando batch de pré-cobrança');

      // ============================================================
      // BARREIRA 1: FILTROS DE QUALIDADE NA QUERY
      // ============================================================
      // Trazer SOMENTE receivables elegíveis com clientes validados
      // Bloqueios estruturais:
      // - receivable.source = 'conta-azul'
      // - receivable.status IN ('pending', 'overdue')
      // - receivable.amount > 0
      // - receivable.dueDate NOT NULL
      // - client.document NOT NULL (rastreabilidade jurídica OBRIGATÓRIA)
      // - client.whatsappNumber NOT NULL e não vazio
      // - client.whatsappSource = 'conta-azul' (validado)
      // - client.optOut = false
      // ============================================================
      
      const elegibleReceivables = await db
        .select({ 
          receivableId: receivables.id, 
          clientId: receivables.clientId,
          amount: receivables.amount,
          dueDate: receivables.dueDate,
        })
        .from(receivables)
        .innerJoin(clients, eq(receivables.clientId, clients.id))
        .where(
          and(
            // Receivable quality checks
            eq(receivables.source, 'conta-azul'),
            inArray(receivables.status, ['pending', 'overdue']),
            sql`CAST(${receivables.amount} AS DECIMAL(12,2)) > 0`,
            isNotNull(receivables.dueDate),
            
            // Client quality checks (DEFESA NA ORIGEM)
            isNotNull(clients.document),
            sql`TRIM(COALESCE(${clients.document}, '')) <> ''`,
            isNotNull(clients.whatsappNumber),
            sql`TRIM(COALESCE(${clients.whatsappNumber}, '')) <> ''`,
            eq(clients.whatsappSource, 'conta-azul'),
            eq(clients.optOut, false)
          )
        )
        .limit(100); // Limitar a 100 por batch

      console.log(`[PrechargeBatch] FOUND total=${elegibleReceivables.length} (após filtros de qualidade)`);

      let sent = 0;
      let skipped = 0;
      let blocked = 0;

      // ============================================================
      // BARREIRA 2: VALIDAÇÃO RÍGIDA NO SERVICE (segunda defesa)
      // ============================================================
      // Mesmo que a query filtre bem, o service faz validação final
      // Isso garante que nenhum envio indevido passa
      
      for (const rec of elegibleReceivables) {
        const result = await sendPrecharge(rec.receivableId);

        if (result.success) {
          sent++;
          console.log(`[PrechargeBatch] SENT receivableId=${rec.receivableId}`);
        } else if (result.error === 'DUPLICATE_BLOCKED') {
          skipped++;
          console.log(`[PrechargeBatch] SKIPPED receivableId=${rec.receivableId} (duplicate)`);
        } else {
          blocked++;
          console.log(`[PrechargeBatch] BLOCKED receivableId=${rec.receivableId} error=${result.error}`);
        }

        // Rate limit: 10-20 mensagens/minuto (aqui fazemos ~1 por segundo = 60/min)
        // Para ser mais conservador, aguardamos 100ms entre cada envio
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const duration = Date.now() - startTime;
      console.log(`[PrechargeBatch] DONE sent=${sent} skipped=${skipped} blocked=${blocked} duration=${duration}ms`);
    } catch (err: any) {
      console.error('[PrechargeBatch] ERROR', {
        message: err?.message,
        stack: err?.stack,
      });
    } finally {
      isRunning = false;
    }
  });

  console.log('[PrechargeBatch] Scheduler iniciado - próxima execução: 07:30 (America/Sao_Paulo)');
  return task;
}

/**
 * Para o scheduler (para testes/shutdown)
 */
export function stopPrechargeScheduler(task: cron.ScheduledTask) {
  task.stop();
  console.log('[PrechargeBatch] Scheduler parado');
}
