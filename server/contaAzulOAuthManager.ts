/**
 * Gerenciador de tokens OAuth 2.0 do Conta Azul
 * Corrigido para usar endpoints corretos da documentação oficial
 */

import axios from "axios";
import { getDb } from "./db";
import { contaAzulTokens } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// Endpoints corretos conforme documentação oficial
const CONTA_AZUL_AUTH_BASE = "https://auth.contaazul.com";
const CONTA_AZUL_AUTHORIZE_URL = `${CONTA_AZUL_AUTH_BASE}/login`; // Usar /login (não /oauth2/authorize)
const CONTA_AZUL_TOKEN_URL = `${CONTA_AZUL_AUTH_BASE}/oauth2/token`;
const CONTA_AZUL_API_BASE = "https://api.contaazul.com/v1";

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Obter configuração OAuth do ambiente
 * ⚠️ OVERRIDE: Credenciais novas do app Conta Azul (fev/2026)
 * Quando as secrets do Manus forem atualizadas, remover os overrides abaixo
 */
function getOAuthConfig(): OAuthConfig {
  // Override: novas credenciais do app Conta Azul
  const OVERRIDE_CLIENT_ID = '6gsibk3vp3fd4lk4m70hb39vf3';
  const OVERRIDE_CLIENT_SECRET = '1eckb5tl92dq7udsdjmi2i97m471c6h0ab8e2tk26mehb7qcpkb8';

  const clientId = OVERRIDE_CLIENT_ID || process.env.CONTA_AZUL_CLIENT_ID;
  const clientSecret = OVERRIDE_CLIENT_SECRET || process.env.CONTA_AZUL_CLIENT_SECRET;
  // Usar redirect_uri EXATO cadastrado no painel Conta Azul
  // É /api/oauth/callback (interceptado por nós ANTES do Manus OAuth via state detection)
  const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI ;

  if (!clientId || !clientSecret) {
    throw new Error(
      "CONTA_AZUL_CLIENT_ID e CONTA_AZUL_CLIENT_SECRET sao obrigatorios"
    );
  }

  console.log('[OAuth Config] clientId:', clientId.substring(0, 6) + '...');
  console.log('[OAuth Config] redirectUri:', redirectUri);

  return { clientId, clientSecret, redirectUri };
}

/**
 * Gerar header de autenticação Basic Auth
 */
function basicAuthHeader(clientId: string, clientSecret: string): string {
  const credentials = `${clientId}:${clientSecret}`;
  const b64 = Buffer.from(credentials).toString("base64");
  return `Basic ${b64}`;
}

/**
 * Gerar URL de autorização com state
 * Scope fixo do Conta Azul: openid+profile+aws.cognito.signin.user.admin
 * Fonte: https://developers.contaazul.com/requestingcode
 */
