/**
 * Régua de Cobrança — Service Principal (PROVA DE FOGO)
 *
 * Fluxo por cliente elegível:
 *   1. Verificar opt-out
 *   2. Verificar WhatsApp válido
 *   3. Verificar quiet hours (REGUA_QUIET_HOURS=18:00-08:00)
 *   4. Verificar dia útil (REGUA_BUSINESS_DAYS_ONLY=true)
 *   5. Verificar humano ativo no ticket (ZapContábil)
 *   6. Filtrar etapas permitidas (REGUA_ALLOWED_STAGES)
 *   7. Verificar dedup (clientId + receivableId + etapa, janela REGUA_DEDUP_MINUTES)
 *   8. Verificar rate limit por telefone (mín 12h entre mensagens)
 *   9. Verificar daily limit (REGUA_DAILY_LIMIT)
 *  10. Montar mensagem
 *  11. Enviar via ZapContábil
 *  12. Adicionar tag IA_COBRANCA + nota interna ao ticket
 *  13. Salvar auditoria em regua_audit
 *
 * Env vars:
 *   REGUA_ENABLED=true
 *   REGUA_DAILY_LIMIT=50             (máximo de envios por dia)
 *   REGUA_ALLOWED_STAGES=d_plus_7,d_plus_15   (etapas ativas na rampa)
 *   REGUA_QUIET_HOURS=18:00-08:00
 *   REGUA_BUSINESS_DAYS_ONLY=true
 *   REGUA_DEDUP_MINUTES=10080        (7 dias)
 *   REGUA_RATE_LIMIT_HOURS=12        (mín 12h entre msgs por telefone)
 *   FINANCEIRO_QUEUE_ID=5
 *   ZAP_CONTABIL_API_URL
 *   ZAP_CONTABIL_API_KEY / WHATSAPP_API_KEY
 */

import mysql from 'mysql2/promise';
import axios from 'axios';
import { normalizeWhatsApp, isValidWhatsAppE164 } from '../collection/normalizeWhatsApp';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type ReguaStage = 'd_minus_3' | 'd_0' | 'd_plus_3' | 'd_plus_7' | 'd_plus_15' | 'd_plus_30' | 'd_plus_45' | 'd_plus_60' | 'd_plus_90' | 'd_plus_180' | 'd_plus_365';

export interface ReguaCandidate {
  clientId: number;
  clientName: string;
  whatsappNumber: string | null;
  billingPhones: string[]; // Telefones adicionais de cobrança (E.164)
  sendConsolidatedDebt: boolean; // Flag para cobrança consolidada
  optOut: boolean;
  receivableId: number;
  amount: string;
  dueDate: Date;
  daysOverdue: number;
  stage: ReguaStage;
  paymentLinkCanonical: string | null;
  link: string | null;
}

export interface ReguaRunResult {
  runId: string;
  dryRun: boolean;
  startedAt: Date;
  finishedAt?: Date;
  totalCandidates: number;
  sent: number;
  skipped: number;
  errors: number;
  dailyLimitReached: boolean;
  entries: ReguaAuditEntry[];
}

