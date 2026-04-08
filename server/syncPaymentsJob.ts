/**
 * 🔄 Job de Sincronização de Pagamentos (Conta Azul)
 *
 * Estratégia incremental:
 * - Busca apenas receivables locais com vencimento nos últimos N dias (padrão: 60)
 * - Faz lookup individual por ID no CA (endpoint /buscar com filtro de data)
 * - Atualiza status local para 'paid' ou 'cancelled' quando detectar quitação
 * - Rate-limit: processa em lotes de 20 com pausa entre lotes
 *
 * Endpoint:
 * GET https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber/buscar
 *
 * Params:
 * - pagina, tamanho_pagina
 * - data_vencimento_de, data_vencimento_ate
 */

import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { and, eq, or, gte, lte } from 'drizzle-orm';

type CAContaReceberItem = {
  id: string;
  status?: string; // ex: ACQUITTED, OPEN, OVERDUE, etc
  status_traduzido?: string;
  data_vencimento?: string;
  total?: number;
  valor?: number;
  nao_pago?: number;
  pago?: number;
  cliente?: {
    id?: string | null;
    nome?: string | null;
  };
};

export type SyncPaymentsResult = {
  success: boolean;
  checkedLocal: number;
  resolvedCount: number;
  updatedCount: number;
  pagesFetched: number;
  durationMs: number;
  timestamp: string;
  error?: string;
  windowDays?: number;
};

function isPaidStatus(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).toLowerCase().trim();
  if (s === 'acquitted') return true;
  if (s === 'paid' || s === 'paga' || s === 'quitada' || s === 'recebido') return true;
  if (s.includes('quit') || s.includes('paid') || s.includes('recebid')) return true;
  return false;
}

function isLostOrCancelledStatus(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).toLowerCase().trim();
  return s === 'lost' || s === 'cancelled' || s === 'cancelado' || s === 'perdido';
}

function normalizeBaseUrl(input?: string): string {
  let base = input || 'https://api-v2.contaazul.com';
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/v1\/?$/, '');
  return base;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executa o sync incremental de pagamentos.
 * @param windowDays - Quantos dias para trás buscar (padrão: 360)
 * Janela de 360 dias cobre toda a carteira inadimplente (buckets A-D + histórico anual).
 */
