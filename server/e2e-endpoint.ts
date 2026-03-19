/**
 * Endpoint para executar E2E do boleto R7
 * POST /api/e2e/send-boleto-r7
 */

import express, { Router } from 'express';
import { executarE2EBoletoR7 } from './e2e-send-boleto-r7';

const router: Router = express.Router();

/**
 * POST /api/e2e/send-boleto-r7
 * Executar envio real E2E do boleto R7
 */
router.post('/send-boleto-r7', async (req, res) => {
  try {
    console.log('[E2E Endpoint] Iniciando envio E2E do boleto R7...');
    
    const proof = await executarE2EBoletoR7();
    
    res.json(proof);
  } catch (error: any) {
    console.error('[E2E Endpoint] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

export default router;
