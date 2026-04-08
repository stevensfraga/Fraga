/**
 * COBRANÇA CONSOLIDADA POR CLIENTE (ANTI-SPAM)
 * 
 * Agrupa receivables por cliente para enviar 1 única mensagem
 * consolidada em vez de N mensagens por receivable.
 * 
 * Benefícios:
 * - Anti-spam: 1 msg por cliente (não 1 por receivable)
 * - Melhor UX: cliente vê total consolidado
 * - Menos bloqueios: reduz risco de opt-out
 */

import { getDb } from '../db';
import { receivables, clients, whatsappAudit } from '../../drizzle/schema';
import { eq, and, desc, gte, sql, inArray } from 'drizzle-orm';
import { BucketCode } from './buckets';
import { isValidWhatsAppE164 } from './normalizeWhatsApp';

export interface ConsolidatedClient {
  clientId: number;
  clientName: string;
  whatsappNumber: string;
  titlesCount: number;
  totalDebt: number;
  oldestDue: Date;
  newestDue: Date;
  maxDaysOverdue: number;
  paymentLinkCanonical: string;
  topReceivables: {
    receivableId: number;
    amount: number;
    dueDate: Date;
    daysOverdue: number;
    paymentLinkCanonical: string | null;
    dispatchCount: number;
  }[];
  eligible: boolean;
  rejectionReasons: string[];
}

/**
 * Buscar clientes elegíveis para cobrança consolidada em um bucket
 */
export async function getEligibleClientsForBucket(
  bucketCode: BucketCode,
  limitClients: number = 10
): Promise<ConsolidatedClient[]> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  const { minDays, maxDays } = getBucketRange(bucketCode);

  // 1. Buscar todos os receivables OVERDUE no bucket com dados do cliente
  const rows = await db
    .select({
      receivableId: receivables.id,
      clientId: receivables.clientId,
      amount: receivables.amount,
      dueDate: receivables.dueDate,
      paymentLinkCanonical: receivables.paymentLinkCanonical,
      status: receivables.status,
      paidDate: receivables.paidDate,
      dispatchCount: receivables.dispatchCount,
      collectionScore: receivables.collectionScore,
      clientName: clients.name,
      whatsappNumber: clients.whatsappNumber,
      optOut: clients.optOut,
    })
    .from(receivables)
    .innerJoin(clients, eq(receivables.clientId, clients.id))
    .where(
      and(
        eq(receivables.status, 'overdue'),
        sql`DATEDIFF(NOW(), ${receivables.dueDate}) >= ${minDays}`,
        sql`DATEDIFF(NOW(), ${receivables.dueDate}) <= ${maxDays}`
      )
    )
    .orderBy(
      sql`${receivables.collectionScore} DESC`
    );

  // 2. Agrupar por clientId
  const clientMap = new Map<number, ConsolidatedClient>();

  for (const row of rows) {
    const daysOverdue = Math.floor(
      (Date.now() - new Date(row.dueDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (!clientMap.has(row.clientId)) {
      clientMap.set(row.clientId, {
        clientId: row.clientId,
        clientName: row.clientName,
        whatsappNumber: row.whatsappNumber || '',
        titlesCount: 0,
        totalDebt: 0,
        oldestDue: new Date(row.dueDate),
        newestDue: new Date(row.dueDate),
        maxDaysOverdue: daysOverdue,
        paymentLinkCanonical: '',
        topReceivables: [],
        eligible: true,
        rejectionReasons: [],
      });
    }

    const client = clientMap.get(row.clientId)!;
    client.titlesCount++;
    client.totalDebt += parseFloat(row.amount);

    const dueDate = new Date(row.dueDate);
    if (dueDate < client.oldestDue) client.oldestDue = dueDate;
    if (dueDate > client.newestDue) client.newestDue = dueDate;
    if (daysOverdue > client.maxDaysOverdue) client.maxDaysOverdue = daysOverdue;

    client.topReceivables.push({
      receivableId: row.receivableId,
      amount: parseFloat(row.amount),
      dueDate: new Date(row.dueDate),
      daysOverdue,
      paymentLinkCanonical: row.paymentLinkCanonical,
      dispatchCount: row.dispatchCount || 0,
    });
  }

  // 3. Para cada cliente, aplicar filtros de elegibilidade
  const results: ConsolidatedClient[] = [];

  for (const client of Array.from(clientMap.values())) {
    const reasons: string[] = [];

    // Escolher paymentLinkCanonical do receivable mais antigo (com fallback)
    const sortedByDate = [...client.topReceivables].sort(
      (a: { dueDate: Date }, b: { dueDate: Date }) => a.dueDate.getTime() - b.dueDate.getTime()
    );
    const withLink = sortedByDate.find(r => r.paymentLinkCanonical);
    client.paymentLinkCanonical = withLink?.paymentLinkCanonical || '';

    // Filtro 1: WhatsApp válido
    if (!client.whatsappNumber || client.whatsappNumber.trim() === '') {
      reasons.push('NO_WHATSAPP');
    } else if (!isValidWhatsAppE164(client.whatsappNumber)) {
      reasons.push(`INVALID_WHATSAPP_FORMAT: ${client.whatsappNumber}`);
    }

    // Filtro 2: Opt-out (buscar do primeiro row)
    const firstRow = rows.find(r => r.clientId === client.clientId);
    if (firstRow?.optOut) {
      reasons.push('OPTOUT');
    }

    // Filtro 3: Link de pagamento
    if (!client.paymentLinkCanonical) {
      reasons.push('NO_PAYMENT_LINK');
    }

    // Filtro 4: Mensagem recente (48h) — por CLIENTE, não por receivable
    const recentMsg = await checkRecentClientMessage(client.clientId);
    if (recentMsg) {
      reasons.push(`RECENT_MESSAGE: última msg há ${recentMsg.hoursAgo}h (mín 48h)`);
    }

    // Filtro 5: Já enviou hoje (dayKey por clientId)
    const sentToday = await checkSentToday(client.clientId);
    if (sentToday) {
      reasons.push('ALREADY_SENT_TODAY: cliente já recebeu msg hoje');
    }

    // Ordenar topReceivables por score (maior primeiro)
    client.topReceivables.sort((a, b) => b.amount - a.amount);
    // Limitar a 5 top receivables
    client.topReceivables = client.topReceivables.slice(0, 5);

    client.eligible = reasons.length === 0;
    client.rejectionReasons = reasons;

    results.push(client);
  }

  // 4. Ordenar: elegíveis primeiro, depois por totalDebt DESC
  results.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.totalDebt - a.totalDebt;
  });

  // 5. Retornar até limitClients
  return results.slice(0, limitClients);
}

