/**
 * BLOCO 11 — ETAPA 11.2: Filtros obrigatórios pré-envio
 * 
 * ANTES de enviar mensagem, validar:
 * 1. status = OVERDUE
 * 2. possui telefone WhatsApp válido
 * 3. optOut = false
 * 4. não está pago
 * 5. não recebeu mensagem nas últimas 48h
 * 6. não possui promessa ativa
 * 
 * Sem todos os critérios → NÃO enviar.
 */

import { getDb } from '../db';
import { receivables, clients, whatsappAudit, agreements } from '../../drizzle/schema';
import { eq, and, desc, gte, inArray, sql } from 'drizzle-orm';
import { BucketCode, calcDaysOverdue, classifyBucket } from './buckets';
import { normalizeWhatsApp as normalizeWhatsAppCentralized, isValidWhatsAppE164 } from './normalizeWhatsApp';

export interface EligibilityResult {
  eligible: boolean;
  receivableId: number;
  clientId: number;
  clientName: string;
  whatsappNumber: string | null;
  amount: string;
  dueDate: Date;
  daysOverdue: number;
  bucketCode: BucketCode | null;
  link: string | null;
  paymentLinkCanonical: string | null; // Link canônico de pagamento (OBRIGATÓRIO)
  dispatchCount: number; // Número de envios anteriores (usado para escolher D1 vs D)
  rejectionReasons: string[];
}

/**
 * Verificar se um receivable é elegível para envio
 */
export async function checkEligibility(
  receivableId: number,
  clientId: number,
  clientData: {
    name: string;
    whatsappNumber: string | null;
    optOut: boolean;
  },
  receivableData: {
    status: string;
    amount: string;
    dueDate: Date | string;
    link: string | null;
    paymentLinkCanonical?: string | null; // Link canônico de pagamento (OBRIGATÓRIO)
    paidDate: Date | null;
    dispatchCount?: number; // Número de envios anteriores
  }
): Promise<EligibilityResult> {
  const reasons: string[] = [];
  const dueDate = typeof receivableData.dueDate === 'string' 
    ? new Date(receivableData.dueDate) 
    : receivableData.dueDate;
  const daysOverdue = calcDaysOverdue(dueDate);
  const bucket = classifyBucket(daysOverdue);

  // 1. Status = OVERDUE
  if (receivableData.status !== 'overdue') {
    reasons.push(`STATUS_NOT_OVERDUE: status=${receivableData.status}`);
  }

  // 2. WhatsApp válido (formato E.164 obrigatório)
  if (!clientData.whatsappNumber || clientData.whatsappNumber.trim() === '') {
    reasons.push('NO_WHATSAPP: cliente sem número de WhatsApp');
  } else if (!isValidWhatsAppE164(clientData.whatsappNumber)) {
    reasons.push(`INVALID_WHATSAPP_FORMAT: número não está em formato E.164 (${clientData.whatsappNumber})`);
  }

  // 3. Opt-out
  if (clientData.optOut) {
    reasons.push('OPT_OUT: cliente optou por não receber mensagens');
  }

  // 4. Não está pago
  if (receivableData.paidDate) {
    reasons.push('ALREADY_PAID: receivable já foi pago');
  }

  // 5. Não recebeu mensagem nas últimas 48h
  const recentMessage = await checkRecentMessage(clientId, receivableId);
  if (recentMessage) {
    reasons.push(`RECENT_MESSAGE: última mensagem enviada há ${recentMessage.hoursAgo}h (mínimo 48h)`);
  }

  // 6. Não possui promessa ativa
  const activePromise = await checkActivePromise(clientId);
  if (activePromise) {
    reasons.push(`ACTIVE_PROMISE: promessa ativa até ${activePromise.deadline}`);
  }

  // 7. Possui link de pagamento canônico (OBRIGATÓRIO)
  if (!receivableData.paymentLinkCanonical || receivableData.paymentLinkCanonical.trim() === '') {
    reasons.push('NO_PAYMENT_LINK: receivable sem link de pagamento (paymentLinkCanonical vazio)');
  }

  return {
    eligible: reasons.length === 0,
    receivableId,
    clientId,
    clientName: clientData.name,
    whatsappNumber: clientData.whatsappNumber,
    amount: receivableData.amount,
    dueDate,
    daysOverdue,
    bucketCode: bucket?.code || null,
    link: receivableData.link,
    paymentLinkCanonical: receivableData.paymentLinkCanonical || null,
    dispatchCount: receivableData.dispatchCount || 0,
    rejectionReasons: reasons,
  };
}

