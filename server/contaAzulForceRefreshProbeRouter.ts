/**
 * PASSO B — REFRESH FORÇADO + PROVA NOVAMENTE
 * 
 * Se token está inválido (401), fazer refresh e probar novamente
 * Endpoint: POST /api/test/conta-azul/force-refresh-and-probe
 */

import express from 'express';
import axios from 'axios';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { desc, eq } from 'drizzle-orm';

const router = express.Router();

const API_V2_BASE = 'https://api-v2.contaazul.com';
const TOKEN_URL = 'https://auth.contaazul.com/oauth2/token';

/**
 * POST /api/test/conta-azul/force-refresh-and-probe
 * 
 * Faz refresh forçado do token e proba novamente
 */
router.post('/force-refresh-and-probe', async (req, res) => {
  try {
    console.log('[ForceRefresh] Iniciando refresh forçado...');

    // 1) Obter DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database connection failed',
        nextAction: 'ERROR'
      });
    }

    // 2) Ler token do DB
    const savedTokens = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.updatedAt))
      .limit(1);

    if (!savedTokens || savedTokens.length === 0) {
      return res.status(401).json({
        ok: false,
        error: 'Nenhum token encontrado no banco',
        nextAction: 'NEED_REAUTH'
      });
    }

    const token = savedTokens[0];
    console.log('[ForceRefresh] Token encontrado no DB');

    // 3) Fazer refresh
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        ok: false,
        error: 'Missing CONTA_AZUL_CLIENT_ID or CONTA_AZUL_CLIENT_SECRET',
        nextAction: 'ERROR'
      });
    }

    console.log('[ForceRefresh] Enviando refresh_token para:', TOKEN_URL);

    let refreshResponse;
    try {
      refreshResponse = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: token.refreshToken || '',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        }
      );
    } catch (refreshErr: any) {
      const status = refreshErr.response?.status;
      const errorData = refreshErr.response?.data;

      console.error('[ForceRefresh] ❌ Refresh falhou com HTTP', status);
      console.error('[ForceRefresh] Error:', errorData);

      return res.status(status || 500).json({
        ok: false,
        refreshHttp: status,
        error: errorData?.error_description || refreshErr.message,
        nextAction: status === 400 ? 'NEED_REAUTH' : 'ERROR',
        message: 'Refresh falhou. Reauth necessária.'
      });
    }

    const refreshHttp = refreshResponse.status;
    const newAccessToken = refreshResponse.data.access_token;
    const newRefreshToken = refreshResponse.data.refresh_token || token.refreshToken;
    const expiresIn = refreshResponse.data.expires_in || 3600;

    console.log('[ForceRefresh] ✅ Refresh HTTP', refreshHttp);
    console.log('[ForceRefresh] Novo token:', newAccessToken.substring(0, 20) + '...');

    // 4) Salvar novo token no DB
    const now = Date.now();
    const { eq } = await import('drizzle-orm');
    await db
      .update(contaAzulTokens)
      .set({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: new Date(now + expiresIn * 1000),
        updatedAt: new Date(),
      })
      .where(eq(contaAzulTokens.id, token.id));

    console.log('[ForceRefresh] Token atualizado no DB');

    // 5) Probar novamente com novo token
    const probeUrl = `${API_V2_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=1&data_vencimento_de=2026-01-01&data_vencimento_ate=2026-12-31`;

    console.log('[ForceRefresh] Probando com novo token...');

    try {
      const probeResponse = await axios.get(probeUrl, {
        headers: {
          'Authorization': `Bearer ${newAccessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      console.log('[ForceRefresh] ✅ Probe HTTP', probeResponse.status);

      return res.json({
        ok: probeResponse.status === 200,
        refreshHttp,
        probeHttp: probeResponse.status,
        tokenPrefix: newAccessToken.substring(0, 20) + '...',
        responseKeys: Object.keys(probeResponse.data).slice(0, 10),
        nextAction: 'OK_TO_SYNC',
        message: 'Token refreshado e validado! Pronto para sincronizar dados reais.'
      });
    } catch (probeErr: any) {
      const probeStatus = probeErr.response?.status;
      const probeErrorData = probeErr.response?.data;

      console.error('[ForceRefresh] ❌ Probe falhou com HTTP', probeStatus);

      return res.status(probeStatus || 500).json({
        ok: false,
        refreshHttp,
        probeHttp: probeStatus,
        tokenPrefix: newAccessToken.substring(0, 20) + '...',
        error: probeErrorData?.fault?.faultstring || probeErr.message,
        nextAction: 'NEED_REAUTH',
        message: 'Refresh bem-sucedido, mas token ainda inválido. Reauth necessária.'
      });
    }
  } catch (error: any) {
    console.error('[ForceRefresh] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
      nextAction: 'ERROR'
    });
  }
});

export default router;
