/**
 * BLOCO 11.4 FIX — Token Health Endpoint
 * 
 * GET /api/test/conta-azul/token-health
 * 
 * Diagnóstico completo do token OAuth Conta Azul:
 * 1. Chama getValidAccessToken() (refresh automático se expirado)
 * 2. Loga decision: TOKEN_OK | REFRESHED | REAUTH_REQUIRED
 * 3. Chama 1 endpoint leve da Conta Azul e retorna status (200/401/403)
 * 4. Se refresh falhar, gera auth-url para novo login
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getValidAccessToken, getAuthorizationUrl } from './contaAzulOAuthManager';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { desc } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();
const CA_API_BASE = 'https://api-v2.contaazul.com/v1';

interface TokenHealthResult {
  decision: 'TOKEN_OK' | 'REFRESHED' | 'REAUTH_REQUIRED';
  tokenPresent: boolean;
  tokenExpiresAt: string | null;
  minutesUntilExpiry: number | null;
  refreshAttempted: boolean;
  refreshSuccess: boolean | null;
  apiTestStatus: number | null;
  apiTestOk: boolean;
  authUrl: string | null;
  error: string | null;
  timestamp: string;
}

router.get('/token-health', async (req: Request, res: Response) => {
  const result: TokenHealthResult = {
    decision: 'TOKEN_OK',
    tokenPresent: false,
    tokenExpiresAt: null,
    minutesUntilExpiry: null,
    refreshAttempted: false,
    refreshSuccess: null,
    apiTestStatus: null,
    apiTestOk: false,
    authUrl: null,
    error: null,
    timestamp: new Date().toISOString(),
  };

  try {
    // 1. Verificar se existe token no banco
    const db = await getDb();
    if (!db) {
      result.decision = 'REAUTH_REQUIRED';
      result.error = 'Database não disponível';
      return res.status(500).json(result);
    }

    const tokens = await db
      .select({
        expiresAt: contaAzulTokens.expiresAt,
        createdAt: contaAzulTokens.createdAt,
        refreshToken: contaAzulTokens.refreshToken,
      })
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.createdAt))
      .limit(1);

    if (tokens.length === 0) {
      result.decision = 'REAUTH_REQUIRED';
      result.error = 'Nenhum token encontrado no banco';
      result.authUrl = generateAuthUrl();
      console.log('[TokenHealth] decision=REAUTH_REQUIRED reason=NO_TOKEN');
      return res.status(200).json(result);
    }

    result.tokenPresent = true;
    result.tokenExpiresAt = tokens[0].expiresAt ? new Date(tokens[0].expiresAt).toISOString() : null;
    
    const now = new Date();
    const expiresAt = new Date(tokens[0].expiresAt);
    result.minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60 * 10) / 10;

    const isExpired = result.minutesUntilExpiry < 5;
    if (isExpired) {
      result.refreshAttempted = true;
    }

    // 2. Chamar getValidAccessToken() — refresh automático se necessário
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
      
      if (isExpired) {
        result.decision = 'REFRESHED';
        result.refreshSuccess = true;
        console.log('[TokenHealth] decision=REFRESHED (token was expiring, refresh succeeded)');
      } else {
        result.decision = 'TOKEN_OK';
        console.log(`[TokenHealth] decision=TOKEN_OK (expires in ${result.minutesUntilExpiry}min)`);
      }
    } catch (error: any) {
      const msg = error.message || '';
      result.refreshAttempted = true;
      result.refreshSuccess = false;
      result.decision = 'REAUTH_REQUIRED';
      result.error = msg;
      result.authUrl = generateAuthUrl();
      console.log(`[TokenHealth] decision=REAUTH_REQUIRED reason=${msg.substring(0, 100)}`);
      return res.status(200).json(result);
    }

    // 3. Testar API Conta Azul com endpoint leve
    try {
      // Usar endpoint com parâmetros obrigatórios (data_vencimento_de/ate)
      const hoje = new Date().toISOString().split('T')[0];
      const umAnoAtras = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
      const apiResponse = await axios.get(
        `${CA_API_BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=1&data_vencimento_de=${umAnoAtras}&data_vencimento_ate=${hoje}&status=OVERDUE`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          timeout: 10000,
          validateStatus: () => true, // Não lançar erro em qualquer status
        }
      );

      result.apiTestStatus = apiResponse.status;
      result.apiTestOk = apiResponse.status === 200;

      if (apiResponse.status === 401 || apiResponse.status === 403) {
        // Token aceito pelo auth server mas rejeitado pela API
        // Tentar refresh forçado
        console.warn(`[TokenHealth] API retornou ${apiResponse.status}, tentando refresh forçado...`);
        result.refreshAttempted = true;

        try {
          accessToken = await forceRefreshAndRetry();
          
          // Retry API test
          const retryResponse = await axios.get(
            `${CA_API_BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=1&data_vencimento_de=${umAnoAtras}&data_vencimento_ate=${hoje}&status=OVERDUE`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
              },
              timeout: 10000,
              validateStatus: () => true,
            }
          );

          result.apiTestStatus = retryResponse.status;
          result.apiTestOk = retryResponse.status === 200;

          if (retryResponse.status === 200) {
            result.decision = 'REFRESHED';
            result.refreshSuccess = true;
            console.log('[TokenHealth] decision=REFRESHED (API test passed after refresh)');
          } else {
            result.decision = 'REAUTH_REQUIRED';
            result.refreshSuccess = false;
            result.error = `API retornou ${retryResponse.status} mesmo após refresh`;
            result.authUrl = generateAuthUrl();
            console.log(`[TokenHealth] decision=REAUTH_REQUIRED reason=API_${retryResponse.status}_AFTER_REFRESH`);
          }
        } catch (refreshErr: any) {
          result.decision = 'REAUTH_REQUIRED';
          result.refreshSuccess = false;
          result.error = `Refresh falhou: ${refreshErr.message}`;
          result.authUrl = generateAuthUrl();
          console.log(`[TokenHealth] decision=REAUTH_REQUIRED reason=REFRESH_FAILED`);
        }
      } else if (apiResponse.status === 200) {
        console.log('[TokenHealth] API test OK (200)');
      } else {
        console.warn(`[TokenHealth] API retornou status inesperado: ${apiResponse.status}`);
      }
    } catch (apiErr: any) {
      result.apiTestStatus = 0;
      result.apiTestOk = false;
      result.error = `API test falhou: ${apiErr.message}`;
      console.error(`[TokenHealth] API test error: ${apiErr.message}`);
    }

    // Atualizar expiresAt após possível refresh
    if (result.refreshAttempted && result.refreshSuccess) {
      const updatedTokens = await db
        .select({ expiresAt: contaAzulTokens.expiresAt })
        .from(contaAzulTokens)
        .orderBy(desc(contaAzulTokens.createdAt))
        .limit(1);
      
      if (updatedTokens.length > 0) {
        result.tokenExpiresAt = new Date(updatedTokens[0].expiresAt).toISOString();
        result.minutesUntilExpiry = Math.round(
          (new Date(updatedTokens[0].expiresAt).getTime() - Date.now()) / 1000 / 60 * 10
        ) / 10;
      }
    }

    return res.status(200).json(result);
  } catch (error: any) {
    result.decision = 'REAUTH_REQUIRED';
    result.error = error.message;
    result.authUrl = generateAuthUrl();
    console.error('[TokenHealth] Erro inesperado:', error.message);
    return res.status(200).json(result);
  }
});

/**
 * Forçar refresh do token (invalida cache de 5min do getValidAccessToken)
 */
async function forceRefreshAndRetry(): Promise<string> {
  const { refreshAccessToken, saveToken } = await import('./contaAzulOAuthManager');
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  const tokens = await db
    .select({
      refreshToken: contaAzulTokens.refreshToken,
      userId: contaAzulTokens.userId,
    })
    .from(contaAzulTokens)
    .orderBy(desc(contaAzulTokens.createdAt))
    .limit(1);

  if (tokens.length === 0) throw new Error('No token to refresh');

  const newTokenData = await refreshAccessToken(tokens[0].refreshToken);
  
  await saveToken(
    newTokenData.access_token,
    newTokenData.refresh_token || tokens[0].refreshToken,
    newTokenData.expires_in,
    tokens[0].userId || undefined
  );

  return newTokenData.access_token;
}

/**
 * Gerar auth URL para reautorização
 */
function generateAuthUrl(): string {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    return getAuthorizationUrl(state);
  } catch {
    return 'ERRO_AO_GERAR_AUTH_URL';
  }
}

export default router;
