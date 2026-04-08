/**
 * Serviço de Refresh Automático de Token OAuth
 * Renova access_token automaticamente antes da expiração
 */

import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { notifyOwner } from './_core/notification';
import crypto from 'crypto';

export interface TokenRefreshResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: Date;
  error?: string;
  timestamp: Date;
}

/**
 * Criptografa token para armazenamento seguro
 */
function encryptToken(token: string, secret: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Descriptografa token armazenado
 */
function decryptToken(encryptedToken: string, secret: string): string {
  const [iv, encrypted] = encryptedToken.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32, '0').slice(0, 32)), Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Renova access_token usando refresh_token
 */
export async function refreshAccessToken(userId: number, clientId: string, clientSecret: string): Promise<TokenRefreshResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Banco de dados não disponível');

    // Buscar tokens armazenados
    const storedTokens = await db
      .select()
      .from(contaAzulTokens)
      .where(eq(contaAzulTokens.userId, userId));

    if (!storedTokens || storedTokens.length === 0) {
      throw new Error('Nenhum token armazenado para este usuário');
    }

    const tokenRecord = storedTokens[0];
    const encryptionSecret = process.env.ENCRYPTION_SECRET || 'default-secret';
    
    // Descriptografar refresh_token
    let refreshToken = '';
    try {
      refreshToken = decryptToken(tokenRecord.refreshToken, encryptionSecret);
    } catch (error) {
      console.error('[OAuthRefresh] Erro ao descriptografar refresh_token:', error);
      throw new Error('Falha ao descriptografar refresh_token');
    }

    // Fazer requisição para renovar token
    const response = await fetch('https://api.contaazul.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Erro ao renovar token: ${errorData.error_description || response.statusText}`);
    }

    const data = await response.json();

    // Criptografar novos tokens
    const encryptedAccessToken = encryptToken(data.access_token, encryptionSecret);
    const encryptedRefreshToken = encryptToken(data.refresh_token, encryptionSecret);
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Atualizar tokens no banco
    await db
      .update(contaAzulTokens)
      .set({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(contaAzulTokens.userId, userId));

    console.log(`[OAuthRefresh] ✅ Token renovado com sucesso para usuário ${userId}`);

    return {
      success: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt,
      timestamp: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[OAuthRefresh] ❌ Erro ao renovar token:', errorMessage);

    // Notificar administrador
    await notifyOwner({
      title: '❌ Erro ao Renovar Token OAuth',
      content: `
Falha ao renovar token OAuth do Conta Azul:

**Erro:** ${errorMessage}
**Usuário:** ${userId}
**Timestamp:** ${new Date().toLocaleString('pt-BR')}

Por favor, verifique as credenciais e tente reautenticar manualmente.
      `,
    });

    return {
      success: false,
      error: errorMessage,
      timestamp: new Date(),
    };
  }
}

/**
 * Verifica se token está próximo da expiração
 */
export async function isTokenExpiringSoon(userId: number, minutesThreshold: number = 5): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return true;

    const tokens = await db
      .select()
      .from(contaAzulTokens)
      .where(eq(contaAzulTokens.userId, userId));

    if (!tokens || tokens.length === 0) return true;

    const tokenRecord = tokens[0];
    const expiresAt = new Date(tokenRecord.expiresAt);
    const now = new Date();
    const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60);

    return minutesUntilExpiry < minutesThreshold;
  } catch (error) {
    console.error('[OAuthRefresh] Erro ao verificar expiração:', error);
    return true;
  }
}

/**
 * Obtém access_token válido, renovando se necessário
 */
export async function getValidAccessToken(
  userId: number,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  try {
    // Verificar se token está próximo da expiração
    const isExpiring = await isTokenExpiringSoon(userId, 5);

    if (isExpiring) {
      console.log('[OAuthRefresh] ⏰ Token próximo da expiração, renovando...');
      const result = await refreshAccessToken(userId, clientId, clientSecret);
      if (!result.success) {
        throw new Error(result.error || 'Falha ao renovar token');
      }
      return result.accessToken || null;
    }

    // Token ainda é válido, buscar do banco
    const db = await getDb();
    if (!db) return null;

    const tokens = await db
      .select()
      .from(contaAzulTokens)
      .where(eq(contaAzulTokens.userId, userId));

    if (!tokens || tokens.length === 0) return null;

    const encryptionSecret = process.env.ENCRYPTION_SECRET || 'default-secret';
    const decryptedToken = decryptToken(tokens[0].accessToken, encryptionSecret);
    return decryptedToken;
  } catch (error) {
    console.error('[OAuthRefresh] Erro ao obter token válido:', error);
    return null;
  }
}

/**
 * Agenda verificação periódica de tokens
 */
export function scheduleTokenRefreshCheck(
  userId: number,
  clientId: string,
  clientSecret: string,
  intervalMinutes: number = 10
) {
  setInterval(async () => {
    try {
      const isExpiring = await isTokenExpiringSoon(userId, 5);
      if (isExpiring) {
        console.log('[OAuthRefresh] 🔄 Verificação periódica: renovando token...');
        const result = await refreshAccessToken(userId, clientId, clientSecret);
        if (result.success) {
          console.log('[OAuthRefresh] ✅ Token renovado na verificação periódica');
        } else {
          console.error('[OAuthRefresh] ❌ Falha na verificação periódica:', result.error);
        }
      } else {
        console.log('[OAuthRefresh] ℹ️ Token ainda válido');
      }
    } catch (error) {
      console.error('[OAuthRefresh] Erro na verificação periódica:', error);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`[OAuthRefresh] ✅ Verificação periódica agendada a cada ${intervalMinutes} minutos`);
}

/**
 * Armazena novo token de forma segura
 */
export async function storeTokenSecurely(
  userId: number,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Banco de dados não disponível');

    const encryptionSecret = process.env.ENCRYPTION_SECRET || 'default-secret';
    const encryptedAccessToken = encryptToken(accessToken, encryptionSecret);
    const encryptedRefreshToken = encryptToken(refreshToken, encryptionSecret);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Verificar se já existe token para este usuário
    const existing = await db
      .select()
      .from(contaAzulTokens)
      .where(eq(contaAzulTokens.userId, userId));

    if (existing && existing.length > 0) {
      // Atualizar token existente
      await db
        .update(contaAzulTokens)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(contaAzulTokens.userId, userId));
    } else {
      // Inserir novo token
      await db.insert(contaAzulTokens).values({
        userId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(`[OAuthRefresh] ✅ Token armazenado com segurança para usuário ${userId}`);
    return true;
  } catch (error) {
    console.error('[OAuthRefresh] ❌ Erro ao armazenar token:', error);
    return false;
  }
}
