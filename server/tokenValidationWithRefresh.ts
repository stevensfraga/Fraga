/**
 * 🔐 Token Validation with Automatic Refresh
 * Valida token e faz refresh automático se expirado
 */

import axios from 'axios';
import { getValidAccessToken, refreshAccessToken } from './contaAzulOAuthManager';

export interface TokenValidationResult {
  ok: boolean;
  token: string | null;
  error?: string;
  errorCode?: string;
  requiresReauthorization?: boolean;
  attemptDetails?: Array<{
    attempt: number;
    url: string;
    status: number | null;
    bodyPreview?: string;
    latencyMs: number;
    traceId?: string;
  }>;
}

/**
 * Validar token com múltiplas tentativas (sem pagina/tamanho_pagina)
 */
export async function validateTokenWithFallback(
  clientId: number,
  traceId: string
): Promise<TokenValidationResult> {
  const attempts: TokenValidationResult['attemptDetails'] = [];
  
  try {
    let token = await getValidAccessToken();
    if (!token) {
      return {
        ok: false,
        token: null,
        error: 'No access token available',
        errorCode: 'NO_TOKEN',
      };
    }

    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';
    
    // Estratégias de validação (sem pagina/tamanho_pagina)
    const strategies = [
      { url: `${baseUrl}/pessoas`, params: {} },
      { url: `${baseUrl}/pessoas`, params: { limit: 1 } },
      { url: `${baseUrl}/pessoas`, params: { page: 1, size: 1 } },
    ];

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      const startTime = Date.now();
      const latencyMs = Date.now() - startTime;

      try {
        const response = await axios.get(strategy.url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          params: strategy.params,
          timeout: 10000,
          validateStatus: () => true,
        });

        const bodyPreview = JSON.stringify(response.data).substring(0, 200);

        attempts.push({
          attempt: i + 1,
          url: strategy.url + (Object.keys(strategy.params).length > 0 
            ? `?${new URLSearchParams(strategy.params as any).toString()}`
            : ''),
          status: response.status,
          bodyPreview,
          latencyMs,
          traceId,
        });

        // Sucesso: status 200 ou 400 (parâmetros inválidos, mas token ok)
        if (response.status === 200) {
          return {
            ok: true,
            token,
            attemptDetails: attempts,
          };
        }

        // Erro de autenticação: 401/403 ou JWT error
        if (response.status === 401 || response.status === 403) {
          const errorMsg = response.data?.fault?.faultstring || 'Authentication failed';
          
          // Tentar refresh se JWT error
          if (errorMsg.includes('JWT') || errorMsg.includes('token')) {
            console.log(`[TokenValidation] Attempting refresh after JWT error...`);
            try {
              const refreshResult = await refreshAccessToken(clientId.toString());
              if (refreshResult && refreshResult.access_token) {
                token = refreshResult.access_token;
                // Retry uma vez com novo token
                const retryResponse = await axios.get(strategy.url, {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                  },
                  params: strategy.params,
                  timeout: 10000,
                  validateStatus: () => true,
                });

                if (retryResponse.status === 200) {
                  return {
                    ok: true,
                    token,
                    attemptDetails: attempts,
                  };
                }
              } else {
                return {
                  ok: false,
                  token: null,
                  error: 'Refresh failed - reauthorization required',
                  errorCode: 'REAUTHORIZE_REQUIRED',
                  requiresReauthorization: true,
                  attemptDetails: attempts,
                };
              }
            } catch (refreshError: any) {
              return {
                ok: false,
                token: null,
                error: `Refresh failed: ${refreshError?.message}`,
                errorCode: 'REFRESH_FAILED',
                requiresReauthorization: true,
                attemptDetails: attempts,
              };
            }
          }

          return {
            ok: false,
            token: null,
            error: `Authentication failed: ${errorMsg}`,
            errorCode: 'AUTH_FAILED',
            attemptDetails: attempts,
          };
        }

        // 400: parâmetros inválidos, continuar para próxima estratégia
        if (response.status === 400) {
          continue;
        }

        // Outro status: continuar
        continue;
      } catch (error: any) {
        attempts.push({
          attempt: i + 1,
          url: strategy.url,
          status: null,
          bodyPreview: error.message,
          latencyMs,
          traceId,
        });
        continue;
      }
    }

    // Nenhuma estratégia funcionou
    return {
      ok: false,
      token: null,
      error: 'All token validation strategies failed',
      errorCode: 'VALIDATION_FAILED',
      attemptDetails: attempts,
    };
  } catch (error: any) {
    return {
      ok: false,
      token: null,
      error: error?.message,
      errorCode: 'VALIDATION_ERROR',
    };
  }
}
