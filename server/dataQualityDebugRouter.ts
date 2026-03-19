/**
 * Data Quality Debug Router
 * Endpoints para debug de clientes managed
 */

import { Router } from 'express';
import { getDb } from './db';
import { clients } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  const headerSecret = req.headers['x-dev-secret'];
  
  if (!devSecret || devSecret !== headerSecret) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  return true;
}

/**
 * GET /debug-managed-clients
 * Show top 10 managed clients
 */
router.get('/debug-managed-clients', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Get all clients with status='active' AND without UUID
    const managedClients = await db
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        status: clients.status,
        contaAzulPersonId: clients.contaAzulPersonId,
      })
      .from(clients)
      .where(eq(clients.status, 'active'))
      .limit(20);
    
    // Count managed without UUID
    const managedWithoutUuid = managedClients.filter(c => !c.contaAzulPersonId);
    const managedWithUuid = managedClients.filter(c => c.contaAzulPersonId);

    // Get status distribution
    const allClients = await db.select().from(clients);
    const statusDist: any = {};
    for (const client of allClients) {
      const status = client.status || 'null';
      statusDist[status] = (statusDist[status] || 0) + 1;
    }

    res.json({
      success: true,
      managedCount: managedClients.length,
      managedWithoutUuid: managedWithoutUuid.length,
      managedWithUuid: managedWithUuid.length,
      statusDistribution: statusDist,
      samples: managedWithoutUuid.slice(0, 5),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
