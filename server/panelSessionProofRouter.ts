import { Router } from 'express';
import { testPanelAccessWithSession } from './panelSessionManager';

const router = Router();

/**
 * GET /api/test/panel/session-proof
 * Testa acesso ao painel com sessão capturada
 * 
 * Retorna:
 * {
 *   ok: boolean,
 *   httpStatus: number,
 *   usedCookies: string[],
 *   decision: 'OK_PANEL_SESSION' | 'SESSION_EXPIRED' | 'NO_SESSION' | 'PANEL_AUTH_FAILED'
 * }
 */
router.get('/session-proof', async (req, res) => {
  const correlationId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    console.log(`[SessionProof] ${correlationId} Iniciando teste de sessão do painel...`);

    const result = await testPanelAccessWithSession();

    console.log(`[SessionProof] ${correlationId} Resultado:`, result.decision);

    return res.json({
      ...result,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`[SessionProof] ${correlationId} Erro fatal:`, error.message);
    return res.status(500).json({
      ok: false,
      decision: 'FATAL_ERROR',
      correlationId,
      error: error.message,
    });
  }
});

export default router;
