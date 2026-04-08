/**
 * SAFETY CAP — Limite diário de envios para evitar explosão
 * 
 * Objetivo: Garantir que o sistema nunca envie mais de 60 mensagens por dia útil
 * 
 * IMPORTANTE: Usa timezone America/Sao_Paulo para calcular "início do dia"
 * Isso garante que o cap reseta à meia-noite de Brasília, não UTC.
 */

import { getDb } from '../db';
import { whatsappAudit } from '../../drizzle/schema';
import { gte, and, eq } from 'drizzle-orm';

const MAX_DAILY_TOTAL = 60; // B=30, C=20, D=10

export interface DailyUsageResult {
  ok: boolean;
  sentToday: number;
  remaining: number;
  maxDaily: number;
  exceeded: boolean;
  message: string;
}

/**
 * Calcula o início do dia em São Paulo (UTC-3) e retorna como Date UTC
 * Ex: Se agora é 2026-02-25 02:00 UTC (= 2026-02-24 23:00 SP)
 *     → início do dia SP = 2026-02-24 00:00 SP = 2026-02-24 03:00 UTC
 */
function getStartOfDaySaoPaulo(): Date {
  const now = new Date();
  
  // Formatar a data atual no timezone de São Paulo
  const spFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  // Resultado: "2026-02-24" (data em São Paulo)
  const spDateStr = spFormatter.format(now);
  
  // Obter o offset atual de São Paulo (lida com horário de verão)
  const spHourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    timeZoneName: 'shortOffset',
  });
  const parts = spHourFormatter.formatToParts(now);
  const tzOffset = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-3';
  
  // Converter offset "GMT-3" para "-03:00"
  const offsetMatch = tzOffset.match(/GMT([+-])(\d+)/);
  let isoOffset = '-03:00'; // fallback
  if (offsetMatch) {
    const sign = offsetMatch[1];
    const hours = offsetMatch[2].padStart(2, '0');
    isoOffset = `${sign}${hours}:00`;
  }
  
  const startOfDayISO = `${spDateStr}T00:00:00${isoOffset}`;
  return new Date(startOfDayISO);
}

/**
 * Verificar quantas mensagens foram enviadas hoje (timezone São Paulo)
 * 
 * Considera apenas status 'sent' (não conta 'failed' ou 'skipped')
 */
export async function checkDailyUsage(): Promise<DailyUsageResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    const startOfDay = getStartOfDaySaoPaulo();
    
    console.log(`[SafetyCap] Verificando uso diário desde ${startOfDay.toISOString()} (meia-noite SP)...`);
    
    // Contar mensagens enviadas hoje (status='sent')
    const sentToday = await db
      .select({ count: whatsappAudit.id })
      .from(whatsappAudit)
      .where(
        and(
          gte(whatsappAudit.sentAt, startOfDay),
          eq(whatsappAudit.status, 'sent')
        )
      )
      .then(rows => rows.length);
    
    const remaining = Math.max(0, MAX_DAILY_TOTAL - sentToday);
    const exceeded = sentToday >= MAX_DAILY_TOTAL;
    
    console.log(`[SafetyCap] Uso diário: ${sentToday}/${MAX_DAILY_TOTAL} (${remaining} restantes)`);
    
    if (exceeded) {
      console.error(`[SafetyCap] ❌ LIMITE DIÁRIO EXCEDIDO: ${sentToday}/${MAX_DAILY_TOTAL}`);
      return {
        ok: false,
        sentToday,
        remaining: 0,
        maxDaily: MAX_DAILY_TOTAL,
        exceeded: true,
        message: `Limite diário excedido: ${sentToday}/${MAX_DAILY_TOTAL}`,
      };
    }
    
    return {
      ok: true,
      sentToday,
      remaining,
      maxDaily: MAX_DAILY_TOTAL,
      exceeded: false,
      message: `Uso diário OK: ${sentToday}/${MAX_DAILY_TOTAL} (${remaining} restantes)`,
    };
    
  } catch (error: any) {
    console.error('[SafetyCap] ❌ Erro ao verificar uso diário:', error.message);
    return {
      ok: false,
      sentToday: 0,
      remaining: 0,
      maxDaily: MAX_DAILY_TOTAL,
      exceeded: false,
      message: `Erro ao verificar uso diário: ${error.message}`,
    };
  }
}

/**
 * Verificar se ainda há espaço para enviar N mensagens
 */
export async function canSendN(n: number): Promise<boolean> {
  const usage = await checkDailyUsage();
  return usage.ok && usage.remaining >= n;
}