export interface ReguaAuditEntry {
  clientId: number;
  receivableId: number;
  stage: ReguaStage;
  status: 'sent' | 'skipped' | 'error' | 'dry_run';
  skipReason?: string;
  phoneE164?: string;
  extraPhones?: string[]; // Telefones adicionais que também receberam a mensagem
  messageContent?: string;
  totalDebt?: number;
  titlesCount?: number;
  maxDaysOverdue?: number;
  providerMessageId?: string;
  providerStatus?: string;
  providerRawResult?: string;
  errorMessage?: string;
  correlationId: string;
  sentAt?: Date;
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// Função para ler REGUA_ENABLED em tempo real (não é constante)
function isReguaEnabled() {
  return process.env.REGUA_ENABLED !== 'false';
}
const REGUA_DAILY_LIMIT = parseInt(process.env.REGUA_DAILY_LIMIT || '50', 10);
const REGUA_DEDUP_MINUTES = parseInt(process.env.REGUA_DEDUP_MINUTES || '10080', 10); // 7 dias
const REGUA_RATE_LIMIT_HOURS = parseInt(process.env.REGUA_RATE_LIMIT_HOURS || '12', 10);
const REGUA_BUSINESS_DAYS_ONLY = process.env.REGUA_BUSINESS_DAYS_ONLY !== 'false'; // default true
const FINANCEIRO_QUEUE_ID = parseInt(process.env.FINANCEIRO_QUEUE_ID || process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO || '5', 10);
const COBRANCA_QUEUE_ID = parseInt(process.env.COBRANCA_QUEUE_ID || '0', 10);
const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

/**
 * Etapas permitidas (configurável via env).
 * Correção estrutural 09/03/2026: Default agora inclui TODOS os estágios.
 * Se quiser restringir, defina REGUA_ALLOWED_STAGES explicitamente.
 */
export function getAllowedStages(): ReguaStage[] {
  const ALL_STAGES = 'd_minus_3,d_0,d_plus_3,d_plus_7,d_plus_15,d_plus_30,d_plus_45,d_plus_60,d_plus_90,d_plus_180,d_plus_365';
  const valid: ReguaStage[] = ['d_minus_3', 'd_0', 'd_plus_3', 'd_plus_7', 'd_plus_15', 'd_plus_30', 'd_plus_45', 'd_plus_60', 'd_plus_90', 'd_plus_180', 'd_plus_365'];
  
  // LEGADO: Se a env contém apenas os 2 estágios antigos (d_plus_7,d_plus_15),
  // tratar como não configurada e usar todos os estágios.
  // Isso garante que deploys antigos não bloqueiem clientes por STAGE_NOT_ALLOWED.
  const LEGACY_VALUE = 'd_plus_7,d_plus_15';
  const envValue = process.env.REGUA_ALLOWED_STAGES?.trim();
  const isLegacyValue = envValue === LEGACY_VALUE || envValue === 'd_plus_15,d_plus_7';
  
  const raw = (!envValue || isLegacyValue) ? ALL_STAGES : envValue;
  
  if (isLegacyValue) {
    console.log('[REGUA] getAllowedStages() -> LEGADO detectado (d_plus_7,d_plus_15), usando ALL_STAGES');
  }
  
  const stages = raw.split(',').map(s => s.trim()).filter(s => valid.includes(s as ReguaStage)) as ReguaStage[];
  console.log('[REGUA] getAllowedStages() -> raw:', raw, '-> parsed:', stages);
  return stages;
}

// ─── QUIET HOURS ─────────────────────────────────────────────────────────────

/**
 * Verificar se o horário atual está dentro das quiet hours.
 * Formato: "18:00-08:00" (pode cruzar meia-noite)
 * Timezone: America/Sao_Paulo
 */
export function isQuietHours(now: Date = new Date()): boolean {
  const raw = process.env.REGUA_QUIET_HOURS || '18:00-08:00';
  const match = raw.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return false;

  const [, startH, startM, endH, endM] = match.map(Number);

  // Converter para horário de Brasília
  const brStr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const timePart = brStr.split(', ')[1] || '';
  const [h, m] = timePart.split(':').map(Number);
  const currentMinutes = h * 60 + m;

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes > endMinutes) {
    // Cruzamento de meia-noite: quiet = 18:00 → 08:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}

/**
 * Verificar se hoje é dia útil (segunda a sexta) no fuso de Brasília
 */
export function isBusinessDay(now: Date = new Date()): boolean {
  const weekday = now.toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
  return !['Sat', 'Sun'].includes(weekday);
}

// ─── DETERMINAR ETAPA ────────────────────────────────────────────────────────

export function determineStage(daysOverdue: number): ReguaStage | null {
  if (daysOverdue >= -3 && daysOverdue < 0) return 'd_minus_3';
  if (daysOverdue === 0) return 'd_0';
  if (daysOverdue >= 1 && daysOverdue <= 3) return 'd_plus_3';
  if (daysOverdue >= 4 && daysOverdue <= 7) return 'd_plus_7';
  if (daysOverdue >= 8 && daysOverdue <= 15) return 'd_plus_15';
  if (daysOverdue >= 16 && daysOverdue <= 30) return 'd_plus_30';
  if (daysOverdue >= 31 && daysOverdue <= 45) return 'd_plus_45';
  if (daysOverdue >= 46 && daysOverdue <= 60) return 'd_plus_60';
  if (daysOverdue >= 61 && daysOverdue <= 90) return 'd_plus_90';
  if (daysOverdue >= 91 && daysOverdue <= 180) return 'd_plus_180';
  if (daysOverdue >= 181) return 'd_plus_365';
  return null;
}

// ─── TEMPLATES DE MENSAGEM ────────────────────────────────────────────────────

export function buildReguaMessage(params: {
  stage: ReguaStage;
  clientName: string;
  totalDebt: number;
  titlesCount: number;
  maxDaysOverdue: number;
  paymentLink: string | null;
  correlationId: string;
}): string {
  const { stage, clientName, totalDebt, titlesCount, maxDaysOverdue, paymentLink, correlationId } = params;
  const firstName = clientName.split(' ')[0];
  const valorFormatado = formatBRL(totalDebt);
  const linkText = paymentLink
    ? `🔗 Link para pagamento:\n${paymentLink}\n(Escolha Pix ou Boleto dentro da página)`
    : '⚠️ Link de pagamento não disponível no momento. Entre em contato para regularizar.';

  switch (stage) {
    case 'd_minus_3':
      return [
        `Olá, ${firstName}!`,
        '',
        `Lembramos que você possui ${titlesCount} título(s) com vencimento em 3 dias, totalizando ${valorFormatado}.`,
        '',
        linkText,
        '',
        'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_0':
      return [
        `Olá, ${firstName}!`,
        '',
        `Seu(s) título(s) vencem hoje. Total: ${valorFormatado} (${titlesCount} título(s)).`,
        '',
        linkText,
        '',
        'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_3':
      return [
        `Olá, ${firstName}.`,
        '',
        `Identificamos que você possui ${titlesCount} título(s) em aberto, totalizando ${valorFormatado}, com ${maxDaysOverdue} dia(s) de atraso.`,
        '',
        linkText,
        '',
        'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_7':
      return [
        `Olá, ${firstName}.`,
        '',
        `Identificamos ${titlesCount} título(s) em aberto totalizando ${valorFormatado}, com ${maxDaysOverdue} dia(s) de atraso.`,
        '',
        'Solicitamos a regularização o mais breve possível para evitar restrições em seu cadastro.',
        '',
        linkText,
        '',
        'Se precisar negociar ou parcelar, responda esta mensagem.',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_15':
      return [
        `📌 Mensagem Consolidada – Valor Total`,
        '',
        `Prezada(o) ${firstName},`,
        '',
        `Identificamos ${titlesCount} título(s) em aberto, totalizando ${valorFormatado}, com atraso de ${maxDaysOverdue} dias.`,
        '',
        'Pedimos que regularize o pagamento em até 5 dias úteis para evitar encaminhamento à cobrança administrativa.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_30':
      return [
        `Prezado(a) ${firstName},`,
        '',
        `Constatamos pendências em aberto no valor total de ${valorFormatado}, com ${titlesCount} título(s) vencido(s), sendo o mais antigo há ${maxDaysOverdue} dias.`,
        '',
        'Solicitamos a regularização imediata para evitar medidas administrativas adicionais.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_45':
      return [
        `Prezado(a) ${firstName},`,
        '',
        `AVISO IMPORTANTE: Constatamos pendências em aberto no valor total de ${valorFormatado}, com ${titlesCount} título(s) vencido(s), sendo o mais antigo há ${maxDaysOverdue} dias.`,
        '',
        'Solicitamos a regularização imediata para evitar medidas administrativas adicionais.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_60':
      return [
        `Prezado(a) ${firstName},`,
        '',
        `⚠️ AVISO ADMINISTRATIVO: Constatamos pendências em aberto no valor total de ${valorFormatado}, com ${titlesCount} título(s) vencido(s), sendo o mais antigo há ${maxDaysOverdue} dias.`,
        '',
        'Solicitamos a regularização imediata para evitar encaminhamento à cobrança administrativa.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_90':
      return [
        `Prezado(a) ${firstName},`,
        '',
        `⚠️ AVISO ADMINISTRATIVO URGENTE: Constatamos pendências em aberto no valor total de ${valorFormatado}, com ${titlesCount} título(s) vencido(s), sendo o mais antigo há ${maxDaysOverdue} dias.`,
        '',
        'Solicitamos a regularização imediata para evitar encaminhamento à cobrança administrativa.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_180':
      return [
        `Prezado(a) ${firstName},`,
        '',
        `⚠️ AVISO ADMINISTRATIVO CRÍTICO: Constatamos pendências em aberto no valor total de ${valorFormatado}, com ${titlesCount} título(s) vencido(s), sendo o mais antigo há ${maxDaysOverdue} dias.`,
        '',
        'Solicitamos a regularização URGENTE para evitar encaminhamento à cobrança administrativa.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');

    case 'd_plus_365':
      return [
        `Prezado(a) ${firstName},`,
        '',
        `⚠️ AVISO ADMINISTRATIVO CRÍTICO: Constatamos pendências em aberto no valor total de ${valorFormatado}, com ${titlesCount} título(s) vencido(s), sendo o mais antigo há ${maxDaysOverdue} dias.`,
        '',
        'Solicitamos a regularização URGENTE para evitar encaminhamento à cobrança administrativa.',
        '',
        linkText,
        '',
        'Caso precise negociar ou parcelar, responda esta mensagem.',
        '',
        'Atenciosamente,',
        'Fraga Contabilidade',
        '',
        `${correlationId}`,
      ].join('\n');
  }
}

// ─── VERIFICAR HUMANO ATIVO NO TICKET ────────────────────────────────────────

export async function checkHumanAssigned(phoneE164: string): Promise<{ hasHuman: boolean; ticketId?: number; userId?: number }> {
  if (!ZAP_API_KEY) return { hasHuman: false };

  try {
    const phoneDigits = phoneE164.replace(/\D/g, '');
    const url = `${ZAP_API_URL}/api/tickets?contact=${phoneDigits}&status=open&limit=1`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${ZAP_API_KEY}` },
      timeout: 8000,
    });

    const tickets = response.data?.data || response.data?.tickets || response.data || [];
    const ticketList = Array.isArray(tickets) ? tickets : [];

    if (ticketList.length === 0) return { hasHuman: false };

    const ticket = ticketList[0];
    const userId = ticket.userId || ticket.user_id || null;
    const hasHuman = userId != null && userId !== 0;

    return { hasHuman, ticketId: ticket.id, userId };
  } catch (error: any) {
    console.warn(`[Régua] ⚠️ Não foi possível verificar humano ativo para ${phoneE164}:`, error.message);
    return { hasHuman: false };
  }
}

// ─── VERIFICAR DEDUP ─────────────────────────────────────────────────────────

export async function checkDedup(clientId: number, receivableId: number, stage: ReguaStage): Promise<boolean> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const dedupWindowMs = REGUA_DEDUP_MINUTES * 60 * 1000;
    const cutoff = new Date(Date.now() - dedupWindowMs);

    const [rows] = await conn.execute(
      `SELECT id FROM regua_audit 
       WHERE clientId = ? AND receivableId = ? AND stage = ? 
         AND status IN ('sent', 'dry_run')
         AND createdAt >= ?
       LIMIT 1`,
      [clientId, receivableId, stage, cutoff]
    );

    await conn.end();
    return (rows as any[]).length > 0;
  } catch (error) {
    console.error('[Régua] Erro ao verificar dedup:', error);
    return false;
  }
}

// ─── RATE LIMIT POR TELEFONE (mín 12h entre mensagens) ──────────────────────

/**
 * Verificar se já foi enviada mensagem para esse telefone nas últimas REGUA_RATE_LIMIT_HOURS horas.
 * Consulta regua_audit por phoneE164 com status='sent'.
 */
export async function checkPhoneRateLimit(phoneE164: string): Promise<boolean> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const cutoffMs = REGUA_RATE_LIMIT_HOURS * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - cutoffMs);

    const [rows] = await conn.execute(
      `SELECT id FROM regua_audit 
       WHERE phoneE164 = ? AND status = 'sent' AND createdAt >= ?
       LIMIT 1`,
      [phoneE164, cutoff]
    );

    await conn.end();
    return (rows as any[]).length > 0;
  } catch (error) {
    console.error('[Régua] Erro ao verificar rate limit:', error);
    return false;
  }
}

// ─── DAILY LIMIT ─────────────────────────────────────────────────────────────

/**
 * Contar quantas mensagens foram enviadas hoje (status='sent').
 */
export async function getDailySentCount(): Promise<number> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM regua_audit 
       WHERE status = 'sent' AND DATE(createdAt) = CURDATE()`
    );
    await conn.end();
    return Number((rows as any[])[0]?.cnt || 0);
  } catch (error) {
    console.error('[Régua] Erro ao contar envios do dia:', error);
    return 0;
  }
}

// ─── SALVAR AUDITORIA ─────────────────────────────────────────────────────────

export async function saveReguaAudit(runId: string, dryRun: boolean, entry: ReguaAuditEntry): Promise<void> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    await conn.execute(
      `INSERT INTO regua_audit 
       (runId, clientId, receivableId, stage, dryRun, status, skipReason, phoneE164, messageContent,
        totalDebt, titlesCount, maxDaysOverdue, providerMessageId, providerStatus, providerRawResult,
        errorMessage, correlationId, sentAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        entry.clientId,
        entry.receivableId,
        entry.stage,
        dryRun,
        entry.status,
        entry.skipReason || null,
        entry.phoneE164 || null,
        entry.messageContent || null,
        entry.totalDebt != null ? Number(entry.totalDebt).toFixed(2) : null,
        entry.titlesCount || null,
        entry.maxDaysOverdue || null,
        entry.providerMessageId || null,
        entry.providerStatus || null,
        entry.providerRawResult || null,
        entry.errorMessage || null,
        entry.correlationId,
        entry.sentAt || null,
      ]
    );
    await conn.end();
  } catch (error) {
    console.error('[Régua] Erro ao salvar auditoria:', error);
  }
}

// ─── BUSCAR TICKET ABERTO NO SETOR COBRANÇA ──────────────────────────────────

/**
 * Busca ticket aberto do cliente no setor Cobrança (COBRANCA_QUEUE_ID).
 * Retorna o ticketId se encontrado, null caso contrário.
 */
async function getOrCreateCobrancaTicket(phoneDigits: string): Promise<number | null> {
  if (COBRANCA_QUEUE_ID <= 0) return null;

  try {
    const res = await axios.get(
      `${ZAP_API_URL}/api/tickets?contact=${phoneDigits}&status=open`,
      { headers: { Authorization: `Bearer ${ZAP_API_KEY}` }, timeout: 8000 }
    );

    const tickets = res.data?.data || res.data?.tickets || res.data || [];
    const ticketList = Array.isArray(tickets) ? tickets : [];

    // Procurar ticket aberto no setor Cobrança
    const cobrancaTicket = ticketList.find(
      (t: any) => (t.queueId || t.queue_id) === COBRANCA_QUEUE_ID
    );

    if (cobrancaTicket?.id) {
      console.log(`[Régua] 🔄 Reutilizando ticket #${cobrancaTicket.id} no setor Cobrança para ${phoneDigits}`);
      return cobrancaTicket.id;
    }

    // Nenhum ticket Cobrança aberto — retorna null para criar via /api/send
    return null;
  } catch (error: any) {
    console.warn(`[Régua] ⚠️ Erro ao buscar ticket Cobrança para ${phoneDigits}:`, error.message);
    return null;
  }
}

// ─── ENVIAR MENSAGEM ─────────────────────────────────────────────────────────

export async function sendReguaMessage(phoneE164: string, message: string): Promise<{
  ok: boolean;
  messageId?: string;
  ticketId?: number;
  providerStatus?: string;
  rawResult?: string;
  error?: string;
}> {
  if (!ZAP_API_KEY) {
    return { ok: false, error: 'ZAP_CONTABIL_API_KEY não configurada' };
  }

  const phoneDigits = phoneE164.replace(/\D/g, '');

  // ── Setor Cobrança: criar ou reutilizar ticket ──
  if (COBRANCA_QUEUE_ID > 0) {
    try {
      const existingTicketId = await getOrCreateCobrancaTicket(phoneDigits);

      if (existingTicketId) {
        // Reutilizar ticket existente no setor Cobrança
        const response = await axios.post(
          `${ZAP_API_URL}/api/messages/${existingTicketId}`,
          { body: message, fromMe: true, read: true },
          {
            headers: {
              Authorization: `Bearer ${ZAP_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );
        const messageId = response.data?.message?.id || response.data?.messageId || response.data?.id || null;
        return {
          ok: true,
          messageId: messageId || `ack_${Date.now()}`,
          ticketId: existingTicketId,
          providerStatus: 'sent',
          rawResult: JSON.stringify(response.data).substring(0, 500),
        };
      }

      // Nenhum ticket Cobrança aberto — criar novo via /api/send com queueId Cobrança
      console.log(`[Régua] 🎫 Criando novo ticket no setor Cobrança (queueId=${COBRANCA_QUEUE_ID}) para ${phoneDigits}`);
      const createResponse = await axios.post(
        `${ZAP_API_URL}/api/send/${phoneDigits}`,
        { body: message, connectionFrom: 0, queueId: COBRANCA_QUEUE_ID },
        {
          headers: {
            Authorization: `Bearer ${ZAP_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      const messageId = createResponse.data?.message?.id || createResponse.data?.messageId || createResponse.data?.id || null;
      const newTicketId = createResponse.data?.ticket?.id || createResponse.data?.ticketId || null;
      if (newTicketId) {
        console.log(`[Régua] ✅ Novo ticket Cobrança criado: #${newTicketId} para ${phoneDigits}`);
      }
      return {
        ok: true,
        messageId: messageId || `ack_${Date.now()}`,
        ticketId: newTicketId || undefined,
        providerStatus: 'sent',
        rawResult: JSON.stringify(createResponse.data).substring(0, 500),
      };
    } catch (error: any) {
      const httpStatus = error.response?.status || 0;
      const errMsg = error.response?.data?.message || error.response?.data?.error || error.message;
      console.error(`[Régua] ❌ Erro ao usar setor Cobrança: HTTP ${httpStatus}: ${errMsg} — usando fallback Financeiro`);
      // Cai no fallback abaixo
    }
  }

  // ── Fallback: fila Financeiro (comportamento original) ──
  try {
    const response = await axios.post(
      `${ZAP_API_URL}/api/send/${phoneDigits}`,
      { body: message, connectionFrom: 0, queueId: FINANCEIRO_QUEUE_ID },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    const messageId = response.data?.message?.id || response.data?.messageId || response.data?.id || null;
    return {
      ok: true,
      messageId: messageId || `ack_${Date.now()}`,
      ticketId: response.data?.ticket?.id || response.data?.ticketId || undefined,
      providerStatus: 'sent',
      rawResult: JSON.stringify(response.data).substring(0, 500),
    };
  } catch (error: any) {
    const httpStatus = error.response?.status || 0;
    const errMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    return {
      ok: false,
      error: `HTTP ${httpStatus}: ${errMsg}`,
      rawResult: JSON.stringify(error.response?.data || {}).substring(0, 500),
    };
  }
}

// ─── TAG + NOTA INTERNA NO TICKET ────────────────────────────────────────────

/**
 * Adicionar tag IA_COBRANCA e nota interna ao ticket do cliente no ZapContábil.
 * Se knownTicketId for fornecido, usa diretamente sem buscar na API.
 */
export async function tagAndNoteTicket(phoneE164: string, stage: ReguaStage, knownTicketId?: number): Promise<void> {
  if (!ZAP_API_KEY) return;

  try {
    const phoneDigits = phoneE164.replace(/\D/g, '');
    let ticketId: number | undefined = knownTicketId;

    if (!ticketId) {
      // Buscar ticket aberto do cliente — preferir setor Cobrança se configurado
      const ticketRes = await axios.get(
        `${ZAP_API_URL}/api/tickets?contact=${phoneDigits}&status=open`,
        { headers: { Authorization: `Bearer ${ZAP_API_KEY}` }, timeout: 8000 }
      );

      const tickets = ticketRes.data?.data || ticketRes.data?.tickets || ticketRes.data || [];
      const ticketList = Array.isArray(tickets) ? tickets : [];
      if (ticketList.length === 0) return;

      // Preferir ticket do setor Cobrança, senão pega o primeiro
      const cobrancaTicket = COBRANCA_QUEUE_ID > 0
        ? ticketList.find((t: any) => (t.queueId || t.queue_id) === COBRANCA_QUEUE_ID)
        : null;
      const ticket = cobrancaTicket || ticketList[0];
      ticketId = ticket.id;
    }

    if (!ticketId) return;

    // 2. Adicionar tag IA_COBRANCA
    try {
      await axios.post(
        `${ZAP_API_URL}/api/ticket/${ticketId}/tags`,
        { tags: ['IA_COBRANCA'] },
        { headers: { Authorization: `Bearer ${ZAP_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
      );
      console.log(`[Régua] 🏷️ Tag IA_COBRANCA adicionada ao ticket #${ticketId}`);
    } catch (tagErr: any) {
      // Tentar formato alternativo
      try {
        await axios.put(
          `${ZAP_API_URL}/api/ticket/${ticketId}`,
          { tags: ['IA_COBRANCA'] },
          { headers: { Authorization: `Bearer ${ZAP_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
        );
        console.log(`[Régua] 🏷️ Tag IA_COBRANCA adicionada via PUT ao ticket #${ticketId}`);
      } catch {
        console.warn(`[Régua] ⚠️ Não foi possível adicionar tag ao ticket #${ticketId}:`, tagErr.message);
      }
    }

    // 3. Adicionar nota interna
    const now = new Date();
    const brDate = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const brTime = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const stageLabel: Record<ReguaStage, string> = {
      'd_minus_3': 'D-3 (3 dias antes do vencimento)',
      'd_0': 'D0 (dia do vencimento)',
      'd_plus_3': 'D+3 (3 dias de atraso)',
      'd_plus_7': 'D+7 (7 dias de atraso)',
      'd_plus_15': 'D+15 (15 dias de atraso)',
      'd_plus_30': 'D+30 (30 dias de atraso)',
      'd_plus_45': 'D+45 (45 dias de atraso)',
      'd_plus_60': 'D+60 (60 dias de atraso)',
      'd_plus_90': 'D+90 (90 dias de atraso)',
      'd_plus_180': 'D+180 (180 dias de atraso)',
      'd_plus_365': 'D+365+ (365+ dias de atraso)',
    };
    const noteBody = `📋 Movido pela Régua IA (etapa ${stageLabel[stage]}) em ${brDate} ${brTime}`;

    try {
      await axios.post(
        `${ZAP_API_URL}/api/ticket/${ticketId}/notes`,
        { body: noteBody },
        { headers: { Authorization: `Bearer ${ZAP_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
      );
      console.log(`[Régua] 📝 Nota interna adicionada ao ticket #${ticketId}`);
    } catch (noteErr: any) {
      // Tentar formato alternativo (mensagem interna)
      try {
        await axios.post(
          `${ZAP_API_URL}/api/messages/${ticketId}`,
          { body: noteBody, internal: true },
          { headers: { Authorization: `Bearer ${ZAP_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
        );
        console.log(`[Régua] 📝 Nota interna (via messages) adicionada ao ticket #${ticketId}`);
      } catch {
        console.warn(`[Régua] ⚠️ Não foi possível adicionar nota ao ticket #${ticketId}:`, noteErr.message);
      }
    }
  } catch (error: any) {
    console.warn(`[Régua] ⚠️ Erro ao adicionar tag/nota para ${phoneE164}:`, error.message);
  }
}

// ─── AUTO-FECHAR TICKET APÓS 10 MINUTOS ──────────────────────────────────────

/**
 * Fechar ticket no ZapContábil via API.
 */
async function closeZapTicket(ticketId: number): Promise<boolean> {
  try {
    await axios.put(
      `${ZAP_API_URL}/api/ticket/${ticketId}`,
      { status: 'closed' },
      { headers: { Authorization: `Bearer ${ZAP_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    console.log(`[Régua] 🔒 Ticket #${ticketId} fechado automaticamente (sem resposta do cliente)`);
    return true;
  } catch (error: any) {
    console.warn(`[Régua] ⚠️ Erro ao fechar ticket #${ticketId}:`, error.message);
    return false;
  }
}

/**
 * Verificar se cliente respondeu no ticket após `afterTimestamp`.
 * Retorna true se houver mensagem inbound (fromMe=false) após o timestamp.
 */
async function clientRespondedAfter(ticketId: number, afterTimestamp: number): Promise<boolean> {
  try {
    const res = await axios.get(
      `${ZAP_API_URL}/api/ticket/${ticketId}/messages`,
      { headers: { Authorization: `Bearer ${ZAP_API_KEY}` }, timeout: 8000 }
    );
    const messages = res.data?.data || res.data?.messages || res.data || [];
    const msgList = Array.isArray(messages) ? messages : [];
    return msgList.some((m: any) => {
      const isInbound = m.fromMe === false || m.from_me === false;
      const msgTime = m.createdAt || m.created_at || m.timestamp;
      const msgTs = msgTime ? new Date(msgTime).getTime() : 0;
      return isInbound && msgTs > afterTimestamp;
    });
  } catch {
    // Se não conseguir verificar, assume que não respondeu
    return false;
  }
}

/**
 * Agendar fechamento automático do ticket após 10 minutos se cliente não responder.
 */
function scheduleTicketAutoClose(ticketId: number): void {
  const sendTimestamp = Date.now();
  const DELAY_MS = 10 * 60 * 1000; // 10 minutos

  setTimeout(async () => {
    try {
      const responded = await clientRespondedAfter(ticketId, sendTimestamp);
      if (responded) {
        console.log(`[Régua] 💬 Cliente respondeu no ticket #${ticketId} — mantendo aberto`);
      } else {
        await closeZapTicket(ticketId);
      }
    } catch (err: any) {
      console.warn(`[Régua] ⚠️ Erro no auto-close do ticket #${ticketId}:`, err.message);
    }
  }, DELAY_MS);

  console.log(`[Régua] ⏱️ Auto-close agendado para ticket #${ticketId} em 10 minutos`);
}

// ─── OPT-OUT ─────────────────────────────────────────────────────────────────

/**
 * Marcar cliente como opt-out no banco.
 * Chamado quando o cliente envia "parar", "cancelar", "sair", etc.
 */
export async function markOptOut(phoneE164: string): Promise<boolean> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [result] = await conn.execute(
      `UPDATE clients SET optOut = 1, updatedAt = NOW() WHERE whatsappNumber = ? OR phoneCellular = ? OR phone = ?`,
      [phoneE164, phoneE164, phoneE164]
    );
    await conn.end();
    const affected = (result as any).affectedRows || 0;
    console.log(`[Régua] 🚫 Opt-out marcado para ${phoneE164}: ${affected} cliente(s) atualizado(s)`);
    return affected > 0;
  } catch (error) {
    console.error('[Régua] Erro ao marcar opt-out:', error);
    return false;
  }
}

/**
 * Verificar se uma mensagem é pedido de opt-out.
 */
export function isOptOutMessage(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const optOutKeywords = ['parar', 'cancelar', 'sair', 'pare', 'não quero', 'nao quero', 'stop', 'remover', 'desinscrever'];
  return optOutKeywords.some(kw => normalized === kw || normalized.startsWith(kw + ' ') || normalized.endsWith(' ' + kw));
}

// ─── BUSCAR CANDIDATOS ────────────────────────────────────────────────────────

export async function fetchReguaCandidates(limit?: number): Promise<ReguaCandidate[]> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const limitClause = limit ? `LIMIT ${parseInt(String(limit), 10)}` : 'LIMIT 500';

    const [rows] = await conn.execute(
      `SELECT 
         r.id AS receivableId,
         r.clientId,
         r.amount,
         r.dueDate,
         r.status,
         r.paymentLinkCanonical,
         r.link,
         c.name AS clientName,
         c.whatsappNumber,
         c.billingPhones,
         c.sendConsolidatedDebt,
         c.optOut,
         DATEDIFF(CURDATE(), DATE(r.dueDate)) AS daysOverdue
       FROM receivables r
       INNER JOIN clients c ON c.id = r.clientId
       WHERE r.status IN ('pending', 'overdue')
         AND r.status NOT IN ('paid', 'cancelled', 'renegotiated')
         AND CAST(r.amount AS DECIMAL(12,2)) > 0
         AND c.whatsappNumber IS NOT NULL
         AND c.whatsappNumber != ''
         AND c.optOut = 0
         AND DATEDIFF(CURDATE(), DATE(r.dueDate)) >= 1
       ORDER BY
         -- Prioridade 1: mês atual com 1-7 dias de atraso (bucket B)
         CASE WHEN YEAR(r.dueDate) = YEAR(CURDATE())
              AND MONTH(r.dueDate) = MONTH(CURDATE())
              AND DATEDIFF(CURDATE(), DATE(r.dueDate)) BETWEEN 1 AND 7 THEN 0 ELSE 1 END ASC,
         -- Prioridade 2: mês atual com 8-15 dias de atraso (bucket C)
         CASE WHEN YEAR(r.dueDate) = YEAR(CURDATE())
              AND MONTH(r.dueDate) = MONTH(CURDATE())
              AND DATEDIFF(CURDATE(), DATE(r.dueDate)) BETWEEN 8 AND 15 THEN 0 ELSE 1 END ASC,
         -- Prioridade 3: mês atual (qualquer atraso)
         CASE WHEN YEAR(r.dueDate) = YEAR(CURDATE())
              AND MONTH(r.dueDate) = MONTH(CURDATE())
              THEN 0 ELSE 1 END ASC,
         -- Prioridade 4: demais (histórico / carteira velha) — mais recentes primeiro
         DATEDIFF(CURDATE(), DATE(r.dueDate)) ASC,
         CAST(r.amount AS DECIMAL(12,2)) DESC
       ${limitClause}`
    );

    await conn.end();

    const candidates: ReguaCandidate[] = [];

    for (const row of rows as any[]) {
      const daysOverdue = Number(row.daysOverdue);
      const stage = determineStage(daysOverdue);
      if (!stage) continue;

      const whatsappNorm = normalizeWhatsApp(row.whatsappNumber);
      if (!whatsappNorm || !isValidWhatsAppE164(whatsappNorm)) continue;

      // Parse billingPhones (JSON array armazenado como TEXT)
      let billingPhones: string[] = [];
      if (row.billingPhones) {
        try {
          const parsed = JSON.parse(row.billingPhones);
          if (Array.isArray(parsed)) {
            billingPhones = parsed
              .map((p: string) => normalizeWhatsApp(p))
              .filter((p): p is string => !!p && isValidWhatsAppE164(p))
              .filter(p => p !== whatsappNorm); // Remover duplicatas do principal
          }
        } catch {
          // billingPhones inválido — ignorar
        }
      }

      candidates.push({
        clientId: row.clientId,
        clientName: row.clientName,
        whatsappNumber: whatsappNorm,
        billingPhones,
        sendConsolidatedDebt: row.sendConsolidatedDebt !== 0, // MySQL retorna 0/1
        optOut: !!row.optOut,
        receivableId: row.receivableId,
        amount: String(row.amount),
        dueDate: new Date(row.dueDate),
        daysOverdue,
        stage,
        paymentLinkCanonical: row.paymentLinkCanonical || null,
        link: row.link || null,
      });
    }

    return candidates;
  } catch (error) {
    await conn.end();
    throw error;
  }
}

// ─── CONSOLIDAR CANDIDATOS POR CLIENTE ───────────────────────────────────────

interface ClientDebtSummary {
  clientId: number;
  clientName: string;
  whatsappNumber: string;
  billingPhones: string[]; // Telefones adicionais de cobrança
  sendConsolidatedDebt: boolean;
  totalDebt: number;
  titlesCount: number;
  maxDaysOverdue: number;
  stage: ReguaStage;
  paymentLink: string | null;
  receivables: Array<{ receivableId: number; amount: number; daysOverdue: number; stage: ReguaStage }>;
}

export function consolidateCandidates(candidates: ReguaCandidate[]): ClientDebtSummary[] {
  const byClient = new Map<number, ClientDebtSummary>();

  for (const c of candidates) {
    const amount = parseFloat(c.amount) || 0;
    if (!byClient.has(c.clientId)) {
      byClient.set(c.clientId, {
        clientId: c.clientId,
        clientName: c.clientName,
        whatsappNumber: c.whatsappNumber!,
        billingPhones: c.billingPhones || [],
        sendConsolidatedDebt: c.sendConsolidatedDebt,
        totalDebt: 0,
        titlesCount: 0,
        maxDaysOverdue: 0,
        stage: c.stage,
        paymentLink: c.paymentLinkCanonical || c.link || null,
        receivables: [],
      });
    } else {
      // Mesclar billingPhones de candidatos do mesmo cliente (caso haja duplicatas)
      const existing = byClient.get(c.clientId)!;
      for (const bp of (c.billingPhones || [])) {
        if (!existing.billingPhones.includes(bp)) {
          existing.billingPhones.push(bp);
        }
      }
    }

    const summary = byClient.get(c.clientId)!;
    summary.totalDebt += amount;
    summary.titlesCount += 1;
    summary.maxDaysOverdue = Math.max(summary.maxDaysOverdue, c.daysOverdue);
    summary.receivables.push({
      receivableId: c.receivableId,
      amount,
      daysOverdue: c.daysOverdue,
      stage: c.stage,
    });

    // Usar o link do título mais antigo (maior atraso) como link principal
    if (c.daysOverdue >= summary.maxDaysOverdue && (c.paymentLinkCanonical || c.link)) {
      summary.paymentLink = c.paymentLinkCanonical || c.link || summary.paymentLink;
    }

    // Priorização de stage: mês atual tem precedência sobre histórico.
    // Se o candidato atual é do mês corrente e o stage atual não é do mês corrente,
    // usar o stage do mês atual (mesmo que seja "menor").
    // Caso contrário, usar a etapa mais avançada (maior atraso) — comportamento original.
    const stageOrder: Record<ReguaStage, number> = {
      'd_minus_3': 0, 'd_0': 1, 'd_plus_3': 2, 'd_plus_7': 3, 'd_plus_15': 4, 'd_plus_30': 5, 'd_plus_45': 6, 'd_plus_60': 7, 'd_plus_90': 8, 'd_plus_180': 9, 'd_plus_365': 10,
    };
    const now = new Date();
    const isCurrentMonthCandidate =
      c.dueDate.getFullYear() === now.getFullYear() &&
      c.dueDate.getMonth() === now.getMonth();
    const isCurrentMonthSummary =
      summary.receivables.some(r => {
        // Não temos dueDate no receivable summary, mas podemos inferir pelo daysOverdue
        // Se daysOverdue <= 31 e stage <= d_plus_30, provavelmente é do mês atual
        return r.daysOverdue <= 31;
      });
    if (isCurrentMonthCandidate && !isCurrentMonthSummary) {
      // Candidato do mês atual substitui stage histórico
      summary.stage = c.stage;
    } else if (!isCurrentMonthCandidate && isCurrentMonthSummary) {
      // Manter stage do mês atual — não sobrescrever com histórico
    } else if (stageOrder[c.stage] > stageOrder[summary.stage]) {
      // Ambos do mesmo período: usar o mais avançado
      summary.stage = c.stage;
    }
  }

  return Array.from(byClient.values());
}

// ─── EXECUTAR RÉGUA ───────────────────────────────────────────────────────────

export async function runRegua(dryRun: boolean = false, limit?: number): Promise<ReguaRunResult> {
  const runId = `regua-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();

  console.log(`[Régua] 🚀 Iniciando runId=${runId} | dryRun=${dryRun} | limit=${limit || 'sem limite'}`);

  const result: ReguaRunResult = {
    runId,
    dryRun,
    startedAt,
    totalCandidates: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
    dailyLimitReached: false,
    entries: [],
  };

  // ── Verificar se régua está habilitada ──
  // [DIAGNÓSTICO] Logar o valor exato lido do process.env
  console.log('[Régua-DIAG] process.env.REGUA_ENABLED raw:', JSON.stringify(process.env.REGUA_ENABLED));
  console.log('[Régua-DIAG] isReguaEnabled():', isReguaEnabled());
  console.log('[Régua-DIAG] dryRun:', dryRun);
  console.log('[Régua-DIAG] bloquear:', !isReguaEnabled() && !dryRun);
  if (!isReguaEnabled() && !dryRun) {
    console.log('[Régua] ⚠️ REGUA_ENABLED=false, abortando');
    result.finishedAt = new Date();
    return result;
  }

  // ── Verificar quiet hours ──
  if (isQuietHours()) {
    console.log('[Régua] 🌙 Quiet hours ativas (18:00-08:00), abortando');
    result.finishedAt = new Date();
    return result;
  }

  // ── Verificar dia útil ──
  if (REGUA_BUSINESS_DAYS_ONLY && !isBusinessDay()) {
    console.log('[Régua] 📅 Fim de semana (REGUA_BUSINESS_DAYS_ONLY=true), abortando');
    result.finishedAt = new Date();
    return result;
  }

  // ── Verificar daily limit ──
  const dailySent = await getDailySentCount();
  const dailyRemaining = Math.max(0, REGUA_DAILY_LIMIT - dailySent);
  console.log(`[Régua] 📊 Envios hoje: ${dailySent}/${REGUA_DAILY_LIMIT} (restam ${dailyRemaining})`);

  if (dailyRemaining === 0 && !dryRun) {
    console.log('[Régua] 🛑 DAILY_LIMIT atingido, abortando');
    result.dailyLimitReached = true;
    result.finishedAt = new Date();
    return result;
  }

  // ── Etapas permitidas ──
  const allowedStages = getAllowedStages();
  console.log(`[Régua] 📋 Etapas permitidas: ${allowedStages.join(', ')}`);

  // ── Buscar candidatos ──
  let candidates: ReguaCandidate[];
  try {
    candidates = await fetchReguaCandidates(limit);
    console.log(`[Régua] 📋 ${candidates.length} candidatos encontrados`);
  } catch (error: any) {
    console.error('[Régua] ❌ Erro ao buscar candidatos:', error.message);
    result.finishedAt = new Date();
    result.errors = 1;
    return result;
  }

  // ── Consolidar por cliente ──
  const clientSummaries = consolidateCandidates(candidates);
  result.totalCandidates = clientSummaries.length;

  console.log(`[Régua] 👥 ${clientSummaries.length} clientes únicos para processar`);

  let sentThisRun = 0;

  // ── Processar cada cliente ──
  for (const summary of clientSummaries) {
    const { clientId, clientName, whatsappNumber, totalDebt, titlesCount, maxDaysOverdue, stage, paymentLink } = summary;

    const primaryReceivable = summary.receivables.reduce((prev, curr) =>
      curr.daysOverdue > prev.daysOverdue ? curr : prev
    );
    const receivableId = primaryReceivable.receivableId;

    const correlationId = `regua-${runId}-${clientId}-${receivableId}-${stage}`;

    console.log(`[Régua] 🔍 Processando clientId=${clientId} | stage=${stage} | total=${formatBRL(totalDebt)}`);

    // ── Filtrar etapas permitidas ──
    if (!allowedStages.includes(stage)) {
      console.log(`[Régua] ⏭️ SKIPPED_STAGE_NOT_ALLOWED: clientId=${clientId}, stage=${stage}, allowed=${allowedStages.join(',')}`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'skipped',
        skipReason: 'STAGE_NOT_ALLOWED',
        phoneE164: whatsappNumber,
        totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.skipped++;
      continue;
    }

    // ── Verificar dedup ──
    const isDup = await checkDedup(clientId, receivableId, stage);
    if (isDup) {
      console.log(`[Régua] ⏭️ DEDUP: clientId=${clientId}, receivableId=${receivableId}, stage=${stage}`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'skipped',
        skipReason: 'DEDUP',
        phoneE164: whatsappNumber,
        totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.skipped++;
      continue;
    }

    // ── Verificar rate limit por telefone (12h) ──
    const isRateLimited = await checkPhoneRateLimit(whatsappNumber);
    if (isRateLimited && !dryRun) {
      console.log(`[Régua] ⏭️ RATE_LIMITED: phone=${whatsappNumber} (mín ${REGUA_RATE_LIMIT_HOURS}h entre msgs)`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'skipped',
        skipReason: 'RATE_LIMITED',
        phoneE164: whatsappNumber,
        totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.skipped++;
      continue;
    }

    // ── Verificar humano ativo ──
    const humanCheck = await checkHumanAssigned(whatsappNumber);
    if (humanCheck.hasHuman) {
      console.log(`[Régua] 👤 SKIPPED_HUMAN_ASSIGNED: clientId=${clientId}, ticketId=${humanCheck.ticketId}, userId=${humanCheck.userId}`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'skipped',
        skipReason: 'HUMAN_ASSIGNED',
        phoneE164: whatsappNumber,
        totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.skipped++;
      continue;
    }

    // ── Verificar daily limit (dentro do loop) ──
    if (sentThisRun >= dailyRemaining && !dryRun) {
      console.log(`[Régua] 🛑 DAILY_LIMIT atingido durante execução (${sentThisRun + dailySent}/${REGUA_DAILY_LIMIT})`);
      result.dailyLimitReached = true;
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'skipped',
        skipReason: 'DAILY_LIMIT',
        phoneE164: whatsappNumber,
        totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.skipped++;
      continue;
    }

    // ── VALIDACAO EM TEMPO REAL (Conta Azul) ──
    // Importar aqui para evitar circular dependency
    const { validateReceivableRealtime, logValidationResult } = await import('./realtimeValidationService');
    const validationResult = await validateReceivableRealtime(receivableId, clientId, summary.receivables[0].receivableId.toString());

    if (!validationResult.isValid) {
      console.log(`[Régua] 🛑 REALTIME_ABORT: clientId=${clientId} | reason=${validationResult.reason}`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'skipped',
        skipReason: validationResult.reason as any,
        phoneE164: whatsappNumber,
        totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      await logValidationResult(runId, validationResult, whatsappNumber);
      result.entries.push(entry);
      result.skipped++;
      continue;
    }

    // ── Montar mensagem ──
    const messageContent = buildReguaMessage({
      stage, clientName, totalDebt, titlesCount, maxDaysOverdue, paymentLink, correlationId,
    });

    // ── Determinar todos os telefones de destino ──
    const allPhones: string[] = [whatsappNumber];
    if (summary.sendConsolidatedDebt && summary.billingPhones.length > 0) {
      allPhones.push(...summary.billingPhones);
    }

    // ── DryRun: simular sem enviar ──
    if (dryRun) {
      console.log(`[Régua] 🧪 DRY_RUN: clientId=${clientId} | stage=${stage} | phones=${allPhones.join(',')}`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'dry_run',
        phoneE164: whatsappNumber,
        extraPhones: summary.billingPhones.length > 0 ? summary.billingPhones : undefined,
        messageContent, totalDebt, titlesCount, maxDaysOverdue,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.sent++;
      continue;
    }

    // ── Enviar mensagem para o telefone principal ──
    const sendResult = await sendReguaMessage(whatsappNumber, messageContent);

    if (sendResult.ok) {
      console.log(`[Régua] ✅ SENT: clientId=${clientId} | stage=${stage} | msgId=${sendResult.messageId} | phones=${allPhones.length}`);
      sentThisRun++;

      // ── Enviar para telefones adicionais (billingPhones) ──
      const extraResults: Array<{ phone: string; ok: boolean; messageId?: string; error?: string }> = [];
      for (const extraPhone of summary.billingPhones) {
        try {
          const extraResult = await sendReguaMessage(extraPhone, messageContent);
          extraResults.push({ phone: extraPhone, ok: extraResult.ok, messageId: extraResult.messageId, error: extraResult.error });
          if (extraResult.ok) {
            console.log(`[Régua] ✅ SENT_EXTRA: clientId=${clientId} | phone=${extraPhone} | msgId=${extraResult.messageId}`);
          } else {
            console.warn(`[Régua] ⚠️ EXTRA_PHONE_ERROR: clientId=${clientId} | phone=${extraPhone} | error=${extraResult.error}`);
          }
        } catch (err: any) {
          console.warn(`[Régua] ⚠️ EXTRA_PHONE_EXCEPTION: clientId=${clientId} | phone=${extraPhone} | error=${err.message}`);
          extraResults.push({ phone: extraPhone, ok: false, error: err.message });
        }
      }

      // ── Registrar 1 audit consolidado (telefone principal + extraPhones no log) ──
      const extraPhonesLog = extraResults.length > 0
        ? JSON.stringify(extraResults)
        : undefined;

      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'sent',
        phoneE164: whatsappNumber,
        extraPhones: summary.billingPhones.length > 0 ? summary.billingPhones : undefined,
        messageContent, totalDebt, titlesCount, maxDaysOverdue,
        providerMessageId: sendResult.messageId,
        providerStatus: sendResult.providerStatus,
        providerRawResult: extraPhonesLog
          ? `${sendResult.rawResult || ''} | extraPhones: ${extraPhonesLog}`
          : sendResult.rawResult,
        correlationId,
        sentAt: new Date(),
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.sent++;

      // ── Tag + nota interna (assíncrono, não bloqueia) ──
      tagAndNoteTicket(whatsappNumber, stage, sendResult.ticketId).catch(err =>
        console.warn(`[Régua] ⚠️ Erro ao adicionar tag/nota:`, err.message)
      );

      // ── Auto-fechar ticket após 10 min se cliente não responder ──
      if (sendResult.ticketId) {
        scheduleTicketAutoClose(sendResult.ticketId);
      }
    } else {
      console.error(`[Régua] ❌ ERROR: clientId=${clientId} | stage=${stage} | error=${sendResult.error}`);
      const entry: ReguaAuditEntry = {
        clientId, receivableId, stage,
        status: 'error',
        phoneE164: whatsappNumber,
        messageContent, totalDebt, titlesCount, maxDaysOverdue,
        providerRawResult: sendResult.rawResult,
        errorMessage: sendResult.error,
        correlationId,
      };
      await saveReguaAudit(runId, dryRun, entry);
      result.entries.push(entry);
      result.errors++;
    }
  }

  result.finishedAt = new Date();
  const duration = result.finishedAt.getTime() - startedAt.getTime();

  console.log(`[Régua] 🏁 Concluído runId=${runId} | ${result.sent} enviados | ${result.skipped} pulados | ${result.errors} erros | dailyLimit=${result.dailyLimitReached} | ${duration}ms`);

  return result;
}
