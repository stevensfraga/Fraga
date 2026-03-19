import express from 'express';
import { enableFullFiscalConsultation } from '../jobs/enableFullFiscalConsultation.js';

const router = express.Router();

/**
 * GET /api/admin/sieg-enable-full-fiscal
 * Habilita consulta fiscal completa para todos os certificados ativos no SIEG
 * 
 * Headers:
 *   x-admin-key: Chave de administrador
 * 
 * Response:
 *   {
 *     status: "success" | "error",
 *     total: number,
 *     activated: number,
 *     alreadyConfigured: number,
 *     errors: number,
 *     results: Array<{ cnpj, nome, success, message, timestamp }>,
 *     timestamp: string
 *   }
 */
router.get('/sieg-enable-full-fiscal', async (req, res) => {
  try {
    // Validar chave de administrador
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.FRAGA_ADMIN_KEY || 'Fraga@123';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized: Invalid or missing admin key',
        timestamp: new Date().toISOString()
      });
    }

    console.log('[AdminSiegEnableFullFiscal] Iniciando habilitação de consulta fiscal completa...');

    // Executar a função de habilitação
    const stats = await enableFullFiscalConsultation();

    console.log('[AdminSiegEnableFullFiscal] Habilitação concluída:', stats);

    // Retornar resultado
    return res.status(200).json({
      status: 'success',
      total: stats.total,
      activated: stats.activated,
      alreadyConfigured: stats.alreadyConfigured,
      errors: stats.errors,
      results: stats.results,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[AdminSiegEnableFullFiscal] Erro:', err);
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
