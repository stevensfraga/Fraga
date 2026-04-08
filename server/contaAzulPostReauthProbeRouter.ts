/**
 * PASSO C — REAUTH AUTOMÁTICO + PROBA NOVAMENTE
 * 
 * Se refresh falhou (400/401), fazer reauth automático
 * Endpoint: GET /api/test/conta-azul/post-reauth-probe
 */

import express from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = express.Router();

const API_V2_BASE = 'https://api-v2.contaazul.com';

/**
 * GET /api/test/conta-azul/post-reauth-probe
 * 
 * Proba token após reauth (mesmo teste que PASSO A)
 */
router.get('/post-reauth-probe', async (req, res) => {
  try {
    console.log('[PostReauthProbe] Iniciando proba pós-reauth...');

    // 1) Obter token válido (após reauth)
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
      console.log('[PostReauthProbe] Token obtido:', accessToken.substring(0, 20) + '...');
    } catch (err: any) {
      console.error('[PostReauthProbe] Erro ao obter token:', err.message);
      return res.status(401).json({
        ok: false,
        httpStatus: 401,
        error: 'Falha ao obter token após reauth',
        nextAction: 'STILL_INVALID_TOKEN',
        details: err.message
      });
    }

    // 2) Fazer chamada real à API (mesmo teste que PASSO A)
    const probeUrl = `${API_V2_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=1&data_vencimento_de=2026-01-01&data_vencimento_ate=2026-12-31`;

    console.log('[PostReauthProbe] Testando endpoint:', probeUrl);

    try {
      const response = await axios.get(probeUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      console.log('[PostReauthProbe] ✅ HTTP', response.status);

      return res.json({
        ok: response.status === 200,
        httpStatus: response.status,
        contaAzulBase: API_V2_BASE,
        tokenPrefix: accessToken.substring(0, 20) + '...',
        responseKeys: Object.keys(response.data).slice(0, 10),
        responseSnippet: {
          itens_totais: response.data.itens_totais,
          itensCount: (response.data.itens || []).length,
        },
        nextAction: 'OK_TO_SYNC',
        message: 'Reauth bem-sucedida! Token é válido. Pronto para sincronizar dados reais.'
      });
    } catch (error: any) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      console.error('[PostReauthProbe] ❌ HTTP', status);

      return res.status(status || 500).json({
        ok: false,
        httpStatus: status,
        tokenPrefix: accessToken.substring(0, 20) + '...',
        error: errorData?.fault?.faultstring || errorData?.error_description || error.message,
        nextAction: 'STILL_INVALID_TOKEN',
        message: 'Token ainda inválido após reauth.'
      });
    }
  } catch (error: any) {
    console.error('[PostReauthProbe] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
      nextAction: 'ERROR'
    });
  }
});

export default router;
