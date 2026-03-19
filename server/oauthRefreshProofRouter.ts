import { Router } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { desc } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/test/oauth/refresh-proof
 * Testa o refresh do token OAuth
 * Prova que: refresh_http = 200, token rotacionado, sem erro 400
 */
router.get('/refresh-proof', async (req, res) => {
  try {
    console.log('[RefreshProof] Iniciando teste de refresh...');

    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database not available',
      });
    }

    // 1) Ler token do DB
    const savedTokens = await db
      .select()
      .from(contaAzulTokens)
      .orderBy((t) => desc(t.updatedAt))
      .limit(1);

    if (savedTokens.length === 0) {
      return res.status(401).json({
        ok: false,
        error: 'No token found in database',
      });
    }

    const savedToken = savedTokens[0];
    console.log('[RefreshProof] Token encontrado no DB');
    console.log('[RefreshProof] Refresh token prefix:', savedToken.refreshToken?.substring(0, 20) + '...');

    // 2) Forçar refresh via refresh_token
    const tokenUrl = 'https://auth.contaazul.com/oauth2/token';
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        ok: false,
        error: 'Missing CONTA_AZUL_CLIENT_ID or CONTA_AZUL_CLIENT_SECRET',
      });
    }

    console.log('[RefreshProof] Enviando refresh_token para:', tokenUrl);

    const refreshResponse = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: savedToken.refreshToken || '',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      }
    );

    const refreshHttp = refreshResponse.status;
    const refreshData = refreshResponse.data;

    console.log('[RefreshProof] Refresh HTTP:', refreshHttp);
    console.log('[RefreshProof] Refresh response keys:', Object.keys(refreshData));

    // 3) Validar resposta
    if (refreshHttp !== 200) {
      return res.status(refreshHttp).json({
        ok: false,
        refresh_http: refreshHttp,
        error: 'Refresh failed with non-200 status',
      });
    }

    const newAccessToken = refreshData.access_token;
    const newRefreshToken = refreshData.refresh_token;
    const expiresIn = refreshData.expires_in;

    if (!newAccessToken) {
      return res.status(400).json({
        ok: false,
        refresh_http: refreshHttp,
        error: 'No access_token in refresh response',
      });
    }

    console.log('[RefreshProof] Novo access_token obtido');
    console.log('[RefreshProof] Novo refresh_token:', newRefreshToken ? 'SIM' : 'NÃO');

    // 4) Rotacionar no DB (se novo refresh_token foi retornado)
    let rotatedRefreshToken = false;
    if (newRefreshToken && newRefreshToken !== savedToken.refreshToken) {
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

      const { eq } = await import('drizzle-orm');
      await db
        .update(contaAzulTokens)
        .set({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresAt: newExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(contaAzulTokens.id, savedToken.id));

      rotatedRefreshToken = true;
      console.log('[RefreshProof] Token rotacionado no DB');
      console.log('[RefreshProof] Novo expiresAt:', newExpiresAt.toISOString());
    }

    // 5) Retornar prova
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

    return res.json({
      ok: true,
      refresh_http: refreshHttp,
      rotatedRefreshToken,
      newExpiresAt: newExpiresAt.toISOString(),
      tokenPrefix: newAccessToken.substring(0, 20) + '...',
      expiresIn,
      hasNewRefreshToken: !!newRefreshToken,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[RefreshProof] Erro:', error.message);

    // Extrair HTTP status se disponível
    const httpStatus = error.response?.status || 500;
    const errorData = error.response?.data || {};

    return res.status(httpStatus).json({
      ok: false,
      refresh_http: httpStatus,
      error: error.message,
      errorData,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
