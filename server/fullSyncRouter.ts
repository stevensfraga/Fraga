/**
 * Full Sync Router — POST /api/sync/full
 *
 * Importa títulos NOVOS e atualiza existentes do Conta Azul para o banco local.
 * Diferente do syncPaymentsJob (que só atualiza existentes), este endpoint:
 *   1. Busca TODOS os recebíveis do CA (OVERDUE + PENDING) nos últimos 180 dias
 *   2. Para cada um, faz upsert do cliente (cria se não existe)
 *   3. Para cada título, faz upsert do receivable (insere se novo, atualiza se existente)
 *   4. Retorna { imported, updated, total, errors }
 *
 * Protegido por x-admin-key (FRAGA_ADMIN_KEY).
 */
import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { clients, receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();

/**
 * Executa o full sync programaticamente (para uso em cron jobs).
 * Retorna estatísticas de importação/atualização.
 */
export async function runFullSync(windowDays = 180): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  total: number;
  totalCA: number;
  errors: number;
}> {
  const pageSize = 100;
  const maxPages = 20;

  console.log(`[FullSync] 🚀 Iniciando full sync | windowDays=${windowDays}`);

  const token = await getValidAccessToken();
  if (!token) throw new Error('Token CA não disponível');

  const db = await getDb();
  if (!db) throw new Error('Banco de dados não disponível');

  const baseUrl = normalizeBaseUrl(process.env.CONTA_AZUL_API_BASE);
  const url = `${baseUrl}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar`;

  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - windowDays);
  const future60 = new Date(today);
  future60.setDate(future60.getDate() + 60);

  const fromDate = windowStart.toISOString().split('T')[0];
  const toDate = future60.toISOString().split('T')[0];

  const allItems: any[] = [];
  let totalCA = 0;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: { pagina: page, tamanho_pagina: pageSize, data_vencimento_de: fromDate, data_vencimento_ate: toDate },
        timeout: 20000,
      });
      const data = resp.data;
      const items: any[] = data?.itens || [];
      totalCA = data?.itens_totais || totalCA;
      if (!items.length) break;
      allItems.push(...items);
      if (allItems.length >= totalCA) break;
    } catch (pageErr: any) {
      console.error(`[FullSync] Erro na página ${page}:`, pageErr.message);
      break;
    }
  }

  const stats = { total: allItems.length, imported: 0, updated: 0, skipped: 0, errors: 0, totalCA };

  for (const item of allItems) {
    try {
      const caId = item.id;
      const caClientId = item.cliente?.id;
      const clientName = item.cliente?.nome || 'Cliente Conta Azul';
      const amountRaw = (item.total ?? item.nao_pago ?? 0);
      const amount = String(amountRaw);
      const dueDate = new Date(item.data_vencimento);
      const status = mapStatus(item.status);
      const description = item.descricao || '';

      if (!caId || !caClientId) { stats.skipped++; continue; }

      const clientId = await upsertClientFromCA(db, caClientId, clientName);
      if (!clientId) { stats.errors++; continue; }

      const now = new Date();
      const monthsOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (30 * 24 * 60 * 60 * 1000)));
      const amountNum = parseFloat(amount) || 0;
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
      const collectionScore = String(((daysOverdue * 2) + (amountNum / 100)).toFixed(2));

      const existing = await db.select({ id: receivables.id }).from(receivables).where(eq(receivables.contaAzulId, caId)).limit(1);

      if (existing.length > 0) {
        await db.update(receivables).set({ amount, dueDate, status, description, monthsOverdue, collectionScore, source: 'conta-azul', updatedAt: new Date() }).where(eq(receivables.contaAzulId, caId));
        stats.updated++;
      } else {
        await db.insert(receivables).values({ contaAzulId: caId, clientId, amount, dueDate, status, description, monthsOverdue, collectionScore, source: 'conta-azul' });
        stats.imported++;
        console.log(`[FullSync] ✅ NOVO título importado: ${caId} | ${clientName} | R$ ${amount} | ${status}`);
      }
    } catch (itemErr: any) {
      stats.errors++;
    }
  }

  console.log(`[FullSync] ✅ Concluído: imported=${stats.imported} | updated=${stats.updated} | skipped=${stats.skipped} | errors=${stats.errors}`);
  return stats;
}

