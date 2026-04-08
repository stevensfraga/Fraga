import { Router } from 'express';
import { enqueueEmission, getEmissionStatus } from './services/nfseEmissionQueue';

const router = Router();

// POST /api/nfse/emit-async - Enqueue emission (returns immediately)
router.post('/emit-async', async (req, res) => {
  try {
    const { emissaoId } = req.body;
    const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
    
    // Validate admin key
    if (adminKey !== process.env.FRAGA_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Validate emissaoId
    if (!emissaoId || typeof emissaoId !== 'number') {
      return res.status(400).json({ error: 'emissaoId is required and must be a number' });
    }
    
    console.log(`[NfseAsyncEmissionRouter] Enqueueing emission ${emissaoId}`);
    
    // Enqueue the emission
    const job = await enqueueEmission(emissaoId);
    
    // Return job info immediately
    return res.json({
      success: true,
      jobId: job.id,
      emissaoId,
      status: 'enqueued',
      message: `Emissão ${emissaoId} enfileirada para processamento`,
      statusUrl: `/api/nfse/emit-status/${job.id}`,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`[NfseAsyncEmissionRouter] ❌ Erro ao enfileirar: ${error}`);
    
    return res.status(500).json({
      success: false,
      error: error,
      message: 'Erro ao enfileirar emissão',
    });
  }
});

// GET /api/nfse/emit-status/:jobId - Check emission status
router.get('/emit-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    console.log(`[NfseAsyncEmissionRouter] Checking status for job ${jobId}`);
    
    const status = await getEmissionStatus(jobId);
    
    if (!status) {
      return res.status(404).json({
        error: 'Job not found',
        jobId,
      });
    }
    
    return res.json({
      success: true,
      jobId,
      state: status.state,
      progress: status.progress,
      data: status.data,
      result: status.result,
      error: status.error,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`[NfseAsyncEmissionRouter] ❌ Erro ao buscar status: ${error}`);
    
    return res.status(500).json({
      success: false,
      error: error,
      message: 'Erro ao buscar status da emissão',
    });
  }
});

export default router;
