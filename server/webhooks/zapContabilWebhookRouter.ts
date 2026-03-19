import { Router, Request, Response } from 'express';
import mysql from 'mysql2/promise';
import axios from 'axios';
import { normalizeWhatsApp } from '../collection/normalizeWhatsApp';
import { stopFollowupByPhone } from '../collection/noResponseFollowup';
import { FEATURE_FLAGS, isPhoneWhitelisted } from '../_core/featureFlags';
import {
  resolveClientByPhone,
  getOpenDebtSummary,
  intentDetect,
  isFinancialIntent,
  buildReply,
  sendWhatsAppReply,
  auditAIInteraction,
} from '../collection/aiDebtAssistant';
import { isOptOutMessage, markOptOut } from '../services/reguaCobrancaService';

const router = Router();

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

/** ID da fila Financeiro no ZapContábil */
const FINANCEIRO_QUEUE_ID = Number(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO) || 5;

/** Janela de deduplicação em ms (2 minutos) */
const DEDUP_WINDOW_MS = 2 * 60 * 1000;

/** Rate limit em ms (10 segundos por telefone) */
const RATE_LIMIT_MS = 10_000;

// ─── TIPOS ──────────────────────────────────────────────────────────────────

interface ZapContabilPayload {
  [key: string]: any;
}

type InboundDecision =
  | 'AI_RAN'
  | 'SKIPPED_NOT_WHITELIST'
  | 'SKIPPED_FLAG_OFF'
  | 'SKIPPED_INVALID_PHONE'
  | 'SKIPPED_EMPTY_PHONE'
  | 'SKIPPED_FROM_ME'
  | 'SKIPPED_NOT_INBOUND'
  | 'SKIPPED_HUMAN_ASSIGNED'
  | 'SKIPPED_NON_FINANCIAL_INTENT'
  | 'SKIPPED_TICKET_CLOSED'
  | 'SKIPPED_DEDUP'
  | 'SKIPPED_RATE_LIMITED'
  | 'SKIPPED_OPT_OUT'
  | 'OPT_OUT_CONFIRMED'
  | 'MOVED_TO_FINANCEIRO'
  | 'ERROR';

// ─── EXTRAÇÃO DE CAMPOS ──────────────────────────────────────────────────────
// O ZapContábil envia webhooks em TRÊS formatos:
//
// FORMATO 1 (messages.upsert — evento raiz):
//   { event: "messages.upsert", data: { key: { remoteJid, fromMe, id }, message: { conversation } } }
//
// FORMATO 2 (messages.create — objeto aninhado):
//   { data: { object: "messages", action: "create", payload: {
//       body: "quanto devo?",
//       fromMe: false,
//       contact: { number: "5527981657804", name: "Stevens" },
//       ticketId: 8358,
//       ticket: { id: 8358, queueId: 5, userId: null, status: "open" }
//   }}}
//
// FORMATO 3 (tickets.update / tickets.create):
//   { data: { object: "tickets", action: "update", payload: {
//       lastMessage: "quanto devo?",
//       contact: { number: "5527981657804", name: "Stevens" },
//       id: 8358, queueId: 5, userId: 12, status: "open"
//   }}}

interface ExtractedMessage {
  eventType: string;       // messages.upsert | messages.create | tickets.update | unknown
  from: string;            // telefone raw (dígitos)
  text: string;            // texto da mensagem
  messageId: string;       // ID da mensagem ou ticket
  fromMe: boolean;         // se é mensagem da empresa
  ticketId: number | null;
  queueId: number | null;
  userId: number | null;   // NOVO: ID do atendente humano atribuído ao ticket
  ticketStatus: string;    // NOVO: status do ticket (open, pending, closed)
  contactName: string;
  isInbound: boolean;      // se é mensagem inbound que devemos processar
}

