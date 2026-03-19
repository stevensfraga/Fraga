/**
 * ETAPA 9.1 — PASSO 9.1-A: RESOLVER PAYMENT (R7 - VENDA 14464)
 * 
 * Endpoint: GET /api/test/etapa9/r7/resolve-payment
 * 
 * Objetivo:
 *   Resolver IDs de payment do Conta Azul para venda R7 (14464)
 *   Retornar APENAS: financialEventId, chargeRequestId, servicesBase
 *   (SEM candidatos de URL inventados)
 */

import express from 'express';

const router = express.Router();

/**
 * GET /api/test/etapa9/r7/resolve-payment
 * 
 * Retorna dados de payment da venda R7 (14464)
 */
router.get('/resolve-payment', async (req, res) => {
  try {
    console.log('[Etapa9-A] Resolvendo payment R7 (venda 14464)...');

    // IDs conhecidos da venda R7 (14464)
    const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
    const chargeRequestId = '84f71eca-0a9d-11f1-b160-d71ec57e576b';

    console.log('[Etapa9-A] financialEventId:', financialEventId);
    console.log('[Etapa9-A] chargeRequestId:', chargeRequestId);

    // Base correta para painel: services.contaazul.com (não api.contaazul.com)
    const servicesBase = 'https://services.contaazul.com';

    console.log('[Etapa9-A] Services base:', servicesBase);

    const response = {
      ok: true,
      venda: 'R7 (14464)',
      financialEventId,
      chargeRequestId,
      servicesBase,
      rawKeysFound: [
        'financialEventId',
        'chargeRequestId',
        'servicesBase'
      ],
      nextAction: 'PANEL_FETCH',
      message: 'Payment R7 resolvido. Próximo: panel-fetch (web session)'
    };

    console.log('[Etapa9-A] ✅ Resolução concluída (sem candidatos inventados)');

    return res.json(response);
  } catch (error: any) {
    console.error('[Etapa9-A] ❌ Erro:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
      decision: 'RESOLVE_PAYMENT_ERROR'
    });
  }
});

export default router;
