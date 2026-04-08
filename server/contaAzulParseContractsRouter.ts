/**
 * Parse Active Contracts Endpoint
 * GET /api/test/conta-azul/parse-active-contracts
 */

import { Router } from 'express';
import { parseAndMarkManagedClients } from './services/parseActiveContractsService';

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
 * GET /parse-active-contracts
 * Parsear PDFs de contratos ativos e marcar clientes como managed
 */
router.get('/parse-active-contracts', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[ParseContractsEndpoint] Iniciando parsing de contratos ativos...`);

    const pdfPaths = [
      '/home/ubuntu/upload/ContaAzulPro.pdf',
      '/home/ubuntu/upload/ContaAzulPro2.pdf',
    ];

    const result = await parseAndMarkManagedClients(pdfPaths);

    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error(`[ParseContractsEndpoint] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