function extractMessage(body: ZapContabilPayload): ExtractedMessage {
  const data = body.data || {};
  const objectType = data.object || '';
  const action = data.action || '';
  const payload = data.payload || {};

  // ── FORMATO 2: messages.create (PRIORITÁRIO — payload real confirmado) ──
  if (objectType === 'messages' && action === 'create') {
    const contact = payload.contact || {};
    const fromMe = payload.fromMe === true;
    const ticket = payload.ticket || {};

    let from = 'unknown';
    if (contact.number) {
      from = String(contact.number).replace(/\D/g, '');
    }

    const text = payload.body || '';
    const ticketId = payload.ticketId || ticket.id || null;
    const messageId = payload.id ? `msg-${payload.id}` : (ticketId ? `ticket-${ticketId}` : `wh-${Date.now()}`);
    const queueId = ticket.queueId || payload.queueId || null;
    const userId = ticket.userId || payload.userId || null;
    const ticketStatus = ticket.status || payload.status || '';
    const contactName = contact.name || contact.pushname || 'unknown';

    return {
      eventType: 'messages.create',
      from,
      text: typeof text === 'string' ? text : '',
      messageId,
      fromMe,
      ticketId,
      queueId,
      userId,
      ticketStatus,
      contactName,
      isInbound: !fromMe && from !== 'unknown' && (typeof text === 'string' && text.length > 0),
    };
  }

  // ── FORMATO 1: messages.upsert (evento raiz) ──
  if (body.event === 'messages.upsert') {
    const key = data.key || {};
    const fromMe = key.fromMe === true;
    const ticket = data.ticket || {};

    let from = 'unknown';
    if (key.remoteJid) {
      from = key.remoteJid.replace(/@.*$/, '');
    }

    let text = '';
    if (data.message?.conversation) {
      text = data.message.conversation;
    } else if (data.message?.extendedTextMessage?.text) {
      text = data.message.extendedTextMessage.text;
    } else if (data.message?.imageMessage?.caption) {
      text = data.message.imageMessage.caption;
    }

    const messageId = key.id || `msg-${Date.now()}`;
    const ticketId = ticket.id || null;
    const queueId = ticket.queueId || null;
    const userId = ticket.userId || null;
    const ticketStatus = ticket.status || '';
    const contactName = data.pushName || ticket.contact?.name || 'unknown';

    return {
      eventType: 'messages.upsert',
      from,
      text,
      messageId,
      fromMe,
      ticketId,
      queueId,
      userId,
      ticketStatus,
      contactName,
      isInbound: !fromMe && from !== 'unknown' && text.length > 0,
    };
  }

  // ── FORMATO 3: tickets.update / tickets.create ──
  // NOTA: tickets.update NÃO aciona IA (apenas logar). Pode ter lastMessage repetida.
  if (objectType === 'tickets') {
    const contact = payload.contact || {};

    let from = 'unknown';
    if (contact.number) {
      from = String(contact.number).replace(/\D/g, '');
    } else if (payload.baileysTo) {
      from = String(payload.baileysTo).replace(/@.*$/, '');
    }

    const text = payload.lastMessage || '';
    const ticketId = payload.id || null;
    const messageId = ticketId ? `ticket-${ticketId}` : `wh-${Date.now()}`;
    const queueId = payload.queueId || null;
    const userId = payload.userId || null;
    const ticketStatus = payload.status || '';
    const contactName = contact.name || 'unknown';

    return {
      eventType: `tickets.${action || 'unknown'}`,
      from,
      text: typeof text === 'string' ? text : '',
      messageId,
      fromMe: false,
      ticketId,
      queueId,
      userId,
      ticketStatus,
      contactName,
      // tickets.update NÃO deve acionar IA (isInbound=false para tickets)
      isInbound: false,
    };
  }

  // ── FORMATO DESCONHECIDO: tentar fallbacks genéricos ──
  let from = body.from || body.phone || body.sender || 'unknown';
  let text = body.text || body.body || body.message || '';
  if (typeof text !== 'string') text = '';

  return {
    eventType: body.event || `${objectType}.${action}` || 'unknown',
    from: String(from),
    text,
    messageId: body.messageId || body.id || `wh-${Date.now()}`,
    fromMe: false,
    ticketId: null,
    queueId: null,
    userId: null,
    ticketStatus: '',
    contactName: 'unknown',
    isInbound: from !== 'unknown' && text.length > 0,
  };
}

// ─── RATE LIMIT (1 resposta / 10s por telefone) ──────────────────────────────
const rateLimitMap = new Map<string, number>();

function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const lastSent = rateLimitMap.get(phone);
  if (lastSent && now - lastSent < RATE_LIMIT_MS) {
    return true;
  }
  rateLimitMap.set(phone, now);
  return false;
}

