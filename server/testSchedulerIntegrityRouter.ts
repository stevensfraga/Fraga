import { Router } from 'express';
import { checkSchedulerIntegrity } from './services/schedulerIntegrityService';

const router = Router();

/**
 * GET /api/test/scheduler-integrity
 * Verifica integridade da base para execução de scheduler
 * Dev-only endpoint
 */
router.get('/scheduler-integrity', async (req, res) => {
  try {
    const result = await checkSchedulerIntegrity();
    res.json(result);
  } catch (error: any) {
    console.error('[TestSchedulerIntegrity] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
