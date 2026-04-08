/**
 * FOLLOW-UP AUTOMÁTICO PARA CLIENTES QUE NÃO RESPONDERAM
 * 
 * Regras:
 * - Cooldown 48h entre mensagens para o mesmo cliente
 * - Máximo 3 tentativas por cliente (ciclo atual)
 * - 1 msg/dia por cliente
 * - Safety cap diário respeitado
 * - Para se: inbound recebido, pagamento identificado, optout
 * 
 * IMPORTANTE: Não altera régua existente. Etapa adicional.
 */
import axios from 'axios';
import { getDb } from '../db';
import {
  noResponseFollowups,
  receivables,
  clients,
  whatsappAudit,
  inboundMessages,
} from '../../drizzle/schema';
import { eq, and, sql, desc, lte, isNull, inArray } from 'drizzle-orm';
import { BucketCode } from './buckets';
import { formatBRL, formatDate, generateConsolidatedCorrelationId } from './messageTemplates';
import { checkDailyUsage } from './safetyCap';
import { checkTokenHealth } from './tokenGuard';
import { FEATURE_FLAGS } from '../_core/featureFlags';
import { normalizeWhatsApp } from './normalizeWhatsApp';

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

export interface FollowupTemplate {
  attempt: number; // 1, 2, 3
  delayDays: number; // D+2, D+5, D+10
  template: string;
}

export const FOLLOWUP_TEMPLATES: FollowupTemplate[] = [
  {
    attempt: 1,
    delayDays: 2,
    template: [
      'Oi, {{nome}}! Só confirmando se conseguiu ver a mensagem anterior sobre a pendência.',
      'Se preferir, envio o link novamente.',
      '',
      '{{link}}',
    ].join('\n'),
  },
  {
    attempt: 2,
    delayDays: 5,
    template: [
      '{{nome}}, se estiver difícil regularizar agora, posso te ajudar com uma alternativa (negociação/parcelamento).',
      'Quer que eu te passe opções?',
      '',
      '{{link}}',
    ].join('\n'),
  },
  {
    attempt: 3,
    delayDays: 10,
    template: [
      '{{nome}}, preciso de um retorno pra evitar avanço para etapa administrativa.',
      'Consegue me responder por aqui, por favor?',
      '',
      '{{link}}',
    ].join('\n'),
  },
];

// ─── INTERFACES ───────────────────────────────────────────────────────────────

export interface FollowupCandidate {
  clientId: number;
  clientName: string;
  phoneE164: string;
  totalDebt: number;
  titlesCount: number;
  paymentLinkCanonical: string;
  maxDaysOverdue: number;
  collectionScore: number;
  followupId: number | null; // null = novo registro
  attemptCount: number;
  bucketAtTrigger: string;
}

export interface FollowupSendResult {
  clientId: number;
  clientName: string;
  phone: string;
  attempt: number;
  status: 'sent' | 'failed' | 'skipped';
  correlationId: string;
  messageId?: string;
  auditId?: number;
  error?: string;
  reason?: string;
  messagePreview?: string;
}

export interface FollowupBatchResult {
  timestamp: string;
  dryRun: boolean;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: FollowupSendResult[];
}

// ─── ELEGIBILIDADE ────────────────────────────────────────────────────────────

/**
 * Buscar clientes elegíveis para follow-up (não responderam)
 */
