/**
 * Endpoints de Teste para Validar Retry e Logging
 * 
 * Testa:
 * - Gerenciamento de token com retry
 * - Logging detalhado com correlationId
 * - Fallback de sessão (opcional)
 * - Status do sistema
 */

import express, { Router } from 'express';
import { validatePanelConnection } from './contaAzulRequest';
import { getTokenStatus, forceTokenRefreshCheck, isTokenRefreshCronRunning } from './contaAzulTokenRefreshCron';
import { getPanelSessionStatus, validatePanelSession } from './contaAzulPanelSessionManager';
import { getFinancialEventSummary, listInstallments } from './contaAzulPanelAdapter';

const router: Router = express.Router();

/**
 * GET /api/test/panel-health
 * Verificar saúde da conexão com painel
 */
router.get('/panel-health', async (req, res) => {
  try {
    console.log('[PanelTest] Verificando saúde do painel...');

    const panelConnection = await validatePanelConnection();
    const tokenStatus = await getTokenStatus();
    const sessionStatus = await getPanelSessionStatus();
    const cronRunning = isTokenRefreshCronRunning();

    const health = {
      ok: panelConnection.ok && tokenStatus.ok,
      timestamp: new Date().toISOString(),
      panel: {
        ok: panelConnection.ok,
        status: panelConnection.status,
        message: panelConnection.message,
      },
      token: {
        ok: tokenStatus.ok,
        hasToken: tokenStatus.hasToken,
        expiresIn: tokenStatus.expiresIn,
        lastRefresh: tokenStatus.lastRefresh,
      },
      session: {
        ok: sessionStatus.ok,
        cached: sessionStatus.cached,
        sessionId: sessionStatus.sessionId,
        expiresIn: sessionStatus.expiresIn,
      },
      cron: {
        running: cronRunning,
        schedule: '*/10 * * * * (a cada 10 min)',
      },
    };

    res.json(health);
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/test/panel-token-status
 * Obter status detalhado do token
 */
router.get('/panel-token-status', async (req, res) => {
  try {
    const tokenStatus = await getTokenStatus();
    const cronRunning = isTokenRefreshCronRunning();

    res.json({
      ok: tokenStatus.ok,
      token: {
        ...tokenStatus,
        cronRunning,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/panel-token-refresh
 * Forçar refresh de token (útil para testes)
 */
router.post('/panel-token-refresh', async (req, res) => {
  try {
    console.log('[PanelTest] Forçando refresh de token...');

    await forceTokenRefreshCheck();

    const tokenStatus = await getTokenStatus();

    res.json({
      ok: tokenStatus.ok,
      message: 'Refresh executado',
      token: tokenStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/panel-financial-event/:id
 * Testar obtenção de Financial Event com retry
 */
router.get('/panel-financial-event/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const correlationId = `test-${Date.now()}`;

    console.log(`[PanelTest] Testando Financial Event: ${id} (correlationId: ${correlationId})`);

    const summary = await getFinancialEventSummary(id, correlationId);

    if (!summary) {
      return res.status(404).json({
        ok: false,
        error: 'Financial Event não encontrado',
        id,
        correlationId,
      });
    }

    res.json({
      ok: true,
      id,
      correlationId,
      summary: {
        description: summary.description,
        amount: summary.amount,
        due_date: summary.due_date,
        status: summary.status,
        nossa_numero: summary.nossa_numero,
        pdfUrl: summary.boleto_pdf_url || summary.pdf_url,
        pix: summary.pix_copy_paste || summary.pix,
        linhaDigitavel: summary.linha_digitavel,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/panel-installments
 * Testar listagem de installments com retry
 */
router.get('/panel-installments', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const correlationId = `test-${Date.now()}`;

    console.log(`[PanelTest] Listando installments: página ${page}, tamanho ${pageSize} (correlationId: ${correlationId})`);

    const installments = await listInstallments(page, pageSize, correlationId);

    res.json({
      ok: true,
      page,
      pageSize,
      count: installments.length,
      correlationId,
      installments: installments.map((i) => ({
        id: i.id,
        financial_event_id: i.financial_event_id,
        description: i.description,
        amount: i.amount,
        due_date: i.due_date,
        status: i.status,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/panel-session-status
 * Obter status da sessão (fallback)
 */
router.get('/panel-session-status', async (req, res) => {
  try {
    const sessionStatus = await getPanelSessionStatus();

    res.json({
      ok: sessionStatus.ok,
      session: sessionStatus,
      note: 'Fallback opcional - Bearer token é preferido',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/panel-session-validate
 * Validar sessão (fallback)
 */
router.post('/panel-session-validate', async (req, res) => {
  try {
    console.log('[PanelTest] Validando sessão...');

    const isValid = await validatePanelSession();

    res.json({
      ok: isValid,
      message: isValid ? 'Sessão válida' : 'Sessão inválida',
      note: 'Fallback opcional - Bearer token é preferido',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PanelTest] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

export default router;