/**
 * Re-exportar normalizeWhatsApp da função centralizada
 * DEPRECATED: Use import direto de './normalizeWhatsApp'
 */
export function normalizeWhatsApp(phone: string | null | undefined): string | null {
  return normalizeWhatsAppCentralized(phone);
}

/**
 * Verificar se houve mensagem enviada nas últimas 48h para este cliente/receivable
 */
async function checkRecentMessage(
  clientId: number,
  receivableId: number
): Promise<{ hoursAgo: number } | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h atrás
    
    const recent = await db
      .select({ sentAt: whatsappAudit.sentAt })
      .from(whatsappAudit)
      .where(
        and(
          eq(whatsappAudit.clientId, clientId),
          eq(whatsappAudit.receivableId, receivableId),
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
    console.error('[EligibilityFilter] Erro ao verificar mensagem recente:', error);
    return null; // Em caso de erro, não bloquear
  }
}

/**
 * Verificar se cliente possui promessa de pagamento ativa
 */
async function checkActivePromise(
  clientId: number
): Promise<{ deadline: string } | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const active = await db
      .select({ startDate: agreements.startDate, status: agreements.status })
      .from(agreements)
      .where(
        and(
          eq(agreements.clientId, clientId),
          eq(agreements.status, 'active')
        )
      )
      .limit(1);

    if (active.length > 0) {
      const deadline = active[0].startDate
        ? new Date(active[0].startDate).toLocaleDateString('pt-BR')
        : 'indefinido';
      return { deadline };
    }

    return null;
  } catch (error) {
    console.error('[EligibilityFilter] Erro ao verificar promessa ativa:', error);
    return null; // Em caso de erro, não bloquear
  }
}

/**
 * Buscar receivables elegíveis para envio em uma faixa específica
 */
export async function getEligibleReceivables(
  bucketCode: BucketCode,
  limit: number = 10
): Promise<EligibilityResult[]> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  const { minDays, maxDays } = getBucketRange(bucketCode);

  // Buscar receivables OVERDUE com JOIN em clients
  const rows = await db
    .select({
      receivableId: receivables.id,
      clientId: receivables.clientId,
      amount: receivables.amount,
      dueDate: receivables.dueDate,
      link: receivables.link,
      paymentLinkCanonical: receivables.paymentLinkCanonical, // Link canônico (OBRIGATÓRIO)
      status: receivables.status,
      paidDate: receivables.paidDate,
      dispatchCount: receivables.dispatchCount, // Para escolher D1 vs D
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
      receivables.dispatchCount, // 0 primeiro (nunca enviado)
      sql`${receivables.collectionScore} DESC` // Maior risco financeiro primeiro: (daysOverdue × 2) + (amount / 100)
    )
    .limit(limit * 3); // Buscar mais para compensar filtros

  // Aplicar filtros de elegibilidade
  const results: EligibilityResult[] = [];
  
  for (const row of rows) {
    if (results.length >= limit) break;

    const result = await checkEligibility(
      row.receivableId,
      row.clientId,
      {
        name: row.clientName,
        whatsappNumber: row.whatsappNumber,
        optOut: row.optOut,
      },
      {
        status: row.status,
        amount: row.amount,
        dueDate: row.dueDate,
        link: row.link,
        paymentLinkCanonical: row.paymentLinkCanonical,
        paidDate: row.paidDate,
        dispatchCount: row.dispatchCount || 0,
      }
    );

    results.push(result);
  }

  return results;
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
