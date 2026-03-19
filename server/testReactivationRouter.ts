import { Router } from 'express';
import { sendReactivation, getReactivationCandidates } from './services/reactivationService';
import { runReactivationBatch } from './jobs/reactivationScheduler';

const router = Router();

// Middleware: Dev-only access
const devOnly = (req: any, res: any, next: any) => {
  const secret = req.headers['x-dev-secret'];
  if (secret !== 'Contabil1') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

router.use(devOnly);

/**
 * POST /api/test/send-reactivation-manual/:id
 * Enviar reativação manualmente para um receivable específico
 */
router.post('/send-reactivation-manual/:id', async (req: any, res: any) => {
  try {
    const receivableId = parseInt(req.params.id, 10);
    if (isNaN(receivableId)) {
      return res.status(400).json({ error: 'Invalid receivableId' });
    }

    const result = await sendReactivation(receivableId);
    res.json(result);
  } catch (error: any) {
    console.error(`[TestReactivation] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/test/reactivation-candidates
 * Listar candidatos para reativação
 */
router.get('/reactivation-candidates', async (req: any, res: any) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const candidates = await getReactivationCandidates(limit);
    res.json({ count: candidates.length, candidates });
  } catch (error: any) {
    console.error(`[TestReactivation] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test/run-reactivation-batch
 * Executar lote de reativação (simulando o scheduler)
 */
router.post('/run-reactivation-batch', async (req: any, res: any) => {
  try {
    await runReactivationBatch();
    res.json({ status: 'Lote de reativação executado' });
  } catch (error: any) {
    console.error(`[TestReactivation] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