/**
 * Verificar se houve mensagem enviada nas últimas 48h para este CLIENTE
 * (qualquer receivable, não apenas um específico)
 */
async function checkRecentClientMessage(
  clientId: number
): Promise<{ hoursAgo: number } | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const recent = await db
      .select({ sentAt: whatsappAudit.sentAt })
      .from(whatsappAudit)
      .where(
        and(
          eq(whatsappAudit.clientId, clientId),
          gte(whatsappAudit.sentAt, cutoff),
          inArray(whatsappAudit.status, ['sent', 'delivered', 'read'])
        )
      )
      .orderBy(desc(whatsappAudit.sentAt))
      .limit(1);

    if (recent.length > 0 && recent[0].sentAt) {
      const hoursAgo = Math.round(
        (Date.now() - new Date(recent[0].sentAt).getTime()) / (1000 * 60 * 60)
      );
      return { hoursAgo };
    }

    return null;
  } catch (error) {
    console.error('[ClientConsolidation] Erro ao verificar msg recente:', error);
    return null;
  }
}

/**
 * Verificar se já enviou mensagem para este cliente HOJE
 * (anti-spam: máximo 1 envio por cliente/dia)
 */
async function checkSentToday(
  clientId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sentToday = await db
      .select({ id: whatsappAudit.id })
      .from(whatsappAudit)
      .where(
        and(
          eq(whatsappAudit.clientId, clientId),
          gte(whatsappAudit.sentAt, todayStart),
          inArray(whatsappAudit.status, ['sent', 'delivered', 'read'])
        )
      )
      .limit(1);

    return sentToday.length > 0;
  } catch (error) {
    console.error('[ClientConsolidation] Erro ao verificar envio hoje:', error);
    return false;
  }
}

function getBucketRange(code: BucketCode): { minDays: number; maxDays: number } {
  const ranges: Record<BucketCode, { minDays: number; maxDays: number }> = {
    A: { minDays: 1, maxDays: 3 },
    B: { minDays: 4, maxDays: 15 },
    C: { minDays: 16, maxDays: 30 },
    D: { minDays: 31, maxDays: 9999 },
  };
  return ranges[code];
}