function normalizeBaseUrl(url?: string): string {
  if (!url) return 'https://api-v2.contaazul.com';
  return url.replace(/\/v1\/?$/, '');
}

function mapStatus(caStatus: string): 'overdue' | 'pending' | 'paid' | 'cancelled' {
  switch ((caStatus || '').toUpperCase()) {
    case 'OVERDUE':
    case 'ATRASADO':
      return 'overdue';
    case 'PENDING':
    case 'PENDENTE':
    case 'EM_ABERTO':
      return 'pending';
    case 'ACQUITTED':
    case 'RECEBIDO':
    case 'PAID':
      return 'paid';
    case 'LOST':
    case 'PERDIDO':
    case 'CANCELLED':
    case 'CANCELADO':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Busca ou cria cliente no banco local a partir dos dados do CA
 */
async function upsertClientFromCA(
  db: Awaited<ReturnType<typeof getDb>>,
  caClientId: string,
  clientName: string
): Promise<number | null> {
  if (!db) return null;
  try {
    // Buscar cliente existente
    const existing = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.contaAzulId, caClientId))
      .limit(1);

    if (existing.length > 0) {
      return existing[0].id;
    }

    // Criar novo cliente
    const result = await db.insert(clients).values({
      contaAzulId: caClientId,
      name: clientName || 'Cliente Conta Azul',
      status: 'active',
      whatsappSource: 'conta-azul',
    });
    const insertId = (result as any)[0]?.insertId;
    console.log(`[FullSync] ✅ Cliente criado: ${clientName} (CA: ${caClientId}) → id=${insertId}`);
    return insertId || null;
  } catch (err: any) {
    // Pode ocorrer race condition em duplicate key — tentar buscar novamente
    if (err.code === 'ER_DUP_ENTRY') {
      const retry = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.contaAzulId, caClientId))
        .limit(1);
      return retry[0]?.id || null;
    }
    throw err;
  }
}

/**
 * POST /api/sync/full
 * Importa títulos novos e atualiza existentes do Conta Azul
 */
