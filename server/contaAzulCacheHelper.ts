/**
 * 🔄 Conta Azul Cache Helper
 * Funções para cache de probe/tenant-check e idempotência de envios
 */

import { getDb } from './db';
import { contaAzulCache, whatsappAuditExtended } from './contaAzulCacheSchema';
import { eq, and, gte, lte } from 'drizzle-orm';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

/**
 * Obter cache de probe/tenant-check por clientId
 */
export async function getCachedProbeResult(clientId: number) {
  try {
    const db = await getDb();
    if (!db) return null;
    const now = new Date();

    const cached = await db
      .select()
      .from(contaAzulCache)
      .where(
        and(
          eq(contaAzulCache.clientId, clientId),
          gte(contaAzulCache.expiresAt, now)
        )
      )
      .limit(1);

    if (cached.length > 0) {
      const record = cached[0];
      return {
        ok: true,
        baseUrlEffective: record.baseUrlEffective,
        strategyUsed: record.strategyUsed,
        identifiers: record.identifiers ? JSON.parse(record.identifiers) : {},
        cachedAt: record.cachedAt,
        source: 'cache',
      };
    }

    return null;
  } catch (error: any) {
    console.error('[ContaAzulCache] Error getting cached probe:', error?.message);
    return null;
  }
}

/**
 * Salvar cache de probe/tenant-check
 */
export async function setCachedProbeResult(
  clientId: number,
  baseUrlEffective: string,
  strategyUsed: string,
  identifiers: any
) {
  try {
    const db = await getDb();
    if (!db) return;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    // Tentar atualizar primeiro
    const existing = await db
      .select()
      .from(contaAzulCache)
      .where(eq(contaAzulCache.clientId, clientId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(contaAzulCache)
        .set({
          baseUrlEffective,
          strategyUsed,
          identifiers: JSON.stringify(identifiers),
          cachedAt: now,
          expiresAt,
        })
        .where(eq(contaAzulCache.clientId, clientId));
    } else {
      await db.insert(contaAzulCache).values({
        clientId,
        baseUrlEffective,
        strategyUsed,
        identifiers: JSON.stringify(identifiers),
        cachedAt: now,
        expiresAt,
      });
    }

    console.log(`[ContaAzulCache] Cached probe result for clientId=${clientId}, expiresAt=${expiresAt.toISOString()}`);
  } catch (error: any) {
    console.error('[ContaAzulCache] Error setting cache:', error?.message);
  }
}

/**
 * Invalidar cache por clientId
 */
export async function invalidateCacheForClient(clientId: number) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.delete(contaAzulCache).where(eq(contaAzulCache.clientId, clientId));
    console.log(`[ContaAzulCache] Invalidated cache for clientId=${clientId}`);
  } catch (error: any) {
    console.error('[ContaAzulCache] Error invalidating cache:', error?.message);
  }
}

/**
 * Gerar idempotencyKey único
 */
export function generateIdempotencyKey(
  clientId: number,
  receivableId: number,
  templateName: string,
  dueDate: string | Date,
  channel: string = 'zapcontabil'
): string {
  const dueDateStr = typeof dueDate === 'string' ? dueDate : dueDate.toISOString().split('T')[0];
  return `${clientId}:${receivableId}:${templateName}:${dueDateStr}:${channel}`;
}

/**
 * Verificar se já existe envio idempotente
 */
