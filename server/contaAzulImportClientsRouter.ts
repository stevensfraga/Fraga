import express from 'express';
import { importClientsToContaAzul } from './services/importClientesToContaAzulService';

const router = express.Router();

/**
 * POST /api/test/conta-azul/import-clients
 * Import clients from Cliente(1).csv to Conta Azul via API
 */
router.post('/import-clients', async (req, res) => {
  try {
    const devSecret = req.headers['x-dev-secret'];
    const expectedSecret = process.env.DEV_SECRET || 'dev-secret';

    if (devSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[ImportClientsRouter] Starting client import to Conta Azul');

    const result = await importClientsToContaAzul();

    return res.json({
      success: result.success,
      totalProcessed: result.totalProcessed,
      created: result.created,
      failed: result.failed,
      errors: result.errors.slice(0, 10), // Return first 10 errors
      message: result.success
        ? `Successfully imported ${result.created} clients to Conta Azul`
        : `Import completed with errors: ${result.failed} failed out of ${result.totalProcessed}`,
    });
  } catch (error: any) {
    console.error('[ImportClientsRouter] Error:', error.message);
    return res.status(500).json({
      error: 'Import failed',
      message: error.message,
    });
  }
});

export default router;
