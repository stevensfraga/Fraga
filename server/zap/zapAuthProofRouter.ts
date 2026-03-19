/**
 * PARTE C — ZAP AUTH PROOF ENDPOINT
 * 
 * GET /api/test/zap/auth-proof
 * Valida auth e faz warm-up
 */

import express from 'express';
import { getZapAuth, getZapAuthStatus } from './zapAuth';
import { zapRequest } from './zapRequest';

const router = express.Router();

/**
 * GET /api/test/zap/auth-proof
 * Prova que auth está OK
 */
router.get('/auth-proof', async (req, res) => {
  try {
    console.log('[AuthProof] Iniciando...');

    // 1) Obter auth
    const auth = await getZapAuth();
    console.log('[AuthProof] Auth obtido:', auth.tokenHash);

    // 2) Warm-up: GET /tickets
    console.log('[AuthProof] Fazendo warm-up...');
    const warmupResponse = await zapRequest(
      '/tickets?pageNumber=1&pageSize=10',
      { method: 'GET' },
      { correlationId: '[WARMUP]' }
    );

    console.log('[AuthProof] Warm-up HTTP:', warmupResponse.httpStatus);

    // 3) Retornar prova
    const status = getZapAuthStatus();

    return res.json({
      ok: warmupResponse.httpStatus === 200,
      decision: warmupResponse.httpStatus === 200 ? 'AUTH_OK' : 'AUTH_FAILED',
      tokenHash: auth.tokenHash,
      expiresAtISO: auth.expiresAtISO,
      minutesUntilExpiry: status.minutesUntilExpiry,
      warmup: {
        httpStatus: warmupResponse.httpStatus,
        path: '/tickets?pageNumber=1&pageSize=10',
      },
    });
  } catch (error: any) {
    console.error('[AuthProof] Erro:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

export default router;
