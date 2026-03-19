import axios, { AxiosError } from 'axios';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: string;
}

interface RefreshResult {
  success: boolean;
  accessToken?: string;
  expiresAt?: Date;
  error?: string;
}

/**
 * Token Manager para Conta Azul
 * Gerencia refresh automático de tokens OAuth
 */
export class ContaAzulTokenManager {
  private static readonly REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos
  private static readonly TOKEN_ENDPOINT = 'https://auth.contaazul.com/oauth2/token';
  private static readonly CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID || '6gsibk3vp3fd4lk4m70hb39vf3';
  private static readonly CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET || '1eckb5tl92dq7udsdjmi2i97m471c6h0ab8e2tk26mehb7qcpkb8';

  /**
   * Obter token válido, fazendo refresh se necessário
   */
  static async getValidAccessToken(userId: number = 1): Promise<string> {
    try {
      const db = await getDb();
      if (!db) throw new Error('Database connection failed');

      // Buscar token no banco
      const result = await db
        .select()
        .from(contaAzulTokens)
        .where(eq(contaAzulTokens.userId, userId))
        .limit(1);

      if (!result || result.length === 0) {
        throw new Error('REAUTHORIZE_REQUIRED');
      }

      const token = result[0];

      // Verificar se precisa fazer refresh
      const now = new Date();
      const expiresAt = new Date(token.expiresAt);
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      console.log('[TokenManager] Token check:');
      console.log('[TokenManager]   expiresAt:', expiresAt.toISOString());
      console.log('[TokenManager]   timeUntilExpiry:', Math.round(timeUntilExpiry / 1000), 'segundos');
      console.log('[TokenManager]   needsRefresh:', timeUntilExpiry < this.REFRESH_THRESHOLD_MS);

      // Se expira em menos de 5 minutos, tentar refresh
      if (timeUntilExpiry < this.REFRESH_THRESHOLD_MS) {
        console.log('[TokenManager] ⏳ Token expirando em breve, tentando refresh...');
        const refreshResult = await this.refreshAccessToken(token.refreshToken, userId);

        if (refreshResult.success) {
          console.log('[TokenManager] ✅ Token renovado com sucesso');
          return refreshResult.accessToken!;
        }

        // Se refresh falhar mas accessToken ainda válido, usar mesmo assim
        if (timeUntilExpiry > 0) {
          console.log('[TokenManager] ⚠️ Refresh falhou, mas accessToken ainda válido. Usando mesmo assim.');
          console.log('[TokenManager] finalDecision: use_access_token_anyway');
          return token.accessToken;
        }

        // Se refresh falhou E token expirou, requer reautorização
        throw new Error('REAUTHORIZE_REQUIRED');
      }

      // Token ainda válido
      console.log('[TokenManager] ✅ Token válido');
      console.log('[TokenManager] finalDecision: use_access_token');
      return token.accessToken;
    } catch (error: any) {
      console.error('[TokenManager] ❌ Erro ao obter token:', error.message);
      throw error;
    }
  }

  /**
   * Fazer refresh do access_token usando refresh_token
   */
  static async refreshAccessToken(refreshToken: string, userId: number = 1): Promise<RefreshResult> {
    try {
      console.log('[TokenManager] Enviando refresh_token para:', this.TOKEN_ENDPOINT);

      const credentials = `${this.CLIENT_ID}:${this.CLIENT_SECRET}`;
      const b64 = Buffer.from(credentials).toString('base64');
      const basicAuth = `Basic ${b64}`;

      const response = await axios.post(
        this.TOKEN_ENDPOINT,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
        {
          headers: {
            'Authorization': basicAuth,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15000,
        }
      );

      const data = response.data;
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);

      console.log('[TokenManager] ✅ Refresh bem-sucedido');
      console.log('[TokenManager]   novo accessToken (últimos 6):', data.access_token.substring(data.access_token.length - 6));
      console.log('[TokenManager]   novo expiresAt:', expiresAt.toISOString());

      // Salvar novo token no banco
      const db = await getDb();
      if (!db) throw new Error('Database connection failed');

      await db
        .update(contaAzulTokens)
        .set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(contaAzulTokens.userId, userId));

      console.log('[TokenManager] 💾 Token atualizado no banco');

      return {
        success: true,
        accessToken: data.access_token,
        expiresAt,
      };
    } catch (error: any) {
      console.error('[TokenManager] ❌ Erro ao fazer refresh:', error.message);
      console.error('[TokenManager]   Status:', error.response?.status);
      console.error('[TokenManager]   Details:', error.response?.data);

      return {
        success: false,
        error: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Interceptor para axios que faz refresh automático em 401/403
   */
  static createAxiosInterceptor(axiosInstance: typeof axios) {
    axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        // Se já tentou retry, não tentar de novo
        if (originalRequest._retry) {
          console.log('[TokenManager] ❌ Retry falhou, retornando erro');
          return Promise.reject(error);
        }

        // Se é 401 ou 403, tentar refresh
        if (error.response?.status === 401 || error.response?.status === 403) {
          console.log('[TokenManager] ⚠️ Recebido 401/403, tentando refresh...');
          originalRequest._retry = true;

          try {
            // Obter novo token (isso vai fazer refresh se necessário)
            const newToken = await this.getValidAccessToken();

            // Atualizar header Authorization
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;

            // Reexecutar request original
            console.log('[TokenManager] 🔄 Reexecutando request original com novo token');
            return axiosInstance(originalRequest);
          } catch (refreshError) {
            console.error('[TokenManager] ❌ Refresh falhou:', refreshError);
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }
}

export default ContaAzulTokenManager;