export async function getNoResponseCandidates(
  limit: number = 10
): Promise<FollowupCandidate[]> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  const now = new Date();

  // 1. Buscar clientes com dívida em aberto que receberam cobrança
  // e NÃO enviaram inbound após o último envio
  const overdueClients = await db
    .select({
      clientId: clients.id,
      clientName: clients.name,
      whatsappNumber: clients.whatsappNumber,
      optOut: clients.optOut,
    })
    .from(clients)
    .where(
      and(
        eq(clients.optOut, false),
        sql`${clients.whatsappNumber} IS NOT NULL`,
        sql`${clients.whatsappNumber} != ''`
      )
    );

  const candidates: FollowupCandidate[] = [];

  for (const client of overdueClients) {
    if (candidates.length >= limit * 3) break; // buscar mais para filtrar depois

    const normalizedPhone = normalizeWhatsApp(client.whatsappNumber || '');
    if (!normalizedPhone) continue;

    // Verificar se tem receivables overdue
    const overdueReceivables = await db
      .select({
        id: receivables.id,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        paymentLinkCanonical: receivables.paymentLinkCanonical,
        collectionScore: receivables.collectionScore,
      })
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, client.clientId),
          eq(receivables.status, 'overdue')
        )
      );

    if (overdueReceivables.length === 0) continue;

    // Verificar se recebeu cobrança (audit com status='sent')
    const lastSent = await db
      .select({
        sentAt: whatsappAudit.sentAt,
      })
      .from(whatsappAudit)
      .where(
        and(
          eq(whatsappAudit.clientId, client.clientId),
          eq(whatsappAudit.status, 'sent')
        )
      )
      .orderBy(desc(whatsappAudit.sentAt))
      .limit(1);

    if (lastSent.length === 0) continue; // nunca recebeu cobrança

    const lastSentAt = lastSent[0].sentAt;

    // Verificar se NÃO enviou inbound após o último envio
    const inboundAfterSent = await db
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.fromPhone, normalizedPhone),
          sql`${inboundMessages.createdAt} > ${lastSentAt}`
        )
      )
      .limit(1);

    if (inboundAfterSent.length > 0) continue; // respondeu!

    // Verificar follow-up existente
    const existingFollowup = await db
      .select()
      .from(noResponseFollowups)
      .where(eq(noResponseFollowups.clientId, client.clientId))
      .orderBy(desc(noResponseFollowups.createdAt))
      .limit(1);

    let followupId: number | null = null;
    let attemptCount = 0;
    let bucketAtTrigger = 'B';

    if (existingFollowup.length > 0) {
      const fu = existingFollowup[0];

      // Se já está stopped ou completed, pular
      if (fu.status !== 'active') continue;

      // Se já atingiu max_attempts
      if (fu.attemptCount >= 3) continue;

      // Verificar cooldown (nextEligibleAt)
      if (fu.nextEligibleAt && fu.nextEligibleAt > now) continue;

      followupId = fu.id;
      attemptCount = fu.attemptCount;
      bucketAtTrigger = fu.bucketAtTrigger;
    }

    // Calcular dados consolidados
    const totalDebt = overdueReceivables.reduce(
      (sum, r) => sum + parseFloat(String(r.amount || '0')),
      0
    );
    const maxDaysOverdue = overdueReceivables.reduce((max, r) => {
      const days = Math.floor(
        (now.getTime() - new Date(r.dueDate!).getTime()) / (1000 * 60 * 60 * 24)
      );
      return Math.max(max, days);
    }, 0);
    const bestLink =
      overdueReceivables.find((r) => r.paymentLinkCanonical)?.paymentLinkCanonical || '';
    const bestScore = overdueReceivables.reduce(
      (max, r) => Math.max(max, parseFloat(String(r.collectionScore || '0'))),
      0
    );

    candidates.push({
      clientId: client.clientId,
      clientName: client.clientName || 'Cliente',
      phoneE164: normalizedPhone,
      totalDebt,
      titlesCount: overdueReceivables.length,
      paymentLinkCanonical: bestLink,
      maxDaysOverdue,
      collectionScore: bestScore,
      followupId,
      attemptCount,
      bucketAtTrigger,
    });
  }

  // Ordenar por collectionScore DESC e maxDaysOverdue DESC
  candidates.sort((a, b) => {
    if (b.collectionScore !== a.collectionScore) return b.collectionScore - a.collectionScore;
    return b.maxDaysOverdue - a.maxDaysOverdue;
  });

  // Verificar cooldown 48h e 1 msg/dia
  const eligible: FollowupCandidate[] = [];
  const todayStart = getTodayStartSaoPaulo();

  for (const candidate of candidates) {
    if (eligible.length >= limit) break;

    // Verificar se já recebeu mensagem hoje (qualquer tipo)
    const db2 = await getDb();
    if (!db2) break;

    const sentToday = await db2
      .select({ id: whatsappAudit.id })
      .from(whatsappAudit)
      .where(
        and(
          eq(whatsappAudit.clientId, candidate.clientId),
          eq(whatsappAudit.status, 'sent'),
          sql`${whatsappAudit.sentAt} >= ${todayStart}`
        )
      )
      .limit(1);

    if (sentToday.length > 0) continue; // já recebeu hoje

    eligible.push(candidate);
  }

  return eligible;
}