// ─── DEDUP (ticketId + body, janela 2 minutos) ──────────────────────────────
const recentProcessed = new Map<string, number>();

function isDuplicate(dedupKey: string): boolean {
  const now = Date.now();
  // Limpar entradas antigas (> DEDUP_WINDOW_MS)
  const keysToDelete: string[] = [];
  recentProcessed.forEach((ts, key) => {
    if (now - ts > DEDUP_WINDOW_MS) keysToDelete.push(key);
  });
  keysToDelete.forEach(k => recentProcessed.delete(k));
  if (recentProcessed.has(dedupKey)) return true;
  recentProcessed.set(dedupKey, now);
  return false;
}

// ─── MOVER TICKET PARA FILA FINANCEIRO ──────────────────────────────────────
async function moveTicketToFinanceiro(ticketId: number): Promise<boolean> {
  const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
  const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

  if (!ZAP_API_KEY || !ticketId) {
    console.log(`[ZapWebhook] ⚠️ Não foi possível mover ticket: key=${!!ZAP_API_KEY}, ticketId=${ticketId}`);
    return false;
  }

  try {
    const url = `${ZAP_API_URL}/api/ticket/${ticketId}`;
    console.log(`[ZapWebhook] 🔄 Movendo ticket #${ticketId} para fila Financeiro (queueId=${FINANCEIRO_QUEUE_ID})...`);

    const response = await axios.put(
      url,
      { queueId: FINANCEIRO_QUEUE_ID },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    console.log(`[ZapWebhook] ✅ Ticket #${ticketId} movido para Financeiro: HTTP ${response.status}`);
    return true;
  } catch (error: any) {
    console.error(`[ZapWebhook] ❌ Erro ao mover ticket #${ticketId}:`, error.response?.status, error.response?.data || error.message);
    return false;
  }
}

// ─── LOG WEBHOOK RAW ──────────────────────────────────────────────────────────

async function logWebhookRaw(
  provider: string,
  path: string,
  method: string,
  req: Request,
  body: any,
  statusCode: number,
  responseBody: any,
  processingTimeMs: number
): Promise<void> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    const safeHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!['authorization', 'cookie', 'x-api-key'].includes(key.toLowerCase())) {
        safeHeaders[key] = String(value);
      }
    }

    await conn.execute(
      `INSERT INTO webhook_raw_log 
       (provider, path, method, headersJson, bodyJson, ip, userAgent, statusCode, responseJson, processingTimeMs) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        provider,
        path,
        method,
        JSON.stringify(safeHeaders),
        JSON.stringify(body),
        req.ip || req.socket.remoteAddress || 'unknown',
        req.get('user-agent') || 'unknown',
        statusCode,
        JSON.stringify(responseBody),
        processingTimeMs,
      ]
    );

    await conn.end();
  } catch (error) {
    console.error('[ZapWebhook] Erro ao logar webhook:', error);
  }
}

// ─── HANDLER IA INBOUND (FLUXO DEFINITIVO) ──────────────────────────────────
//
// Fluxo:
//   1. Resolver cliente por telefone
//   2. Detectar intent
//   3. Filtrar intent financeiro (saldo, link, negociar, paguei)
//   4. Consultar dívida
//   5. Responder
//   6. Auditar + marcar processed

async function handleInboundWithAI(phoneE164: string, text: string): Promise<void> {
  const correlationId = `ai-inbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`[AI-Inbound] 🔍 Resolvendo cliente para ${phoneE164}...`);
    const client = await resolveClientByPhone(phoneE164);

    if (!client) {
      console.log(`[AI-Inbound] ⚠️ Cliente NÃO encontrado para ${phoneE164}`);
      const safeReply = 'Olá! Não consegui identificar seu cadastro. ' +
        'Poderia informar os últimos 4 dígitos do seu CNPJ ou CPF para que eu possa ajudar?';

      console.log(`[AI-Inbound] 📤 Enviando resposta safe (unknown_client)...`);
      const sendResult = await sendWhatsAppReply(phoneE164, safeReply);
      console.log(`[AI-Inbound] 📤 sendResult:`, JSON.stringify(sendResult));

      await auditAIInteraction({
        fromPhone: phoneE164,
        clientId: null,
        intent: 'unknown_client',
        dbQueryMeta: { resolved: false, sendResult },
        response: safeReply,
        correlationId,
        handoffToHuman: false,
      });
      return;
    }

    console.log(`[AI-Inbound] ✅ Cliente: ${client.clientName} (id=${client.clientId})`);

    const intent = intentDetect(text);
    console.log(`[AI-Inbound] 🎯 Intent: ${intent}`);

    // ── FILTRO DE INTENT FINANCEIRO ──
    // Só responder automaticamente para intents financeiros
    // Intents não financeiros (humano, desconhecido, etc.) → não responder
    if (!isFinancialIntent(intent)) {
      console.log(`[AI-Inbound] ⏭️ SKIPPED_NON_FINANCIAL_INTENT: intent=${intent}`);
      await auditAIInteraction({
        fromPhone: phoneE164,
        clientId: client.clientId,
        intent,
        dbQueryMeta: { decision: 'SKIPPED_NON_FINANCIAL_INTENT', resolved: true },
        response: '',
        correlationId,
        handoffToHuman: intent === 'humano',
      });
      return;
    }

    console.log(`[AI-Inbound] 💰 Buscando dívida para clientId=${client.clientId}...`);
    const debtSummary = await getOpenDebtSummary(client.clientId);
    console.log(`[AI-Inbound] 💰 Debt: total=${debtSummary?.totalDebt || 0}, titles=${debtSummary?.titlesCount || 0}, link=${debtSummary?.paymentLinkCanonical ? 'SIM' : 'NÃO'}`);

    const reply = buildReply(intent, debtSummary);
    console.log(`[AI-Inbound] 📝 Reply (${reply.length} chars): ${reply.substring(0, 80)}...`);

    console.log(`[AI-Inbound] 📤 Enviando via ZapContábil para ${phoneE164}...`);
    const sendResult = await sendWhatsAppReply(phoneE164, reply);
    console.log(`[AI-Inbound] 📤 sendResult:`, JSON.stringify(sendResult));

    // Marcar inbound_messages como processed
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      await conn.execute(
        `UPDATE inbound_messages SET processed = 1 WHERE fromPhone = ? ORDER BY createdAt DESC LIMIT 1`,
        [phoneE164]
      );
      await conn.end();
    } catch (e) {
      console.error(`[AI-Inbound] ⚠️ Erro ao marcar processed:`, e);
    }

    await auditAIInteraction({
      fromPhone: phoneE164,
      clientId: client.clientId,
      intent,
      dbQueryMeta: {
        resolved: true,
        totalDebt: debtSummary?.totalDebt || 0,
        titlesCount: debtSummary?.titlesCount || 0,
        hasPaymentLink: !!debtSummary?.paymentLinkCanonical,
        sendResult,
      },
      response: reply,
      correlationId,
      handoffToHuman: false,
    });

    console.log(`[AI-Inbound] ✅ COMPLETO: ${phoneE164} | intent=${intent} | send=${sendResult.success}`);
  } catch (error: any) {
    console.error(`[AI-Inbound] ❌ Erro:`, error);
    if (error.response) {
      console.error(`[AI-Inbound] ❌ HTTP ${error.response.status}:`, JSON.stringify(error.response.data));
    }

    await auditAIInteraction({
      fromPhone: phoneE164,
      clientId: null,
      intent: 'error',
      dbQueryMeta: {
        error: error.message,
        stack: error.stack?.substring(0, 500),
        httpStatus: error.response?.status,
        httpBody: error.response?.data,
      },
      response: '',
      correlationId,
      handoffToHuman: false,
    }).catch((auditErr) => {
      console.error(`[AI-Inbound] ❌ Falha ao auditar:`, auditErr);
    });
  }
}

