/**
 * 📊 Conta Azul Status Endpoint
 * GET /api/test/e2e/status - Monitoramento operacional completo
 */

import { Router, Request, Response } from 'express';
import { getDb } from './db';
import { whatsappAuditExtended } from './contaAzulCacheSchema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

const router = Router();

interface StatusResponse {
  success: boolean;
  timestamp: string;
  recentSends: Array<{
    createdAt: Date;
    sentAt: Date;
    clientId: number;
    receivableId: number;
    status: string;
    provider: string;
    whatsappMessageId: string | null;
    whatsappAuditId: number | null;
    idempotencyKey: string;
    stepFailed?: string | null;
  }>;
  metrics24h: {
    sent: number;
    failed: number;
    queued: number;
    total: number;
  };
  lastFailure: {
    failedAt: Date | null;
    clientId: number | null;
    receivableId: number | null;
    stepFailed: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    url?: string | null;
  };
  latencyStats: {
    probeAvgMs: number;
    probeP95Ms: number;
    tenantAvgMs: number;
    tenantP95Ms: number;
    pessoasAvgMs: number;
    pessoasP95Ms: number;
    pdfAvgMs: number;
    pdfP95Ms: number;
    zapAvgMs: number;
    zapP95Ms: number;
    auditAvgMs: number;
    auditP95Ms: number;
    totalAvgMs: number;
    totalP95Ms: number;
  };
  health: {
    contaAzulOk: boolean;
    zapContabilOk: boolean;
    systemOk: boolean;
  };
}

/**
 * GET /api/test/e2e/status
 * Retorna status operacional completo
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database connection failed' });
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fiftyItemsAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Últimos 7 dias para ter ~50 itens

    // ========================================
    // PASSO 1: Últimos 20 envios
    // ========================================
    const recentSends = await db
      .select()
      .from(whatsappAuditExtended)
      .orderBy(desc(whatsappAuditExtended.createdAt))
      .limit(20);

    // ========================================
    // PASSO 2: Métricas 24h
    // ========================================
    const audits24h = await db
      .select()
      .from(whatsappAuditExtended)
      .where(
        and(
          gte(whatsappAuditExtended.sentAt, oneDayAgo),
          lte(whatsappAuditExtended.sentAt, now)
        )
      );

    const sent24h = audits24h.filter((a: any) => a.status === 'sent').length;
    const failed24h = audits24h.filter((a: any) => a.status === 'failed').length;
    const queued24h = audits24h.filter((a: any) => a.status === 'queued').length;

    // ========================================
    // PASSO 3: Última falha
    // ========================================
    const failures = audits24h.filter((a: any) => a.status === 'failed');
    const lastFailure = failures.length > 0 ? failures[0] : null;

    // ========================================
    // PASSO 4: Latências (últimas N execuções)
    // ========================================
    const auditsForLatency = await db
      .select()
      .from(whatsappAuditExtended)
      .where(gte(whatsappAuditExtended.sentAt, fiftyItemsAgo))
      .orderBy(desc(whatsappAuditExtended.sentAt))
      .limit(50);

    const latencyStats = calculateLatencyStats(auditsForLatency);

    // ========================================
    // PASSO 5: Health check
    // ========================================
    const contaAzulOk = !lastFailure || lastFailure.stepFailed !== 'probe' && lastFailure.stepFailed !== 'tenant-check';
    const zapContabilOk = !lastFailure || lastFailure.stepFailed !== 'whatsapp';
    const systemOk = contaAzulOk && zapContabilOk;

    const response: StatusResponse = {
      success: true,
      timestamp: now.toISOString(),
      recentSends: recentSends.map((send: any) => ({
        createdAt: send.createdAt,
        sentAt: send.sentAt,
        clientId: send.clientId,
        receivableId: send.receivableId,
        status: send.status,
        provider: send.provider,
        whatsappMessageId: send.messageId,
        whatsappAuditId: send.id,
        idempotencyKey: send.idempotencyKey,
        stepFailed: send.stepFailed,
      })),
      metrics24h: {
        sent: sent24h,
        failed: failed24h,
        queued: queued24h,
        total: audits24h.length,
      },
      lastFailure: {
        failedAt: lastFailure?.sentAt || null,
        clientId: lastFailure?.clientId || null,
        receivableId: lastFailure?.receivableId || null,
        stepFailed: lastFailure?.stepFailed || null,
        errorCode: lastFailure?.errorCode || null,
        errorMessage: lastFailure?.errorMessage || null,
        url: lastFailure?.baseUrlEffective || null,
      },
      latencyStats,
      health: {
        contaAzulOk,
        zapContabilOk,
        systemOk,
      },
    };

    res.json(response);
  } catch (error: any) {
    console.error('[E2EStatus] Error:', error?.message);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * Calcular estatísticas de latência (avg + p95)
 */
function calculateLatencyStats(audits: any[]): StatusResponse['latencyStats'] {
  const probeLatencies: number[] = [];
  const tenantLatencies: number[] = [];
  const pessoasLatencies: number[] = [];
  const pdfLatencies: number[] = [];
  const zapLatencies: number[] = [];
  const auditLatencies: number[] = [];
  const totalLatencies: number[] = [];

  for (const audit of audits) {
    if (audit.probeLatencyMs) probeLatencies.push(audit.probeLatencyMs);
    if (audit.tenantCheckLatencyMs) tenantLatencies.push(audit.tenantCheckLatencyMs);
    if (audit.pessoasLatencyMs) pessoasLatencies.push(audit.pessoasLatencyMs);
    if (audit.pdfLatencyMs) pdfLatencies.push(audit.pdfLatencyMs);
    if (audit.whatsappLatencyMs) zapLatencies.push(audit.whatsappLatencyMs);
    if (audit.totalLatencyMs) {
      auditLatencies.push(audit.totalLatencyMs - (audit.whatsappLatencyMs || 0));
      totalLatencies.push(audit.totalLatencyMs);
    }
  }

  return {
    probeAvgMs: Math.round(average(probeLatencies)),
    probeP95Ms: Math.round(percentile(probeLatencies, 95)),
    tenantAvgMs: Math.round(average(tenantLatencies)),
    tenantP95Ms: Math.round(percentile(tenantLatencies, 95)),
    pessoasAvgMs: Math.round(average(pessoasLatencies)),
    pessoasP95Ms: Math.round(percentile(pessoasLatencies, 95)),
    pdfAvgMs: Math.round(average(pdfLatencies)),
    pdfP95Ms: Math.round(percentile(pdfLatencies, 95)),
    zapAvgMs: Math.round(average(zapLatencies)),
    zapP95Ms: Math.round(percentile(zapLatencies, 95)),
    auditAvgMs: Math.round(average(auditLatencies)),
    auditP95Ms: Math.round(percentile(auditLatencies, 95)),
    totalAvgMs: Math.round(average(totalLatencies)),
    totalP95Ms: Math.round(percentile(totalLatencies, 95)),
  };
}

/**
 * Calcular média
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calcular percentil (ex: p95)
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export default router;