// ─── EXECUÇÃO ─────────────────────────────────────────────────────────────────

/**
 * Renderizar template de follow-up
 */
export function renderFollowupMessage(
  template: string,
  nome: string,
  link: string
): string {
  return template
    .replace(/\{\{nome\}\}/g, nome)
    .replace(/\{\{link\}\}/g, link);
}

/**
 * Enviar mensagem via ZapContábil
 */
async function sendViaZapContabil(
  phone: string,
  message: string,
  correlationId: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!ZAP_API_KEY) {
    return { success: false, error: 'ZAP_CONTABIL_API_KEY não configurada' };
  }

  if (!FEATURE_FLAGS.ALLOW_REAL_SEND) {
    console.log(`[Followup] 🔒 ALLOW_REAL_SEND=false, simulando envio: ${correlationId}`);
    return { success: true, messageId: `dry-${correlationId}` };
  }

  try {
    const phoneDigits = phone.replace(/\D/g, '');
    const queueId = Number(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO) || undefined;
    console.log(`[Followup] 📤 Enviando: phone=${phoneDigits}, correlationId=${correlationId}, queueId=${queueId || 'nenhum'}`);

    const response = await axios.post(
      `${ZAP_API_URL}/api/send/${phoneDigits}`,
      { body: message, connectionFrom: 0, ...(queueId ? { queueId } : {}) },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const messageId =
      response.data?.message?.id || response.data?.messageId || response.data?.id;
    return { success: true, messageId: String(messageId || '') };
  } catch (error: any) {
    console.error(`[Followup] ❌ Erro ao enviar: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Executar ciclo de follow-up
 */
export async function runFollowupCycle(
  limit: number = 10,
  dryRun: boolean = true
): Promise<FollowupBatchResult> {
  const timestamp = new Date().toISOString();
  const results: FollowupSendResult[] = [];

  console.log(`[Followup] 🚀 Iniciando ciclo: limit=${limit}, dryRun=${dryRun}`);

  // 1. Verificar kill switch
  if (FEATURE_FLAGS.KILL_SWITCH) {
    console.log('[Followup] ❌ KILL_SWITCH ativo, abortando');
    return { timestamp, dryRun, total: 0, sent: 0, failed: 0, skipped: 0, results };
  }

  // 2. Verificar safety cap
  const usage = await checkDailyUsage();
  if (!usage.ok || usage.remaining < 1) {
    console.log(`[Followup] ❌ Safety cap excedido: ${usage.message}`);
    return { timestamp, dryRun, total: 0, sent: 0, failed: 0, skipped: 0, results };
  }

  // 3. Verificar token health
  const tokenHealth = await checkTokenHealth();
  if (!tokenHealth.ok) {
    console.log(`[Followup] ⚠️ Token não saudável: ${tokenHealth.message} (continuando sem Conta Azul)`);
  }

  // 4. Buscar candidatos
  const effectiveLimit = Math.min(limit, usage.remaining);
  const candidates = await getNoResponseCandidates(effectiveLimit);
  console.log(`[Followup] 📋 ${candidates.length} candidatos elegíveis`);

  if (candidates.length === 0) {
    return { timestamp, dryRun, total: 0, sent: 0, failed: 0, skipped: 0, results };
  }

  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const nextAttempt = candidate.attemptCount + 1;
    const template = FOLLOWUP_TEMPLATES.find((t) => t.attempt === nextAttempt);

    if (!template) {
      // Max attempts atingido
      if (candidate.followupId) {
        await db
          .update(noResponseFollowups)
          .set({ status: 'completed', stopReason: 'max_attempts' })
          .where(eq(noResponseFollowups.id, candidate.followupId));
      }
      skipped++;
      results.push({
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        phone: candidate.phoneE164,
        attempt: nextAttempt,
        status: 'skipped',
        correlationId: '',
        reason: 'max_attempts',
      });
      continue;
    }

    const message = renderFollowupMessage(
      template.template,
      candidate.clientName.split(' ')[0], // Primeiro nome
      candidate.paymentLinkCanonical
    );

    const correlationId = `followup-${candidate.clientId}-${nextAttempt}-${Date.now()}`;

    if (dryRun) {
      results.push({
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        phone: candidate.phoneE164,
        attempt: nextAttempt,
        status: 'sent',
        correlationId,
        messagePreview: message.substring(0, 100),
        reason: 'dry_run',
      });
      sent++;
      continue;
    }

    // Enviar mensagem real
    const sendResult = await sendViaZapContabil(candidate.phoneE164, message, correlationId);

    if (sendResult.success) {
      // Atualizar ou criar registro de follow-up
      const now = new Date();
      const nextEligible = new Date(now.getTime() + template.delayDays * 24 * 60 * 60 * 1000);

      if (candidate.followupId) {
        await db
          .update(noResponseFollowups)
          .set({
            attemptCount: nextAttempt,
            lastAttemptAt: now,
            nextEligibleAt: nextEligible,
            status: nextAttempt >= 3 ? 'completed' : 'active',
            stopReason: nextAttempt >= 3 ? 'max_attempts' : null,
          })
          .where(eq(noResponseFollowups.id, candidate.followupId));
      } else {
        await db.insert(noResponseFollowups).values({
          clientId: candidate.clientId,
          phoneE164: candidate.phoneE164,
          bucketAtTrigger: candidate.bucketAtTrigger,
          firstSentAt: now,
          attemptCount: nextAttempt,
          lastAttemptAt: now,
          nextEligibleAt: nextEligible,
          status: nextAttempt >= 3 ? 'completed' : 'active',
          stopReason: nextAttempt >= 3 ? 'max_attempts' : null,
        });
      }

      // Registrar auditoria
      await db.insert(whatsappAudit).values({
        clientId: candidate.clientId,
        receivableId: 0, // Follow-up é consolidado, não tem receivable específico
        phoneNumber: candidate.phoneE164,
        templateUsed: `followup_${nextAttempt}`,
        messageContent: message,
        status: 'sent',
        sentAt: now,
        correlationId,
        messageId: sendResult.messageId || null,
      });

      sent++;
      results.push({
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        phone: candidate.phoneE164,
        attempt: nextAttempt,
        status: 'sent',
        correlationId,
        messageId: sendResult.messageId,
        messagePreview: message.substring(0, 100),
      });
    } else {
      failed++;
      results.push({
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        phone: candidate.phoneE164,
        attempt: nextAttempt,
        status: 'failed',
        correlationId,
        error: sendResult.error,
      });
    }
  }

  console.log(`[Followup] ✅ Ciclo concluído: ${sent} enviados, ${skipped} pulados, ${failed} falhas`);

  return {
    timestamp,
    dryRun,
    total: candidates.length,
    sent,
    failed,
    skipped,
    results,
  };
}

// ─── STOP FOLLOW-UP ──────────────────────────────────────────────────────────

/**
 * Parar follow-up ativo para um cliente (quando responde, paga, etc)
 */
export async function stopFollowupForClient(
  clientId: number,
  reason: 'replied' | 'paid' | 'optout' | 'manual'
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const result = await db
      .update(noResponseFollowups)
      .set({ status: 'stopped', stopReason: reason })
      .where(
        and(
          eq(noResponseFollowups.clientId, clientId),
          eq(noResponseFollowups.status, 'active')
        )
      );

    console.log(`[Followup] 🛑 Follow-up parado para clientId=${clientId}, motivo=${reason}`);
    return true;
  } catch (error: any) {
    console.error(`[Followup] ❌ Erro ao parar follow-up: ${error.message}`);
    return false;
  }
}

/**
 * Parar follow-up ativo para um telefone (quando recebe inbound)
 */
export async function stopFollowupByPhone(
  phoneE164: string,
  reason: 'replied' | 'paid' | 'optout' | 'manual'
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    await db
      .update(noResponseFollowups)
      .set({ status: 'stopped', stopReason: reason })
      .where(
        and(
          eq(noResponseFollowups.phoneE164, phoneE164),
          eq(noResponseFollowups.status, 'active')
        )
      );

    console.log(`[Followup] 🛑 Follow-up parado para phone=${phoneE164}, motivo=${reason}`);
    return true;
  } catch (error: any) {
    console.error(`[Followup] ❌ Erro ao parar follow-up por phone: ${error.message}`);
    return false;
  }
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export interface FollowupKPIs {
  active: number;
  completed: number;
  stoppedByReplied: number;
  stoppedByPaid: number;
  stoppedByOptout: number;
  stoppedByMaxAttempts: number;
  stoppedByManual: number;
  eligibleNow: number;
}

export async function getFollowupKPIs(): Promise<FollowupKPIs> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  const all = await db
    .select({
      status: noResponseFollowups.status,
      stopReason: noResponseFollowups.stopReason,
      nextEligibleAt: noResponseFollowups.nextEligibleAt,
    })
    .from(noResponseFollowups);

  const now = new Date();

  return {
    active: all.filter((r) => r.status === 'active').length,
    completed: all.filter((r) => r.status === 'completed').length,
    stoppedByReplied: all.filter((r) => r.status === 'stopped' && r.stopReason === 'replied').length,
    stoppedByPaid: all.filter((r) => r.status === 'stopped' && r.stopReason === 'paid').length,
    stoppedByOptout: all.filter((r) => r.status === 'stopped' && r.stopReason === 'optout').length,
    stoppedByMaxAttempts: all.filter(
      (r) => r.status === 'completed' || (r.status === 'stopped' && r.stopReason === 'max_attempts')
    ).length,
    stoppedByManual: all.filter((r) => r.status === 'stopped' && r.stopReason === 'manual').length,
    eligibleNow: all.filter(
      (r) => r.status === 'active' && (!r.nextEligibleAt || r.nextEligibleAt <= now)
    ).length,
  };
}

// ─── DEBUG ────────────────────────────────────────────────────────────────────

export interface FollowupDebugEntry {
  clientId: number;
  clientName: string;
  phone: string;
  attemptCount: number;
  status: string;
  stopReason: string | null;
  nextEligibleAt: Date | null;
  lastAttemptAt: Date | null;
  blockedReasons: string[];
}

export async function getFollowupDebug(
  limit: number = 20
): Promise<FollowupDebugEntry[]> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  const rows = await db
    .select({
      id: noResponseFollowups.id,
      clientId: noResponseFollowups.clientId,
      phoneE164: noResponseFollowups.phoneE164,
      attemptCount: noResponseFollowups.attemptCount,
      status: noResponseFollowups.status,
      stopReason: noResponseFollowups.stopReason,
      nextEligibleAt: noResponseFollowups.nextEligibleAt,
      lastAttemptAt: noResponseFollowups.lastAttemptAt,
      clientName: clients.name,
    })
    .from(noResponseFollowups)
    .innerJoin(clients, eq(noResponseFollowups.clientId, clients.id))
    .orderBy(desc(noResponseFollowups.updatedAt))
    .limit(limit);

  const now = new Date();

  return rows.map((r) => {
    const blockedReasons: string[] = [];
    if (r.status !== 'active') blockedReasons.push(`status=${r.status}`);
    if (r.attemptCount >= 3) blockedReasons.push('max_attempts');
    if (r.nextEligibleAt && r.nextEligibleAt > now) {
      const hoursLeft = Math.round((r.nextEligibleAt.getTime() - now.getTime()) / (1000 * 60 * 60));
      blockedReasons.push(`cooldown_${hoursLeft}h`);
    }

    return {
      clientId: r.clientId,
      clientName: r.clientName || 'N/A',
      phone: r.phoneE164,
      attemptCount: r.attemptCount,
      status: r.status,
      stopReason: r.stopReason,
      nextEligibleAt: r.nextEligibleAt,
      lastAttemptAt: r.lastAttemptAt,
      blockedReasons,
    };
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getTodayStartSaoPaulo(): Date {
  const now = new Date();
  const spFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const spDateStr = spFormatter.format(now);
  return new Date(`${spDateStr}T00:00:00-03:00`);
}
