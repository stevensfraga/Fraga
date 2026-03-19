/**
 * TAREFA A1 - Endpoint para Gerar CSV
 * GET /api/test/conta-azul/generate-csv
 */

import { Router } from 'express';
import { generateContaAzulCsv } from './services/generateContaAzulCsvService';

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
 * GET /generate-csv
 * Gerar CSV para importação manual
 */
router.get('/generate-csv', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[GenerateCsvEndpoint] Gerando CSV...`);

    const { csv, count, duplicatesRemoved } = await generateContaAzulCsv();

    // Retornar como arquivo ou JSON
    const format = req.query.format || 'json';

    if (format === 'file') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="clients_contaazul_import.csv"');
      res.send(csv);
    } else {
      // JSON com preview
      const lines = csv.split('\n');
      const preview = lines.slice(0, 4).join('\n'); // Cabeçalho + 3 primeiras linhas

      res.json({
        success: true,
        count,
        duplicatesRemoved,
        preview,
        downloadUrl: '/api/test/conta-azul/generate-csv?format=file',
      });
    }
  } catch (error: any) {
    console.error(`[GenerateCsvEndpoint] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