export async function getIdempotentAudit(idempotencyKey: string) {
  try {
    const db = await getDb();
    if (!db) return { found: false, shouldSkip: false };

    const existing = await db
      .select()
      .from(whatsappAuditExtended)
      .where(
        and(
          eq(whatsappAuditExtended.idempotencyKey, idempotencyKey),
          // Buscar sent ou queued (não failed)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const record = existing[0];
      if (record.status === 'sent' || record.status === 'queued') {
        return {
          found: true,
          audit: record,
          shouldSkip: true,
        };
      }
    }

    return { found: false, shouldSkip: false };
  } catch (error: any) {
    console.error('[ContaAzulIdempotency] Error checking idempotent audit:', error?.message);
    return { found: false, shouldSkip: false };
  }
}

/**
 * Registrar auditoria estendida
 */
export async function recordExtendedAudit(data: {
  clientId: number;
  receivableId: number;
  traceId: string;
  idempotencyKey: string;
  messageId?: string | null;
  status: 'sent' | 'failed' | 'queued' | 'error';
  stepFailed?: string;
  errorCode?: string;
  errorMessage?: string;
  probeLatencyMs?: number;
  tenantCheckLatencyMs?: number;
  pessoasLatencyMs?: number;
  bootstrapLatencyMs?: number;
  pdfLatencyMs?: number;
  whatsappLatencyMs?: number;
  totalLatencyMs?: number;
  phoneNumber?: string;
  messageContent?: string;
  pdfUrl?: string;
  provider?: string;
  strategyUsed?: string;
  baseUrlEffective?: string;
}) {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(whatsappAuditExtended).values({
      clientId: data.clientId,
      receivableId: data.receivableId,
      traceId: data.traceId,
      idempotencyKey: data.idempotencyKey,
      messageId: data.messageId || null,
      status: data.status,
      stepFailed: data.stepFailed,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      probeLatencyMs: data.probeLatencyMs,
      tenantCheckLatencyMs: data.tenantCheckLatencyMs,
      pessoasLatencyMs: data.pessoasLatencyMs,
      bootstrapLatencyMs: data.bootstrapLatencyMs,
      pdfLatencyMs: data.pdfLatencyMs,
      whatsappLatencyMs: data.whatsappLatencyMs,
      totalLatencyMs: data.totalLatencyMs,
      phoneNumber: data.phoneNumber,
      messageContent: data.messageContent,
      pdfUrl: data.pdfUrl,
      provider: data.provider,
      strategyUsed: data.strategyUsed,
      baseUrlEffective: data.baseUrlEffective,
      sentAt: new Date(),
    });

    console.log(`[WhatsAppAudit] Recorded extended audit: traceId=${data.traceId}, status=${data.status}`);
  } catch (error: any) {
    console.error('[WhatsAppAudit] Error recording extended audit:', error?.message);
  }
}

/**
 * Obter últimos N envios
 */
export async function getRecentAudits(limit: number = 20) {
  try {
    const db = await getDb();
    if (!db) return [];

    const audits = await db
      .select()
      .from(whatsappAuditExtended)
      .orderBy(whatsappAuditExtended.sentAt)
      .limit(limit);

    return audits;
  } catch (error: any) {
    console.error('[WhatsAppAudit] Error getting recent audits:', error?.message);
    return [];
  }
}

/**
 * Obter estatísticas das últimas 24h
 */
export async function getStats24h() {
  try {
    const db = await getDb();
    if (!db) return null;
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const audits = await db
      .select()
      .from(whatsappAuditExtended)
      .where(
        and(
          gte(whatsappAuditExtended.sentAt, oneDayAgo),
          lte(whatsappAuditExtended.sentAt, now)
        )
      );

    const sent = audits.filter((a: any) => a.status === 'sent').length;
    const failed = audits.filter((a: any) => a.status === 'failed').length;
    const queued = audits.filter((a: any) => a.status === 'queued').length;

    // Calcular latências médias
    const avgProbe = audits.length > 0
      ? audits.reduce((sum: number, a: any) => sum + (a.probeLatencyMs || 0), 0) / audits.length
      : 0;

    const avgTenant = audits.length > 0
      ? audits.reduce((sum: number, a: any) => sum + (a.tenantCheckLatencyMs || 0), 0) / audits.length
      : 0;

    const avgPessoas = audits.length > 0
      ? audits.reduce((sum: number, a: any) => sum + (a.pessoasLatencyMs || 0), 0) / audits.length
      : 0;

    const avgWhatsapp = audits.length > 0
      ? audits.reduce((sum: number, a: any) => sum + (a.whatsappLatencyMs || 0), 0) / audits.length
      : 0;

    const avgTotal = audits.length > 0
      ? audits.reduce((sum: number, a: any) => sum + (a.totalLatencyMs || 0), 0) / audits.length
      : 0;

    // Última falha
    const lastFailure = audits.filter((a: any) => a.status === 'failed').pop();

    return {
      period: '24h',
      sent,
      failed,
      queued,
      total: audits.length,
      avgLatencies: {
        probe: Math.round(avgProbe),
        tenant: Math.round(avgTenant),
        pessoas: Math.round(avgPessoas),
        whatsapp: Math.round(avgWhatsapp),
        total: Math.round(avgTotal),
      },
      lastFailure: lastFailure ? {
        traceId: lastFailure.traceId,
        stepFailed: lastFailure.stepFailed,
        errorCode: lastFailure.errorCode,
        errorMessage: lastFailure.errorMessage,
        sentAt: lastFailure.sentAt,
      } : null,
    };
  } catch (error: any) {
    console.error('[WhatsAppAudit] Error getting stats:', error?.message);
    return null;
  }
}
