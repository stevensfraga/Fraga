import * as cron from 'node-cron';
import { getDb } from '../db';
import { receivables } from '../../drizzle/schema';
import { eq, and, inArray, isNull, isNotNull } from 'drizzle-orm';
import { getValidAccessToken } from '../contaAzulOAuthManager';

const API_V2_BASE = 'https://api-v2.contaazul.com';
const BATCH_SIZE = 20;

let isRunning = false;

/**
 * Busca detalhes da parcela na API Conta Azul e extrai o link de pagamento.
 * Endpoint: GET /v1/financeiro/eventos-financeiros/parcelas/{uuid}
 * Fonte do link: detail.solicitacoes_cobrancas[].url
 */
async function fetchPaymentLink(contaAzulId: string, token: string): Promise<string | null> {
  const url = `${API_V2_BASE}/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(contaAzulId)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status} para parcela ${contaAzulId}`);
  }

  const data: any = await res.json();

  // Link principal: primeira solicitação de cobrança com URL
  if (Array.isArray(data.solicitacoes_cobrancas)) {
    const cobranca = data.solicitacoes_cobrancas.find((sc: any) => sc.url);
    if (cobranca?.url) return cobranca.url;
  }

  // Fallback: campos alternativos
  return data.share_url || data.url || data.payment_url || null;
}

/**
 * Cron a cada 10 minutos.
 * Processa até 20 recebíveis pendentes/vencidos sem paymentLinkCanonical por execução.
 */
export function startFetchPaymentLinksJob(): cron.ScheduledTask {
  const task = cron.schedule('*/10 * * * *', async () => {
    if (isRunning) {
      console.log('[FetchPaymentLinks] SKIP - execução anterior ainda em andamento');
      return;
    }

    isRunning = true;
    const startTime = Date.now();

    try {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Buscar recebíveis pendentes/vencidos sem paymentLinkCanonical e com contaAzulId
      const pending = await db
        .select({
          id: receivables.id,
          contaAzulId: receivables.contaAzulId,
        })
        .from(receivables)
        .where(
          and(
            inArray(receivables.status, ['pending', 'overdue']),
            isNull(receivables.paymentLinkCanonical),
            isNotNull(receivables.contaAzulId),
          )
        )
        .limit(BATCH_SIZE);

      if (pending.length === 0) {
        console.log('[FetchPaymentLinks] Nenhum recebível pendente sem paymentLinkCanonical');
        return;
      }

      console.log(`[FetchPaymentLinks] START - processando ${pending.length} recebíveis`);

      let token: string;
      try {
        token = await getValidAccessToken();
      } catch (err: any) {
        console.error('[FetchPaymentLinks] Falha ao obter token OAuth:', err?.message);
        return;
      }

      let updated = 0;
      let notFound = 0;
      let errors = 0;

      for (const rec of pending) {
        if (!rec.contaAzulId) continue;

        try {
          const link = await fetchPaymentLink(rec.contaAzulId, token);

          if (link) {
            await db
              .update(receivables)
              .set({
                paymentLinkCanonical: link,
                paymentInfoSource: 'contaazul',
                paymentInfoPublic: true,
                paymentInfoUpdatedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(receivables.id, rec.id));

            updated++;
            console.log(`[FetchPaymentLinks] ✅ receivableId=${rec.id} link salvo`);
          } else {
            notFound++;
            console.log(`[FetchPaymentLinks] ⚠️ receivableId=${rec.id} contaAzulId=${rec.contaAzulId} sem link`);
          }
        } catch (err: any) {
          errors++;
          console.error(`[FetchPaymentLinks] ❌ receivableId=${rec.id} erro: ${err?.message}`);
        }

        // Rate limiting: evitar sobrecarga na API
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const duration = Date.now() - startTime;
      console.log(`[FetchPaymentLinks] DONE updated=${updated} notFound=${notFound} errors=${errors} duration=${duration}ms`);
    } catch (err: any) {
      console.error('[FetchPaymentLinks] ERROR', {
        message: err?.message,
        stack: err?.stack,
      });
    } finally {
      isRunning = false;
    }
  });

  console.log('[FetchPaymentLinks] Job iniciado - executa a cada 10 minutos');
  return task;
}

export function stopFetchPaymentLinksJob(task: cron.ScheduledTask): void {
  task.stop();
  console.log('[FetchPaymentLinks] Job parado');
}
