import { Router, Request, Response } from 'express';
import { nfseEmissionService } from './services/nfseEmissionService';

const router = Router();

/**
 * GET /api/nfse/health
 * Health check do motor de emissão NFS-e
 * Valida: Playwright, Chromium, acesso ao portal
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await nfseEmissionService.healthCheck();
    res.json({
      ok: health.chromiumAvailable,
      playwrightOk: health.playwrightOk,
      chromiumAvailable: health.chromiumAvailable,
      message: health.message,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/nfse/test-emit
 * Teste de emissão de NFS-e
 * Body: { cnpj, serviceDescription, serviceValue, clientName, clientCnpj, ... }
 */
router.post('/test-emit', async (req: Request, res: Response) => {
  try {
    const {
      cnpj,
      companyName,
      serviceDescription,
      serviceValue,
      clientName,
      clientCnpj,
      clientEmail,
      portalUrl,
      headless,
    } = req.body;

    // Validação básica
    if (!cnpj || !serviceDescription || !serviceValue || !clientName || !clientCnpj) {
      return res.status(400).json({
        error: 'Missing required fields: cnpj, serviceDescription, serviceValue, clientName, clientCnpj',
      });
    }

    const result = await nfseEmissionService.testEmit({
      cnpj,
      companyName,
      serviceDescription,
      serviceValue,
      clientName,
      clientCnpj,
      clientEmail,
      portalUrl,
      headless: headless !== false,
    });

    res.json({
      success: result.success,
      nfseNumber: result.nfseNumber,
      message: result.message,
      logs: result.logs,
      errorMessage: result.errorMessage,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