export function getAuthorizationUrl(state: string): string {
  if (!state) {
    throw new Error('State dinâmico é obrigatório para segurança CSRF');
  }
  const config = getOAuthConfig();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: "openid profile aws.cognito.signin.user.admin",
  });

  return `${CONTA_AZUL_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Trocar authorization code por access_token e refresh_token
 * @param code - Authorization code recebido do callback
 * @param redirectUri - Redirect URI usado no authorize (DEVE ser idêntico)
 */
export async function exchangeCodeForToken(code: string, redirectUri?: string): Promise<OAuthTokenResponse> {
  const config = getOAuthConfig();
  const finalRedirectUri = redirectUri || config.redirectUri;
  
  const maskLast4 = (s: string) => s ? `...${s.slice(-4)}` : 'EMPTY';

  console.log("[OAuth Exchange] ===== TOKEN EXCHANGE START =====");
  console.log("[OAuth Exchange] tokenEndpointUrl:", CONTA_AZUL_TOKEN_URL);
  console.log("[OAuth Exchange] clientIdPresent:", !!config.clientId, "clientIdLast4:", maskLast4(config.clientId));
  console.log("[OAuth Exchange] clientSecretPresent:", !!config.clientSecret, "clientSecretLast4:", maskLast4(config.clientSecret));
  console.log("[OAuth Exchange] redirectUriUsed:", finalRedirectUri);
  console.log("[OAuth Exchange] code (first 12):", code.substring(0, 12) + "...");
  console.log("[OAuth Exchange] Content-Type: application/x-www-form-urlencoded");
  console.log("[OAuth Exchange] grant_type: authorization_code");

  // Tentar Método 1: client_id/secret no body (sem Basic Auth)
  try {
    console.log("[OAuth Exchange] Tentando M1: client_id/secret no BODY...");
    const bodyParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: finalRedirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    
    const response = await axios.post(
      CONTA_AZUL_TOKEN_URL,
      bodyParams,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      }
    );

    console.log("[OAuth Exchange] M1 SUCESSO! HTTP", response.status);
    console.log("[OAuth Exchange] Response keys:", Object.keys(response.data).join(', '));
    console.log("[OAuth Exchange] ===== TOKEN EXCHANGE END =====");
    return response.data;
  } catch (error1: any) {
    console.warn("[OAuth Exchange] M1 FALHOU. Status:", error1.response?.status, "Body:", JSON.stringify(error1.response?.data || {}).substring(0, 200));
    
    // Tentar Método 2: Basic Auth header
    try {
      console.log("[OAuth Exchange] Tentando M2: Basic Auth header...");
      const response = await axios.post(
        CONTA_AZUL_TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: finalRedirectUri,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: basicAuthHeader(config.clientId, config.clientSecret),
          },
          timeout: 30000,
        }
      );

      console.log("[OAuth Exchange] M2 SUCESSO! HTTP", response.status);
      console.log("[OAuth Exchange] Response keys:", Object.keys(response.data).join(', '));
      console.log("[OAuth Exchange] ===== TOKEN EXCHANGE END =====");
      return response.data;
    } catch (error2: any) {
      console.error("[OAuth Exchange] M2 FALHOU. Status:", error2.response?.status, "Body:", JSON.stringify(error2.response?.data || {}).substring(0, 200));
      console.error("[OAuth Exchange] AMBOS MÉTODOS FALHARAM");
      console.error("[OAuth Exchange] ===== TOKEN EXCHANGE END (ERRO) =====");
      throw error1; // Retornar erro do M1
    }
  }
}

/**
 * Renovar access_token usando refresh_token com Basic Auth
 * ✅ CORRIGIDO: Logging detalhado + tratamento de rotação de refresh_token
 */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
  const config = getOAuthConfig();
  const correlationId = `[REFRESH_${Date.now()}]`;

  console.log(`${correlationId} [OAuth] Iniciando renovacao de token...`);
  console.log(`${correlationId} [OAuth] tokenUrl: ${CONTA_AZUL_TOKEN_URL}`);
  console.log(`${correlationId} [OAuth] content-type: application/x-www-form-urlencoded`);
  console.log(`${correlationId} [OAuth] body keys: grant_type, refresh_token, client_id (via Basic Auth)`);
  console.log(`${correlationId} [OAuth] refresh_token prefix: ${refreshToken.substring(0, 10)}...`);

  try {
    const response = await axios.post(
      CONTA_AZUL_TOKEN_URL,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: basicAuthHeader(config.clientId, config.clientSecret),
        },
        timeout: 30000,
      }
    );

    console.log(`${correlationId} [OAuth] Sucesso! HTTP ${response.status}`);
    console.log(`${correlationId} [OAuth] response keys: ${Object.keys(response.data).join(', ')}`);
    console.log(`${correlationId} [OAuth] access_token prefix: ${(response.data.access_token || '').substring(0, 10)}...`);
    console.log(`${correlationId} [OAuth] refresh_token novo: ${response.data.refresh_token ? 'SIM (sera atualizado)' : 'NAO'}`);
    console.log(`${correlationId} [OAuth] expires_in: ${response.data.expires_in}s`);

    return response.data;
  } catch (err: any) {
    const status = err.response?.status || 0;
    const errorBody = JSON.stringify(err.response?.data || {}).substring(0, 500);
    
    console.error(`${correlationId} [OAuth] ERRO! HTTP ${status}`);
    console.error(`${correlationId} [OAuth] error body: ${errorBody}`);
    
    throw err;
  }
}

/**
 * Persistir token no banco de dados
 * ✅ CORRIGIDO: Pega o token mais recente (orderBy desc) em vez de limit(1) aleatório
 * ✅ NOVO: Trata rotação de refresh_token (atualiza se novo)
 */
export async function saveToken(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  userId?: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const now = new Date();

  console.log("[OAuth] Salvando token no banco...");
  console.log("[OAuth] access_token prefix:", accessToken.substring(0, 10) + "...");
  console.log("[OAuth] refresh_token novo:", refreshToken ? "SIM" : "NAO");
  console.log("[OAuth] expiresAt:", expiresAt.toISOString());

  // DELETE todos os tokens antigos para garantir apenas 1 token
  await db.delete(contaAzulTokens);
  console.log("[OAuth] Tokens antigos deletados");

  // INSERT novo token
  await db
    .insert(contaAzulTokens)
    .values({
      accessToken,
      refreshToken,
      expiresAt,
      userId,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    });

  console.log("[OAuth] Token salvo com sucesso");
}

/**
 * Obter token válido (renovar se necessário)
 * ✅ NOVO: Trata rotação de refresh_token
 */
export async function getValidAccessToken(userId?: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Buscar token mais recente
  const tokens = await db
    .select()
    .from(contaAzulTokens)
    .where(userId ? eq(contaAzulTokens.userId, userId) : undefined)
    .orderBy(desc(contaAzulTokens.createdAt))
    .limit(1);

  const token = tokens[0];

  if (!token) {
    throw new Error("Nenhum token encontrado. Reautorize via /oauth");
  }

  // Verificar se token está expirado
  const now = new Date();
  const expiresAt = new Date(token.expiresAt);
  const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / 1000 / 60;

  console.log(`[OAuth] Token expira em ${minutesUntilExpiry.toFixed(1)} minutos`);

  // Se expira em menos de 5 minutos, renovar
  if (minutesUntilExpiry < 5) {
    console.log("[OAuth] Token expirando em breve, renovando...");

    try {
      const newTokenData = await refreshAccessToken(token.refreshToken);
      
      // Salvar novo token (IMPORTANTE: se refresh_token mudou, atualizar!)
      await saveToken(
        newTokenData.access_token,
        newTokenData.refresh_token || token.refreshToken, // Se não houver novo, manter antigo
        newTokenData.expires_in,
        token.userId || undefined
      );

      console.log("[OAuth] Token renovado com sucesso");
      return newTokenData.access_token;
    } catch (err: any) {
      const status = err.response?.status || 0;
      
      if (status === 400) {
        console.error("[OAuth] ERRO 400 ao renovar: refresh_token pode estar inválido");
        throw new Error("REFRESH_TOKEN_INVALID: Reautorize via /oauth");
      }

      console.error("[OAuth] Falha ao renovar token com refresh_token antigo.", err);
      throw new Error("Token expirado e refresh_token invalido. Reautorize via UI.");
    }
  }

  return token.accessToken;
}

/**
 * Verificar se existe token válido
 */
export async function hasValidToken(userId?: number): Promise<boolean> {
  try {
    await getValidAccessToken(userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Limpar token do banco de dados
 */
export async function clearToken(userId?: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  console.log("[OAuth] Limpando token do banco...");

  if (userId) {
    await db.delete(contaAzulTokens).where(eq(contaAzulTokens.userId, userId));
  } else {
    await db.delete(contaAzulTokens);
  }

  console.log("[OAuth] Token removido com sucesso");
}