export async function syncPaymentsJob(windowDays = 360): Promise<SyncPaymentsResult> {
  const startedAt = Date.now();

  try {
    console.log(`[SyncPaymentsJob] Iniciando (janela: ${windowDays} dias)...`);

    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();
    if (!token) throw new Error('No OAuth token (getValidAccessToken retornou vazio)');

    const axios = (await import('axios')).default;
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 1) Selecionar receivables locais candidatos
    //    - status pending ou overdue
    //    - source = conta-azul
    //    - vencimento nos últimos windowDays dias (para limitar o scope)
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    const local = await db
      .select()
      .from(receivables)
      .where(
        and(
          or(eq(receivables.status, 'pending'), eq(receivables.status, 'overdue')),
          eq(receivables.source, 'conta-azul' as any),
          gte(receivables.dueDate, windowStart),
        )
      );

    const localWithId = local.filter(r => !!r.contaAzulId);

    console.log('[SyncPaymentsJob] Receivables candidatos:', {
      totalLocal: local.length,
      withContaAzulId: localWithId.length,
      windowStart: windowStart.toISOString().split('T')[0],
    });

    if (localWithId.length === 0) {
      return {
        success: true,
        checkedLocal: 0,
        resolvedCount: 0,
        updatedCount: 0,
        pagesFetched: 0,
        windowDays,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      };
    }

    // 2) Buscar do Conta Azul com dois passes para capturar pagamentos recentes:
    // Pass 1: Títulos vencidos nos últimos windowDays
    // Pass 2: Títulos com vencimento nos próximos 30 dias (para encontrar pending que foram pagos)
    const baseUrl = normalizeBaseUrl(process.env.CONTA_AZUL_API_BASE);
    const path = '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar';
    const url = `${baseUrl}${path}`;

    // Pass 1: últimos windowDays (para cobrir overdue)
    const fromDate = windowStart.toISOString().split('T')[0];
    const toDate = new Date().toISOString().split('T')[0];

    const pageSize = 100;
    const maxPages = 50; // 50 páginas x 100 itens = 5000 registros (cobre 360 dias)
    const timeoutMs = 15000;

    const caMap = new Map<string, CAContaReceberItem>();
    let pagesFetched = 0;

    for (let page = 1; page <= maxPages; page++) {
      try {
        const resp = await axios.get(url, {
          params: {
            pagina: page,
            tamanho_pagina: pageSize,
            data_vencimento_de: fromDate,
            data_vencimento_ate: toDate,
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        });

        const items: CAContaReceberItem[] = resp.data?.itens || [];
        pagesFetched++;

        console.log(`[SyncPaymentsJob] Página ${page}: ${items.length} itens (CA)`);

        if (!items.length) break;

        for (const it of items) {
          if (it?.id) caMap.set(String(it.id), it);
        }

        if (items.length < pageSize) break;

        // Pausa entre páginas para não sobrecarregar a API
        await sleep(500);
      } catch (pageErr: any) {
        console.warn(`[SyncPaymentsJob] Erro na página ${page}:`, pageErr?.message);
        // Se timeout na primeira página, abortar; senão continuar
        if (page === 1) throw pageErr;
        break;
      }
    }

    console.log(`[SyncPaymentsJob] CA map: ${caMap.size} itens únicos`);

    // 3) Comparar e atualizar local
    let checkedLocal = 0;
    let resolvedCount = 0;
    let updatedCount = 0;

    for (const r of localWithId) {
      checkedLocal++;
      const ca = caMap.get(String(r.contaAzulId));

      if (!ca) {
        // ID não encontrado na janela — pode ser que o título seja de fora da janela
        // Não fazer nada, apenas logar em debug
        continue;
      }

      const paid = isPaidStatus(ca.status);
      const lost = isLostOrCancelledStatus(ca.status);

      if (!paid && !lost) continue;

      resolvedCount++;

      const newStatus = paid ? 'paid' : 'cancelled';

      if (r.status !== newStatus) {
        const paidDate = paid ? new Date() : null;

        await db
          .update(receivables)
          .set({
            status: newStatus as any,
            paidDate: paidDate,
            updatedAt: new Date(),
          })
          .where(eq(receivables.id, r.id));

        updatedCount++;
        console.log(`[SyncPaymentsJob] ✅ Marcado como ${newStatus}:`, {
          receivableId: r.id,
          contaAzulId: r.contaAzulId,
          caStatus: ca.status,
          caStatusTraduzido: ca.status_traduzido,
          clienteNome: ca.cliente?.nome,
          pago: ca.pago,
          total: ca.total,
        });
      }
    }

    const result = {
      success: true,
      checkedLocal,
      resolvedCount,
      updatedCount,
      pagesFetched,
      windowDays,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };

    console.log('[SyncPaymentsJob] Concluído:', result);
    return result;
  } catch (error: any) {
    console.error('[SyncPaymentsJob] Erro fatal:', error?.message || error);
    return {
      success: false,
      error: error?.message || 'Erro desconhecido',
      checkedLocal: 0,
      resolvedCount: 0,
      updatedCount: 0,
      pagesFetched: 0,
      windowDays,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Iniciar job recorrente
 * - dev: a cada 10 min
 * - prod: a cada 1h (mas o cron principal roda às 06:50 via index.ts)
 */
export function startSyncPaymentsJob() {
  const interval =
    process.env.NODE_ENV === 'development'
      ? 10 * 60 * 1000
      : 60 * 60 * 1000;

  console.log(`[SyncPaymentsJob] Iniciando job recorrente (intervalo: ${interval / 1000}s)`);

  // IMPORTANTE: Executar primeira vez de forma ASSINCRONA (nao-bloqueante)
  // para nao bloquear o health check em producao
  setImmediate(() => {
    console.log('[SyncPaymentsJob] Executando primeira sincronizacao em background...');
    syncPaymentsJob(360).catch((err: any) => {
      console.error('[SyncPaymentsJob] Erro na primeira sincronizacao:', err.message);
    });
  });

  // executar recorrente
  const handle = setInterval(() => {
    syncPaymentsJob(360);
  }, interval);

  return handle;
}

/**
 * Parar job recorrente
 */
export function stopSyncPaymentsJob(handle: any) {
  if (handle) clearInterval(handle);
}
