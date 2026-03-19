/**
 * ENDPOINT DEBUG: GET /api/collection/eligible-clients/:bucketCode
 * 
 * Retorna TOP clientes elegíveis para cobrança consolidada
 * com totais, motivos de bloqueio e receivables agrupados.
 * 
 * Protegido por x-admin-key: FRAGA_ADMIN_KEY
 */

import { Router, Request, Response } from 'express';
import { getEligibleClientsForBucket } from './clientConsolidation';
import { formatBRL, formatDate } from './messageTemplates';
import type { BucketCode } from './buckets';

const router = Router();

router.get('/eligible-clients/:bucketCode', async (req: Request, res: Response) => {
  try {
    // Verificar admin key
    const adminKey = req.headers['x-admin-key'] as string;
    if (!adminKey || adminKey !== process.env.FRAGA_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized: x-admin-key inválida' });
    }

    const bucketCode = req.params.bucketCode?.toUpperCase() as BucketCode;
    const validBuckets: BucketCode[] = ['A', 'B', 'C', 'D'];
    if (!validBuckets.includes(bucketCode)) {
      return res.status(400).json({ error: 'Invalid bucketCode', validBuckets });
    }

    const limit = parseInt(req.query.limit as string) || 20;

    console.log(`[EligibleClients] Buscando clientes elegíveis: bucket=${bucketCode}, limit=${limit}`);

    const clients = await getEligibleClientsForBucket(bucketCode, limit);

    const eligible = clients.filter(c => c.eligible);
    const blocked = clients.filter(c => !c.eligible);

    // Contar motivos de bloqueio
    const reasonCounts: Record<string, number> = {};
    for (const c of blocked) {
      for (const reason of c.rejectionReasons) {
        const key = reason.split(':')[0]; // Pegar apenas o código
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      }
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      bucketCode,
      summary: {
        totalClients: clients.length,
        eligible: eligible.length,
        blocked: blocked.length,
        totalDebtEligible: formatBRL(eligible.reduce((sum, c) => sum + c.totalDebt, 0)),
        totalTitlesEligible: eligible.reduce((sum, c) => sum + c.titlesCount, 0),
        blockReasons: reasonCounts,
      },
      eligibleClients: eligible.map(c => ({
        clientId: c.clientId,
        clientName: c.clientName,
        whatsappNumber: c.whatsappNumber,
        titlesCount: c.titlesCount,
        totalDebt: formatBRL(c.totalDebt),
        totalDebtRaw: c.totalDebt,
        oldestDue: formatDate(c.oldestDue),
        newestDue: formatDate(c.newestDue),
        maxDaysOverdue: c.maxDaysOverdue,
        paymentLinkCanonical: c.paymentLinkCanonical,
        topReceivables: c.topReceivables.map(r => ({
          receivableId: r.receivableId,
          amount: formatBRL(r.amount),
          dueDate: formatDate(r.dueDate),
          daysOverdue: r.daysOverdue,
          dispatchCount: r.dispatchCount,
          hasPaymentLink: !!r.paymentLinkCanonical,
        })),
      })),
      blockedClients: blocked.map(c => ({
        clientId: c.clientId,
        clientName: c.clientName,
        whatsappNumber: c.whatsappNumber || 'N/A',
        titlesCount: c.titlesCount,
        totalDebt: formatBRL(c.totalDebt),
        maxDaysOverdue: c.maxDaysOverdue,
        reasons: c.rejectionReasons,
      })),
    });
  } catch (error: any) {
    console.error('[EligibleClients] ❌ Erro:', error.message);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

export default router;
