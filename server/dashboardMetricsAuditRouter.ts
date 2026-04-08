import { Router, Request, Response } from 'express';
import { getDb } from './db';
import { clients, receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const router = Router();

/**
 * GET /api/dashboard/metrics/audit
 * Retorna métricas com prova de origem auditável
 * 
 * Response:
 * {
 *   ok: true,
 *   source: "db" | "contaazul",
 *   lastSyncAt: ISO timestamp,
 *   traceId: UUID,
 *   evidence: [{ type, id, value }],
 *   counts: { clients, receivables, overdue, pending, paid },
 *   metrics: { ... }
 * }
 */
router.get('/metrics/audit', async (req: Request, res: Response) => {
  const traceId = randomUUID();
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[DashboardMetricsAudit] ${msg}`);
    logs.push(msg);
  };

  try {
    log(`START traceId=${traceId}`);
    
    // Adicionar headers anti-cache
    res.setHeader('Cache-Control', 'no-store');
    
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'DATABASE_NOT_AVAILABLE',
        traceId,
        logs,
      });
    }

    // Buscar dados do DB local
    log(`Fetching data from local database...`);
    
    const allClients = await db.select().from(clients);
    const allReceivables = await db.select().from(receivables);
    
    log(`Found ${allClients.length} clients, ${allReceivables.length} receivables`);

    // Contar por status
    const overdue = allReceivables.filter((r: any) => r.status === 'overdue').length;
    const pending = allReceivables.filter((r: any) => r.status === 'pending').length;
    const paid = allReceivables.filter((r: any) => r.status === 'paid').length;

    // Coletar evidência (até 3 IDs reais)
    const evidence: any[] = [];
    
    if (allClients.length > 0) {
      evidence.push({
        type: 'clientId',
        id: allClients[0].id,
        value: allClients[0].name,
      });
    }
    
    if (allReceivables.length > 0) {
      evidence.push({
        type: 'receivableId',
        id: allReceivables[0].id,
        value: `${allReceivables[0].clientId} - ${allReceivables[0].amount}`,
      });
    }
    
    if (allReceivables.length > 1) {
      evidence.push({
        type: 'receivableId',
        id: allReceivables[1].id,
        value: `${allReceivables[1].clientId} - ${allReceivables[1].amount}`,
      });
    }

    log(`Evidence collected: ${evidence.length} items`);

    // Timestamp de sincronização (usar data atual como proxy)
    const lastSyncAt = new Date().toISOString();

    const response = {
      ok: true,
      source: 'db',
      lastSyncAt,
      traceId,
      evidence,
      counts: {
        clients: allClients.length,
        receivables: allReceivables.length,
        overdue,
        pending,
        paid,
      },
      metrics: {
        totalAmount: allReceivables.reduce((sum: number, r: any) => sum + parseFloat(r.amount || '0'), 0),
        avgAmount: allReceivables.length > 0 
          ? (allReceivables.reduce((sum: number, r: any) => sum + parseFloat(r.amount || '0'), 0) / allReceivables.length).toFixed(2)
          : 0,
      },
      logs,
    };

    log(`SUCCESS: Returning audit response with traceId=${traceId}`);
    return res.status(200).json(response);

  } catch (error: any) {
    log(`ERROR: ${error?.message}`);
    return res.status(500).json({
      ok: false,
      error: 'METRICS_FETCH_FAILED',
      message: error?.message,
      traceId,
      logs,
    });
  }
});

export default router;