// ─── PROCESSAMENTO ASSÍNCRONO (FLUXO DEFINITIVO) ────────────────────────────
//
// Ordem dos gates:
//   1. Validar inbound (fromMe, isInbound)
//   2. Validar telefone
//   3. Normalizar telefone
//   4. Verificar ticket closed → SKIP
//   5. Dedup por ticketId+body (janela 2 min)
//   6. Salvar inbound_messages
//   7. Parar follow-up ativo
//   8. Verificar feature flag
//   9. Verificar whitelist
//  10. Verificar humano ativo (userId != null) → SKIP
//  11. Verificar/mover fila Financeiro
//  12. Rate limit
//  13. ACIONAR IA

async function processInboundAsync(extracted: ExtractedMessage, body: any): Promise<void> {
  let decision: InboundDecision = 'ERROR';
  let phoneNorm: string | null = null;

  try {
    const { from, text, messageId, fromMe, isInbound, eventType, contactName, ticketId, queueId, userId, ticketStatus } = extracted;

    // ── 1. Verificar se é inbound válido ──
    if (!isInbound) {
      decision = fromMe ? 'SKIPPED_FROM_ME' : 'SKIPPED_NOT_INBOUND';
      console.log(`[ZapWebhook] 📋 DECISION:`, {
        fromPhone_raw: from,
        eventType,
        decision,
        reason: fromMe ? 'fromMe=true' : `not inbound (eventType=${eventType}, text.length=${text.length}, from=${from})`,
      });

      // Auditar decisão SKIPPED para tickets (para debug)
      if (eventType.startsWith('tickets.') && from !== 'unknown') {
        phoneNorm = normalizeWhatsApp(from);
        if (phoneNorm) {
          await auditAIInteraction({
            fromPhone: phoneNorm,
            clientId: null,
            intent: 'skipped_ticket_event',
            dbQueryMeta: { eventType, decision, ticketId, queueId, userId, ticketStatus },
            response: '',
            correlationId: `skip-${Date.now()}`,
            handoffToHuman: false,
          }).catch(() => {});
        }
      }
      return;
    }

    // ── 2. Validar telefone ──
    if (!from || from === 'unknown') {
      decision = 'SKIPPED_EMPTY_PHONE';
      console.log(`[ZapWebhook] 📋 DECISION:`, { fromPhone_raw: from, decision });
      return;
    }

    // ── 3. Normalizar telefone ──
    phoneNorm = normalizeWhatsApp(from);

    if (!phoneNorm) {
      decision = 'SKIPPED_INVALID_PHONE';
      console.log(`[ZapWebhook] 📋 DECISION:`, {
        fromPhone_raw: from,
        fromPhone_norm: null,
        decision,
        reason: 'normalizeWhatsApp retornou null',
      });
      return;
    }

    // ── 4. Verificar ticket closed → SKIP ──
    if (ticketStatus === 'closed') {
      decision = 'SKIPPED_TICKET_CLOSED';
      console.log(`[ZapWebhook] 📋 DECISION:`, {
        fromPhone_norm: phoneNorm,
        ticketId,
        ticketStatus,
        decision,
        reason: 'ticket status=closed, IA não responde',
      });
      await auditAIInteraction({
        fromPhone: phoneNorm,
        clientId: null,
        intent: 'skipped',
        dbQueryMeta: { decision, ticketId, ticketStatus },
        response: '',
        correlationId: `skip-closed-${Date.now()}`,
        handoffToHuman: false,
      }).catch(() => {});
      return;
    }

    // ── 5. Dedup por ticketId+body (janela 2 minutos) ──
    const dedupKey = ticketId
      ? `ticket-${ticketId}-${text.substring(0, 50)}`
      : `${phoneNorm}-${text.substring(0, 50)}`;

    if (isDuplicate(dedupKey)) {
      decision = 'SKIPPED_DEDUP';
      console.log(`[ZapWebhook] ⏭️ DEDUP: ${dedupKey} já processado nos últimos ${DEDUP_WINDOW_MS / 1000}s`);
      return;
    }

    // ── 6. Salvar em inbound_messages (SEMPRE para mensagem válida) ──
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      await conn.execute(
        `INSERT INTO inbound_messages (fromPhone, text, messageId, processed) VALUES (?, ?, ?, ?)`,
        [phoneNorm, text || '', messageId, 0]
      );
      await conn.end();
      console.log(`[ZapWebhook] ✅ Inbound salvo: phone=${phoneNorm} | event=${eventType} | ticket=${ticketId} | queue=${queueId} | userId=${userId} | contact=${contactName}`);
    } catch (dbErr: any) {
      console.error(`[ZapWebhook] ❌ Erro ao salvar inbound_messages:`, dbErr.message);
    }

    // ── 7. Parar follow-up ativo ──
    await stopFollowupByPhone(phoneNorm, 'replied').catch(e =>
      console.error(`[ZapWebhook] ⚠️ Erro ao parar followup:`, e.message)
    );

    // ── 8. Verificar feature flag ──
    if (!FEATURE_FLAGS.INBOUND_AI_ENABLED) {
      decision = 'SKIPPED_FLAG_OFF';
      console.log(`[ZapWebhook] 📋 DECISION:`, {
        fromPhone_norm: phoneNorm,
        decision,
        reason: 'INBOUND_AI_ENABLED=false',
      });
      await auditAIInteraction({
        fromPhone: phoneNorm,
        clientId: null,
        intent: 'skipped',
        dbQueryMeta: { decision, reason: 'INBOUND_AI_ENABLED=false' },
        response: '',
        correlationId: `skip-${Date.now()}`,
        handoffToHuman: false,
      }).catch(() => {});
      return;
    }

    // ── 9. Verificar whitelist ──
    if (!isPhoneWhitelisted(phoneNorm)) {
      decision = 'SKIPPED_NOT_WHITELIST';
      console.log(`[ZapWebhook] 📋 DECISION:`, {
        fromPhone_norm: phoneNorm,
        whitelist: process.env.WHATSAPP_AI_WHITELIST || '(não definido)',
        decision,
      });
      await auditAIInteraction({
        fromPhone: phoneNorm,
        clientId: null,
        intent: 'skipped',
        dbQueryMeta: { decision, reason: 'phone not in whitelist' },
        response: '',
        correlationId: `skip-${Date.now()}`,
        handoffToHuman: false,
      }).catch(() => {});
      return;
    }

    // ── 9.5. Verificar OPT-OUT ──
    // Se o cliente enviou "parar", "cancelar", etc., marcar opt-out e confirmar
    if (isOptOutMessage(text)) {
      decision = 'OPT_OUT_CONFIRMED';
      console.log(`[ZapWebhook] 🚫 OPT_OUT: ${phoneNorm} solicitou parar de receber mensagens`);
      await markOptOut(phoneNorm);
      // Enviar confirmação de opt-out
      const optOutReply = 'Entendido! Você não receberá mais mensagens automáticas de cobrança. ' +
        'Caso precise de ajuda no futuro, é só nos chamar. 😊';
      await sendWhatsAppReply(phoneNorm, optOutReply);
      await auditAIInteraction({
        fromPhone: phoneNorm,
        clientId: null,
        intent: 'opt_out',
        dbQueryMeta: { decision, text },
        response: optOutReply,
        correlationId: `optout-${Date.now()}`,
        handoffToHuman: false,
      }).catch(() => {});
      return;
    }

    // ── 9.6. Verificar se cliente está em opt-out (não responder) ──
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      const [optOutRows] = await conn.execute(
        `SELECT optOut FROM clients WHERE whatsappNumber = ? OR phoneCellular = ? OR phone = ? LIMIT 1`,
        [phoneNorm, phoneNorm, phoneNorm]
      );
      await conn.end();
      const clientRow = (optOutRows as any[])[0];
      if (clientRow && clientRow.optOut) {
        decision = 'SKIPPED_OPT_OUT';
        console.log(`[ZapWebhook] 🚫 SKIPPED_OPT_OUT: ${phoneNorm} está em opt-out`);
        await auditAIInteraction({
          fromPhone: phoneNorm,
          clientId: null,
          intent: 'skipped_opt_out',
          dbQueryMeta: { decision },
          response: '',
          correlationId: `skip-optout-${Date.now()}`,
          handoffToHuman: false,
        }).catch(() => {});
        return;
      }
    } catch (e) {
      console.error(`[ZapWebhook] ⚠️ Erro ao verificar opt-out:`, e);
    }

    // ── 10. Verificar humano ativo (userId != null) → SKIP ──
    // Se um atendente humano está atribuído ao ticket, a IA NÃO responde.
    if (userId != null && userId !== 0) {
      decision = 'SKIPPED_HUMAN_ASSIGNED';
      console.log(`[ZapWebhook] 📋 DECISION:`, {
        fromPhone_norm: phoneNorm,
        ticketId,
        userId,
        decision,
        reason: `Humano atribuído (userId=${userId}), IA não responde`,
      });
      await auditAIInteraction({
        fromPhone: phoneNorm,
        clientId: null,
        intent: 'skipped_human_assigned',
        dbQueryMeta: { decision, ticketId, userId, queueId },
        response: '',
        correlationId: `skip-human-${Date.now()}`,
        handoffToHuman: true,
      }).catch(() => {});
      return;
    }

    // ── 11. Verificar/mover fila Financeiro ──
    // Se o ticket não está na fila Financeiro, mover automaticamente.
    // Após mover, continuar processamento normal.
    if (ticketId && queueId !== null && queueId !== FINANCEIRO_QUEUE_ID) {
      console.log(`[ZapWebhook] 🔄 Ticket #${ticketId} está na fila ${queueId}, movendo para Financeiro (${FINANCEIRO_QUEUE_ID})...`);
      const moved = await moveTicketToFinanceiro(ticketId);
      if (moved) {
        console.log(`[ZapWebhook] ✅ Ticket #${ticketId} movido para Financeiro`);
      } else {
        console.log(`[ZapWebhook] ⚠️ Falha ao mover ticket #${ticketId}, continuando mesmo assim`);
      }
      // Continuar processamento independente do resultado da movimentação
    }

    // ── 12. Rate limit ──
    if (isRateLimited(phoneNorm)) {
      decision = 'SKIPPED_RATE_LIMITED';
      console.log(`[ZapWebhook] ⏭️ RATE LIMITED: ${phoneNorm} (1 resp/${RATE_LIMIT_MS / 1000}s)`);
      return;
    }

    // ── 13. ACIONAR IA ──
    decision = 'AI_RAN';
    console.log(`[ZapWebhook] 📋 DECISION:`, {
      fromPhone_norm: phoneNorm,
      decision,
      eventType,
      ticketId,
      queueId,
      userId,
      ticketStatus,
      contactName,
      textPreview: text.substring(0, 50),
    });

    await handleInboundWithAI(phoneNorm, text);

  } catch (error: any) {
    console.error(`[ZapWebhook] ❌ Erro processamento:`, error);
    console.error(`[ZapWebhook] 📋 DECISION (erro):`, {
      fromPhone_raw: extracted.from,
      fromPhone_norm: phoneNorm,
      decision: 'ERROR',
      error: error.message,
    });
    if (phoneNorm) {
      await auditAIInteraction({
        fromPhone: phoneNorm,
        clientId: null,
        intent: 'error',
        dbQueryMeta: { decision: 'ERROR', error: error.message, stack: error.stack?.substring(0, 300) },
        response: '',
        correlationId: `err-${Date.now()}`,
        handoffToHuman: false,
      }).catch(() => {});
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/zap-contabil/messages
 * Modo seguro: sempre retorna 200 { ok: true }
 */
router.post('/messages', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const body = req.body as ZapContabilPayload;

  try {
    // ── EXTRAIR CAMPOS DO PAYLOAD (suporta múltiplos formatos) ──
    const extracted = extractMessage(body);

    console.log('[ZapWebhook] ═══════════════════════════════════════════');
    console.log('[ZapWebhook] 📩 WEBHOOK RECEBIDO');
    console.log('[ZapWebhook] eventType:', extracted.eventType);
    console.log('[ZapWebhook] from:', extracted.from);
    console.log('[ZapWebhook] fromMe:', extracted.fromMe);
    console.log('[ZapWebhook] text:', extracted.text.substring(0, 80));
    console.log('[ZapWebhook] messageId:', extracted.messageId);
    console.log('[ZapWebhook] ticketId:', extracted.ticketId, '| queueId:', extracted.queueId, '| userId:', extracted.userId, '| status:', extracted.ticketStatus);
    console.log('[ZapWebhook] isInbound:', extracted.isInbound);
    console.log('[ZapWebhook] ═══════════════════════════════════════════');

    // Responder imediatamente com 200
    const response = { ok: true };
    res.status(200).json(response);

    // Logar webhook raw (assíncrono)
    logWebhookRaw(
      'zapcontabil',
      '/api/webhook/zap-contabil/messages',
      'POST',
      req,
      body,
      200,
      response,
      Date.now() - startTime
    ).catch((err) => console.error('[ZapWebhook] Erro ao logar:', err));

    // ── INTERCEPTAÇÃO: tickets.update com setor "Nota fiscal" → saudação automática ──
    if (extracted.eventType === 'tickets.update' || extracted.eventType === 'tickets.create') {
      const payload = body?.data?.payload || {};
      const queueName: string = payload.queue?.name || payload.queueName || '';
      const ticketId = payload.id || extracted.ticketId;
      const phone = extracted.from;
      const clientName = extracted.contactName || payload.contact?.name || 'Cliente';
      console.log(`[ZapWebhook] 🎫 Evento de ticket | ticketId: ${ticketId} | setor: "${queueName}" | phone: ${phone}`);
      if (queueName.toLowerCase().includes('nota fiscal') && ticketId && phone && phone !== 'unknown') {
        console.log(`[ZapWebhook] 🔀 Encaminhando para webhook-message-setor (setor Nota Fiscal detectado)`);
        // Encaminhar para o webhook-message-setor com o payload original
        const forwardPayload = {
          data: {
            action: 'update',
            object: 'tickets',
            payload: {
              ...payload,
              id: ticketId,
              queue: { name: queueName, ...payload.queue },
              contact: payload.contact || { number: phone, name: clientName },
            }
          }
        };
        // Forward assíncrono para não bloquear
        const basePort = process.env.PORT || '3000';
        axios.post(`http://localhost:${basePort}/api/zapcontabil/webhook-message-setor`, forwardPayload, {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }).then((resp) => {
          console.log(`[ZapWebhook] ✅ Forward para webhook-message-setor: ${resp.status} ${JSON.stringify(resp.data).substring(0, 100)}`);
        }).catch((err) => {
          console.error(`[ZapWebhook] ❌ Erro no forward para webhook-message-setor: ${err.message}`);
        });
      }
    }

    // Processar inbound (assíncrono)
    processInboundAsync(extracted, body).catch((err) =>
      console.error('[ZapWebhook] Erro no processamento assíncrono:', err)
    );
  } catch (error) {
    console.error('[ZapWebhook] Erro no handler:', error);
    const response = { ok: true };
    logWebhookRaw(
      'zapcontabil', '/api/webhook/zap-contabil/messages', 'POST',
      req, body, 200, response, Date.now() - startTime
    ).catch((err) => console.error('[ZapWebhook] Erro ao logar erro:', err));
    res.status(200).json(response);
  }
});

/**
 * GET /api/webhook/zap-contabil/last?limit=20
 */
router.get('/last', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const safeLimit = Number.isFinite(limit) ? limit : 20;

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [rows] = await conn.execute(
      `SELECT id, provider, path, method, headersJson, bodyJson, ip, userAgent, 
              statusCode, responseJson, processingTimeMs, createdAt
       FROM webhook_raw_log 
       WHERE provider = 'zapcontabil'
       ORDER BY createdAt DESC 
       LIMIT ${safeLimit}`
    );
    await conn.end();

    const parsed = (rows as any[]).map((row) => ({
      ...row,
      headers: row.headersJson ? JSON.parse(row.headersJson) : null,
      body: row.bodyJson ? JSON.parse(row.bodyJson) : null,
      response: row.responseJson ? JSON.parse(row.responseJson) : null,
    }));

    res.status(200).json({ count: parsed.length, data: parsed });
  } catch (error) {
    console.error('[ZapWebhook] Erro ao buscar logs:', error);
    res.status(500).json({
      error: 'Erro ao buscar logs',
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

/**
 * GET /api/webhook/zap-contabil/stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [stats] = await conn.execute(
      `SELECT 
        COUNT(*) as totalReceived,
        COUNT(DISTINCT JSON_EXTRACT(bodyJson, '$.data.payload.contact.number')) as uniquePhones,
        AVG(processingTimeMs) as avgProcessingTimeMs,
        MAX(processingTimeMs) as maxProcessingTimeMs,
        MIN(createdAt) as firstReceivedAt,
        MAX(createdAt) as lastReceivedAt
       FROM webhook_raw_log 
       WHERE provider = 'zapcontabil' 
       AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
    await conn.end();

    res.status(200).json({ stats: (stats as any[])[0] });
  } catch (error) {
    console.error('[ZapWebhook] Erro ao buscar stats:', error);
    res.status(500).json({
      error: 'Erro ao buscar estatísticas',
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

export default router;
