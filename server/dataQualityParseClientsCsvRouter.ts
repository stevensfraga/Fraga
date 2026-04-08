/**
 * Parse Clients CSV Endpoint
 * POST /api/test/data-quality/parse-clients-csv
 */

import { Router } from 'express';
import { parseAndMarkManagedFromCsv } from './services/parseClientsCsvService';

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
 * POST /parse-clients-csv
 * Parse CSV and mark managed clients
 */
router.post('/parse-clients-csv', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[ParseClientsCsvEndpoint] Starting CSV parsing...`);

    const csvPath = '/home/ubuntu/upload/Cliente(1).csv';

    const result = await parseAndMarkManagedFromCsv(csvPath);

    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error(`[ParseClientsCsvEndpoint] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