router.post('/full', async (req: Request, res: Response) => {
  // Verificar autenticação admin
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.FRAGA_ADMIN_KEY) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const windowDays = parseInt(req.query.days as string) || 180;
  const dryRun = req.query.dryRun === 'true';
  const pageSize = 100;
  const maxPages = 20; // Até 2000 títulos

  console.log(`[FullSync] 🚀 Iniciando full sync | windowDays=${windowDays} | dryRun=${dryRun}`);

  try {
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(503).json({ success: false, error: 'Token CA não disponível' });
    }

    const db = await getDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const baseUrl = normalizeBaseUrl(process.env.CONTA_AZUL_API_BASE);
    const url = `${baseUrl}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar`;

    const today = new Date();
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - windowDays);
    const future60 = new Date(today);
    future60.setDate(future60.getDate() + 60);

    const fromDate = windowStart.toISOString().split('T')[0];
    const toDate = future60.toISOString().split('T')[0];

    console.log(`[FullSync] Janela: ${fromDate} → ${toDate}`);

    // Coletar todos os títulos via paginação
    const allItems: any[] = [];
    let totalCA = 0;

    for (let page = 1; page <= maxPages; page++) {
      try {
        const resp = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            pagina: page,
            tamanho_pagina: pageSize,
            data_vencimento_de: fromDate,
            data_vencimento_ate: toDate,
          },
          timeout: 20000,
        });

        const data = resp.data;
        const items: any[] = data?.itens || [];
        totalCA = data?.itens_totais || totalCA;

        console.log(`[FullSync] Página ${page}: ${items.length} itens (total CA: ${totalCA})`);

        if (!items.length) break;
        allItems.push(...items);

        // Se já buscamos todos os itens disponíveis, parar
        if (allItems.length >= totalCA) break;
      } catch (pageErr: any) {
        console.error(`[FullSync] Erro na página ${page}:`, pageErr.message);
        break;
      }
    }

    console.log(`[FullSync] Total coletado do CA: ${allItems.length} (de ${totalCA})`);

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        totalCA,
        fetched: allItems.length,
        message: 'Dry run — nenhuma alteração feita',
      });
    }

    // Processar cada título
    const stats = {
      total: allItems.length,
      imported: 0,
      updated: 0,
      skipped: 0,
      clientsCreated: 0,
      errors: 0,
      errorDetails: [] as string[],
    };

    for (const item of allItems) {
      try {
        const caId = item.id;
        const caClientId = item.cliente?.id;
        const clientName = item.cliente?.nome || 'Cliente Conta Azul';
        // Para títulos pagos, nao_pago=0 (correto). Usar total como valor de referência.
        // Para títulos em aberto/vencidos, nao_pago é o valor pendente.
        const amountRaw = (item.total ?? item.nao_pago ?? 0);
        const amount = String(amountRaw);
        const dueDate = new Date(item.data_vencimento);
        const status = mapStatus(item.status);
        const description = item.descricao || '';

        if (!caId || !caClientId) {
          stats.skipped++;
          continue;
        }

        // Upsert cliente
        const clientId = await upsertClientFromCA(db, caClientId, clientName);
        if (!clientId) {
          stats.errors++;
          stats.errorDetails.push(`${caId}: Falha ao criar/encontrar cliente ${caClientId}`);
          continue;
        }

        // Calcular monthsOverdue
        const now = new Date();
        const monthsOverdue = Math.max(
          0,
          Math.floor((now.getTime() - dueDate.getTime()) / (30 * 24 * 60 * 60 * 1000))
        );

        // Calcular collectionScore
        const amountNum = parseFloat(amount) || 0;
        const daysOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
        const collectionScore = String(((daysOverdue * 2) + (amountNum / 100)).toFixed(2));

        // Verificar se já existe no banco
        const existing = await db
          .select({ id: receivables.id })
          .from(receivables)
          .where(eq(receivables.contaAzulId, caId))
          .limit(1);

        if (existing.length > 0) {
          // Atualizar existente
          await db
            .update(receivables)
            .set({
              amount,
              dueDate,
              status,
              description,
              monthsOverdue,
              collectionScore,
              source: 'conta-azul',
              updatedAt: new Date(),
            })
            .where(eq(receivables.contaAzulId, caId));
          stats.updated++;
        } else {
          // Inserir novo
          await db.insert(receivables).values({
            contaAzulId: caId,
            clientId,
            amount,
            dueDate,
            status,
            description,
            monthsOverdue,
            collectionScore,
            source: 'conta-azul',
          });
          stats.imported++;
          console.log(`[FullSync] ✅ NOVO título importado: ${caId} | ${clientName} | R$ ${amount} | ${status}`);
        }
      } catch (itemErr: any) {
        stats.errors++;
        stats.errorDetails.push(`${item.id}: ${itemErr.message?.substring(0, 100)}`);
        console.error(`[FullSync] Erro processando ${item.id}:`, itemErr.message);
      }
    }

    console.log(`[FullSync] ✅ Concluído: imported=${stats.imported} | updated=${stats.updated} | skipped=${stats.skipped} | errors=${stats.errors}`);

    return res.json({
      success: true,
      imported: stats.imported,
      updated: stats.updated,
      skipped: stats.skipped,
      total: stats.total,
      totalCA,
      errors: stats.errors,
      errorDetails: stats.errorDetails.slice(0, 20),
    });
  } catch (err: any) {
    console.error('[FullSync] Erro fatal:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
