/**
 * 📊 Dashboard Metrics Router
 * GET /api/dashboard/metrics
 * 
 * Retorna métricas reais do DB sincronizado com Conta Azul
 * Cada métrica inclui: source, lastSyncAt, traceId
 * 
 * Nunca retorna dados fictícios - se não tiver sync, retorna { ok: false, reason: "NOT_SYNCED" }
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { getDb } from './db';
import { clients, receivables, contaAzulTokens } from '../drizzle/schema';
import { count, eq, and, gte, lte, desc } from 'drizzle-orm';

const router = Router();

interface DashboardMetrics {
  ok: boolean;
  traceId: string;
  timestamp: string;
  source: string;
  lastSyncAt: string | null;
  tenantId: string | null;
  reason?: string;
  metrics?: {
    totalClients: number;
    activeClients: number;
    totalReceivables: number;
    overdueReceivables: number;
    totalOverdueAmount: number;
    averageOverdueDays: number;
  };
}

/**
 * GET /api/dashboard/metrics
 * Retorna métricas reais com rastreabilidade completa
 */
router.get('/', async (req: Request, res: Response) => {
  const traceId = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();

  try {
    console.log(`[DashboardMetrics] GET /api/dashboard/metrics (traceId=${traceId})`);

    const db = await getDb();
    if (!db) {
      console.error(`[DashboardMetrics] DB not available (traceId=${traceId})`);
    return res.status(503).json({
      ok: false,
      traceId,
      timestamp,
      source: 'DB',
      lastSyncAt: null,
      tenantId: null,
      reason: 'DB_NOT_AVAILABLE',
      message: 'Database connection unavailable',
    } as DashboardMetrics);
    }

    // Verificar se há token OAuth válido (indica que Conta Azul foi sincronizado)
    const tokenRecord = await db
      .select()
      .from(contaAzulTokens)
      .limit(1);

    if (!tokenRecord.length) {
      console.warn(`[DashboardMetrics] No OAuth token found - NOT_SYNCED (traceId=${traceId})`);
      return res.status(200).json({
        ok: false,
        traceId,
        timestamp,
        source: 'DB',
        lastSyncAt: null,
        tenantId: null,
        reason: 'NOT_SYNCED',
        message: 'Conta Azul not connected. Please authenticate via /api/test/conta-azul/auth-url',
      } as DashboardMetrics);
    }

    const token = tokenRecord[0];
    const lastSyncAt = token.updatedAt?.toISOString() || token.createdAt?.toISOString() || null;

    console.log(`[DashboardMetrics] Token found, lastSyncAt=${lastSyncAt} (traceId=${traceId})`);

    // Buscar métricas do DB
    const totalClientsResult = await db
      .select({ count: count() })
      .from(clients);
    const totalClients = totalClientsResult[0]?.count || 0;

    // Clientes ativos (com receivables recentes)
    const activeClientsResult = await db
      .select({ count: count() })
      .from(clients);
    const activeClients = activeClientsResult[0]?.count || 0; // TODO: filtrar por receivables recentes

    const totalReceivablesResult = await db
      .select({ count: count() })
      .from(receivables);
    const totalReceivables = totalReceivablesResult[0]?.count || 0;

    // Receivables vencidas (status = 'overdue')
    const overdueReceivablesResult = await db
      .select({ count: count() })
      .from(receivables)
      .where(eq(receivables.status, 'overdue'));
    const overdueReceivables = overdueReceivablesResult[0]?.count || 0;

    // Total de valor em atraso
    const overdueAmountResult = await db
      .select({
        total: receivables.amount,
      })
      .from(receivables)
      .where(eq(receivables.status, 'overdue'));

    const totalOverdueAmount = overdueAmountResult.reduce((sum, row) => {
      return sum + (row.total ? parseFloat(row.total.toString()) : 0);
    }, 0);

    // Média de dias em atraso
    const now = new Date();
    const overdueWithDays = await db
      .select({
        dueDate: receivables.dueDate,
      })
      .from(receivables)
      .where(eq(receivables.status, 'overdue'));

    const averageOverdueDays =
      overdueWithDays.length > 0
        ? Math.round(
            overdueWithDays.reduce((sum, row) => {
              if (!row.dueDate) return sum;
              const daysOverdue = Math.floor(
                (now.getTime() - new Date(row.dueDate).getTime()) / (1000 * 60 * 60 * 24)
              );
              return sum + daysOverdue;
            }, 0) / overdueWithDays.length
          )
        : 0;

    const metrics: DashboardMetrics = {
      ok: true,
      traceId,
      timestamp,
      source: 'DB (Conta Azul)',
      lastSyncAt,
      tenantId: null, // TODO: obter tenantId do token ou de outra tabela
      metrics: {
        totalClients,
        activeClients,
        totalReceivables,
        overdueReceivables,
        totalOverdueAmount,
        averageOverdueDays,
      },
    };

    console.log(`[DashboardMetrics] Success (traceId=${traceId})`, metrics);
    return res.status(200).json(metrics);
  } catch (error: any) {
    console.error(`[DashboardMetrics] Error (traceId=${traceId}):`, error.message);
    return res.status(500).json({
      ok: false,
      traceId,
      timestamp,
      source: 'DB',
      lastSyncAt: null,
      tenantId: null,
      reason: 'INTERNAL_ERROR',
      message: error.message,
    } as DashboardMetrics);
  }
});

export default router;
