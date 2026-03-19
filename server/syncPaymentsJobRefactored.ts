/**
 * 🔄 Job de Sincronização de Pagamentos Refatorado (Conta Azul)
 *
 * Estratégia incremental com cursor persistido:
 * - Busca títulos alterados recentemente no CA (usando dataAlteracao/updatedAt)
 * - Mantém cursor lastPaymentsSyncAt persistido na tabela sync_cursor
 * - Atualiza DB local sempre que CA retorna status pago/cancelado/renegociado
 * - Full sync semanal 365d apenas para auditoria
 *
 * Fluxo:
 * 1. Ler cursor da última sincronização (payments_lite)
 * 2. Buscar títulos alterados desde então no CA
 * 3. Atualizar DB local com novos status
 * 4. Persistir novo cursor
 * 5. Se falhar, manter cursor anterior (retry na próxima execução)
 */

import { getDb } from './db';
import { receivables, syncCursor } from '../drizzle/schema';
import { and, eq, or, gte, lte } from 'drizzle-orm';

type CAContaReceberItem = {
  id: string;
  status?: string; // ex: ACQUITTED, OPEN, OVERDUE, ATRASADO, etc
  status_traduzido?: string;
  data_alteracao?: string; // Campo de data de alteração
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
  syncType: 'lite' | 'full';
  checkedLocal: number;
  resolvedCount: number;
  updatedCount: number;
  pagesFetched: number;
  durationMs: number;
  timestamp: string;
  cursorBefore?: string;
  cursorAfter?: string;
  error?: string;
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

function isRenegotiatedStatus(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).toLowerCase().trim();
  return s === 'renegotiated' || s === 'renegociado' || s.includes('renegoc');
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
 * Busca o cursor de sincronização do tipo especificado
 */
async function getSyncCursor(db: any, syncType: 'payments_lite' | 'payments_full') {
  const [cursor] = await db
    .select()
    .from(syncCursor)
    .where(eq(syncCursor.syncType, syncType));
  
  return cursor || null;
}

/**
 * Atualiza o cursor de sincronização
 */
async function updateSyncCursor(
  db: any,
  syncType: 'payments_lite' | 'payments_full',
  lastSyncAt: Date,
  status: 'success' | 'partial' | 'failed',
  result?: any
) {
  await db
    .update(syncCursor)
    .set({
      lastSyncAt,
      lastStatus: status,
      lastResult: result ? JSON.stringify(result) : null,
      updatedAt: new Date(),
    })
    .where(eq(syncCursor.syncType, syncType));
}

/**
 * Executa o sync incremental de pagamentos com cursor.
 * @param syncType - 'lite' (últimas 24h) ou 'full' (365 dias)
 */
export async function syncPaymentsJobRefactored(syncType: 'lite' | 'full' = 'lite'): Promise<SyncPaymentsResult> {
  const startedAt = Date.now();
  const cursorType = syncType === 'lite' ? 'payments_lite' : 'payments_full';

  try {
    console.log(`[SyncPaymentsJob] Iniciando (tipo: ${syncType})...`);

    const { getValidAccessToken } = await import('./contaAzulOAuthManager');
    const token = await getValidAccessToken();
    if (!token) throw new Error('No OAuth token (getValidAccessToken retornou vazio)');

    const axios = (await import('axios')).default;
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 1) Ler cursor da última sincronização bem-sucedida
    const cursor = await getSyncCursor(db, cursorType);
    const cursorBefore = cursor?.lastSyncAt?.toISOString() || 'N/A';

    // Janela de busca: desde o último cursor até agora
    const fromDate = cursor?.lastSyncAt || new Date(Date.now() - (syncType === 'lite' ? 24 : 365) * 60 * 60 * 1000);
    const toDate = new Date();

    console.log(`[SyncPaymentsJob] Cursor anterior: ${cursorBefore}`);
    console.log(`[SyncPaymentsJob] Janela: ${fromDate.toISOString().split('T')[0]} até ${toDate.toISOString().split('T')[0]}`);

    // 2) Buscar receivables locais candidatos (todos com status pending/overdue)
    const local = await db
      .select()
      .from(receivables)
      .where(
        and(
          or(eq(receivables.status, 'pending'), eq(receivables.status, 'overdue')),
          eq(receivables.source, 'conta-azul' as any),
        )
      );

    const localWithId = local.filter(r => !!r.contaAzulId);

    console.log('[SyncPaymentsJob] Receivables candidatos:', {
      totalLocal: local.length,
      withContaAzulId: localWithId.length,
    });

    if (localWithId.length === 0) {
      // Atualizar cursor mesmo sem títulos
      await updateSyncCursor(db, cursorType, toDate, 'success', {
        checkedLocal: 0,
        resolvedCount: 0,
        updatedCount: 0,
      });

      return {
        success: true,
        syncType,
        checkedLocal: 0,
        resolvedCount: 0,
        updatedCount: 0,
        pagesFetched: 0,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        cursorBefore,
        cursorAfter: toDate.toISOString(),
      };
    }

    // 3) Buscar do Conta Azul com filtro de data de alteração
    const baseUrl = normalizeBaseUrl(process.env.CONTA_AZUL_API_BASE);
    const path = '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar';
    const url = `${baseUrl}${path}`;

    // Filtro: data_alteracao_de (ou usar data_vencimento como fallback)
    const fromDateStr = fromDate.toISOString().split('T')[0];
    const toDateStr = toDate.toISOString().split('T')[0];

    const pageSize = 100;
    const maxPages = 10; // Aumentado para full sync
    const timeoutMs = 15000;

    const caMap = new Map<string, CAContaReceberItem>();
    let pagesFetched = 0;

    for (let page = 1; page <= maxPages; page++) {
      try {
        // Tentar com data_alteracao_de primeiro (mais preciso para sync incremental)
        const params: any = {
          pagina: page,
          tamanho_pagina: pageSize,
          // Usar data_alteracao se disponível, senão data_vencimento
          data_alteracao_de: fromDateStr,
          data_alteracao_ate: toDateStr,
        };

        const resp = await axios.get(url, {
          params,
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

        await sleep(500);
      } catch (pageErr: any) {
        // Se erro 400 (parâmetro inválido), tentar com data_vencimento como fallback
        if (pageErr?.response?.status === 400 && page === 1) {
          console.warn('[SyncPaymentsJob] data_alteracao não suportado, usando data_vencimento como fallback');
          
          try {
            const resp = await axios.get(url, {
              params: {
                pagina: page,
                tamanho_pagina: pageSize,
                data_vencimento_de: fromDateStr,
                data_vencimento_ate: toDateStr,
              },
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              timeout: timeoutMs,
            });

            const items: CAContaReceberItem[] = resp.data?.itens || [];
            pagesFetched++;

            if (items.length > 0) {
              for (const it of items) {
                if (it?.id) caMap.set(String(it.id), it);
              }
            }

            if (items.length < pageSize) break;
          } catch (fallbackErr: any) {
            console.warn('[SyncPaymentsJob] Erro no fallback:', fallbackErr?.message);
            if (page === 1) throw fallbackErr;
            break;
          }
        } else {
          console.warn(`[SyncPaymentsJob] Erro na página ${page}:`, pageErr?.message);
          if (page === 1) throw pageErr;
          break;
        }
      }
    }

    console.log(`[SyncPaymentsJob] CA map: ${caMap.size} itens únicos`);

    // 4) Comparar e atualizar local
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
      const renegotiated = isRenegotiatedStatus(ca.status);

      if (!paid && !lost && !renegotiated) continue;

      resolvedCount++;

      const newStatus = paid ? 'paid' : (renegotiated ? 'renegotiated' : 'cancelled');

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
          clienteNome: ca.cliente?.nome,
        });
      }
    }

    // 5) Atualizar cursor com novo timestamp
    const cursorAfter = toDate.toISOString();
    await updateSyncCursor(db, cursorType, toDate, 'success', {
      checkedLocal,
      resolvedCount,
      updatedCount,
      pagesFetched,
    });

    const result = {
      success: true,
      syncType,
      checkedLocal,
      resolvedCount,
      updatedCount,
      pagesFetched,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      cursorBefore,
      cursorAfter,
    };

    console.log('[SyncPaymentsJob] Concluído:', result);
    return result;
  } catch (err: any) {
    console.error('[SyncPaymentsJob] Erro:', err?.message);

    // Tentar atualizar cursor com status 'failed' (sem alterar lastSyncAt)
    try {
      const db = await getDb();
      if (db) {
        const cursor = await getSyncCursor(db, cursorType);
        if (cursor) {
          await db
            .update(syncCursor)
            .set({
              lastStatus: 'failed',
              lastResult: JSON.stringify({ error: err?.message }),
              updatedAt: new Date(),
            })
            .where(eq(syncCursor.syncType, cursorType));
        }
      }
    } catch (updateErr: any) {
      console.error('[SyncPaymentsJob] Erro ao atualizar cursor:', updateErr?.message);
    }

    return {
      success: false,
      syncType,
      checkedLocal: 0,
      resolvedCount: 0,
      updatedCount: 0,
      pagesFetched: 0,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      error: err?.message,
    };
  }
}
