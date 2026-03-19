/**
 * PASSO A — PROVA DO TOKEN EM ENDPOINT REAL (PING)
 * 
 * Testa se o token é válido fazendo uma chamada real à API do Conta Azul
 * Endpoint: GET /api/test/conta-azul/token-probe
 */

import express from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = express.Router();

const API_V2_BASE = 'https://api-v2.contaazul.com';

/**
 * GET /api/test/conta-azul/token-probe
 * 
 * Prova do token com endpoint real do Conta Azul
 */
router.get('/token-probe', async (req, res) => {
  try {
    console.log('[TokenProbe] Iniciando prova do token...');

    // 1) Obter token válido
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
      console.log('[TokenProbe] Token obtido:', accessToken.substring(0, 20) + '...');
    } catch (err: any) {
      console.error('[TokenProbe] Erro ao obter token:', err.message);
      return res.status(401).json({
        ok: false,
        httpStatus: 401,
        error: 'Falha ao obter token',
        nextAction: 'NEED_REAUTH',
        details: err.message
      });
    }

    // 2) Fazer chamada real à API
    const probeUrl = `${API_V2_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=1&data_vencimento_de=2026-01-01&data_vencimento_ate=2026-12-31`;

    console.log('[TokenProbe] Testando endpoint:', probeUrl);

    try {
      const response = await axios.get(probeUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      console.log('[TokenProbe] ✅ HTTP', response.status);
      console.log('[TokenProbe] Response keys:', Object.keys(response.data).slice(0, 10));

      // Validar resposta
      const responseKeys = Object.keys(response.data);
      const hasRequiredKeys = ['itens_totais', 'itens', 'totais'].some(k => responseKeys.includes(k));

      return res.json({
        ok: response.status === 200 && hasRequiredKeys,
        httpStatus: response.status,
        contaAzulBase: API_V2_BASE,
        tokenPrefix: accessToken.substring(0, 20) + '...',
        responseKeys,
        responseSnippet: {
          itens_totais: response.data.itens_totais,
          itensCount: (response.data.itens || []).length,
          totais: response.data.totais,
        },
        nextAction: 'OK_TO_SYNC',
        message: 'Token é válido! Pronto para sincronizar dados reais.'
      });
    } catch (error: any) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      console.error('[TokenProbe] ❌ HTTP', status);
      console.error('[TokenProbe] Error:', errorData);

      // Determinar próxima ação
      let nextAction = 'STILL_INVALID_TOKEN';
      if (status === 401) {
        nextAction = 'NEED_REFRESH';
      }

      return res.status(status || 500).json({
        ok: false,
        httpStatus: status,
        contaAzulBase: API_V2_BASE,
        tokenPrefix: accessToken.substring(0, 20) + '...',
        error: errorData?.fault?.faultstring || errorData?.error_description || error.message,
        errorCode: errorData?.fault?.detail?.errorcode,
        nextAction,
        message: nextAction === 'NEED_REFRESH' ? 'Token inválido. Tentando refresh...' : 'Token inválido. Reauth necessária.'
      });
    }
  } catch (error: any) {
    console.error('[TokenProbe] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
      nextAction: 'ERROR'
    });
  }
});

export default router;
