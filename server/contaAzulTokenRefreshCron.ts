/**
 * Cron Job para Refresh Automático de Token Conta Azul
 * 
 * Correção estrutural 09/03/2026:
 * - Persiste lastRefreshAt, lastRefreshStatus, lastRefreshError, consecutiveFailures, needsReauth
 * - Alerta owner apenas após 3 falhas consecutivas (evita spam)
 * - Marca needsReauth=true após 3 falhas → bloqueia régua até reautorizar
 * - Reseta consecutiveFailures e needsReauth após refresh bem-sucedido
 * - Refresh proativo: renova quando falta < 10 min (não 5)
 * 
 * Uso:
 * startTokenRefreshCron() - Iniciar cron job
 * stopTokenRefreshCron() - Parar cron job
 * getTokenStatus() - Status completo do token
 * forceTokenRefreshCheck() - Forçar verificação imediata
 */

import { CronJob } from 'cron';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { desc, eq } from 'drizzle-orm';
import { refreshAccessToken, saveToken } from './contaAzulOAuthManager';
import { notifyOwner } from './_core/notification';

let cronJob: CronJob | null = null;

// Refresh quando falta < 10 min (mais margem de segurança)
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;
const CRON_SCHEDULE = '*/5 * * * *'; // A cada 5 minutos (mais frequente)
const MAX_FAILURES_BEFORE_ALERT = 3;
const MAX_FAILURES_BEFORE_REAUTH = 3;

/**
 * Verificar e renovar token se necessário
 */
async function checkAndRefreshToken(): Promise<void> {
  const correlationId = `[CronRefresh_${Date.now()}]`;
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`${correlationId} Database not available`);
      return;
    }

    // Obter token mais recente
    const tokens = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.updatedAt))
      .limit(1);

    if (!tokens.length) {
      console.log(`${correlationId} Nenhum token armazenado`);
      return;
    }

    const tokenRecord = tokens[0];
    const now = Date.now();
    const expiresAt = tokenRecord.expiresAt?.getTime() || 0;
    const timeUntilExpiry = expiresAt - now;
    const minutesLeft = Math.round(timeUntilExpiry / 60000);

    // Se já marcado como needsReauth, não tentar refresh (esperar reautorização manual)
    if (tokenRecord.needsReauth) {
      console.log(`${correlationId} ⚠️ Token marcado como needsReauth — aguardando reautorização manual`);
      console.log(`${correlationId} consecutiveFailures=${tokenRecord.consecutiveFailures}, lastError=${tokenRecord.lastRefreshError}`);
      return;
    }

    console.log(`${correlationId} Token expira em ${minutesLeft}min (${Math.round(timeUntilExpiry / 1000)}s)`);

    // Se expira em menos de 10 minutos, fazer refresh
    if (timeUntilExpiry < REFRESH_THRESHOLD_MS) {
      console.log(`${correlationId} ⏱️ Token expirando em ${minutesLeft}min, fazendo refresh...`);

      try {
        const newTokenData = await refreshAccessToken(tokenRecord.refreshToken);
        console.log(`${correlationId} ✅ Token renovado com sucesso`);

        // Salvar novo token via saveToken (que deleta antigos e insere novo)
        await saveToken(
          newTokenData.access_token,
          newTokenData.refresh_token || tokenRecord.refreshToken,
          newTokenData.expires_in,
          tokenRecord.userId || undefined
        );

        // Atualizar campos de tracking no token recém-inserido
        const newTokens = await db
          .select()
          .from(contaAzulTokens)
          .orderBy(desc(contaAzulTokens.updatedAt))
          .limit(1);

        if (newTokens.length) {
          await db
            .update(contaAzulTokens)
            .set({
              lastRefreshAt: new Date(),
              lastRefreshStatus: 'success',
              lastRefreshError: null,
              consecutiveFailures: 0,
              needsReauth: false,
            })
            .where(eq(contaAzulTokens.id, newTokens[0].id));
        }

        const newExpiresAt = new Date(now + (newTokenData.expires_in * 1000));
        console.log(`${correlationId} Novo token expira em ${Math.round((newExpiresAt.getTime() - now) / 1000)}s`);
        console.log(`${correlationId} consecutiveFailures resetado para 0`);

      } catch (error: any) {
        const status = error.response?.status || 0;
        const errorBody = JSON.stringify(error.response?.data || {}).substring(0, 200);
        const errorMsg = `HTTP ${status}: ${errorBody || error.message}`;
        
        console.error(`${correlationId} ❌ Falha ao renovar token: ${errorMsg}`);

        // Incrementar falhas consecutivas
        const newFailures = (tokenRecord.consecutiveFailures || 0) + 1;
        const shouldMarkReauth = newFailures >= MAX_FAILURES_BEFORE_REAUTH;

        // Atualizar tracking no banco
        await db
          .update(contaAzulTokens)
          .set({
            lastRefreshAt: new Date(),
            lastRefreshStatus: 'failed',
            lastRefreshError: errorMsg,
            consecutiveFailures: newFailures,
            needsReauth: shouldMarkReauth,
          })
          .where(eq(contaAzulTokens.id, tokenRecord.id));

        console.log(`${correlationId} consecutiveFailures=${newFailures}, needsReauth=${shouldMarkReauth}`);

        // Alertar owner após MAX_FAILURES_BEFORE_ALERT falhas consecutivas
        if (newFailures >= MAX_FAILURES_BEFORE_ALERT) {
          console.log(`${correlationId} 🚨 Enviando alerta ao owner (${newFailures} falhas consecutivas)`);
          try {
            await notifyOwner({
              title: `🚨 OAuth Conta Azul: ${newFailures} falhas consecutivas de refresh`,
              content: `O refresh automático do token Conta Azul falhou ${newFailures} vezes consecutivas.

**Último erro:** ${errorMsg}
**Ação necessária:** Reconectar via Dashboard → Técnico → "Reconectar Conta Azul"
**Impacto:** Sync de pagamentos e régua de cobrança estão parados.

${shouldMarkReauth ? '⛔ Token marcado como needsReauth — refresh automático PARADO até reautorização.' : '⏳ Próxima tentativa em 5 minutos.'}`,
            });
          } catch (notifyErr: any) {
            console.error(`${correlationId} Falha ao notificar owner:`, notifyErr.message);
          }
        }
      }
    } else {
      console.log(`${correlationId} ✅ Token válido por mais ${minutesLeft}min`);
    }
  } catch (error: any) {
    console.error(`${correlationId} Erro geral ao verificar token:`, error.message);
  }
}

/**
 * Iniciar cron job
 */
export function startTokenRefreshCron(): void {
  if (cronJob) {
    console.warn('[TokenRefreshCron] Cron job já está em execução');
    return;
  }

  console.log('[TokenRefreshCron] 🚀 Iniciando cron job (a cada 5 min, threshold 10 min)');

  cronJob = new CronJob(
    CRON_SCHEDULE,
    async () => {
      console.log(`[TokenRefreshCron] ⏰ Verificação em ${new Date().toISOString()}`);
      await checkAndRefreshToken();
    },
    null,
    true,
    'UTC'
  );

  console.log('[TokenRefreshCron] ✅ Cron job iniciado');
}

/**
 * Parar cron job
 */
export function stopTokenRefreshCron(): void {
  if (!cronJob) {
    console.warn('[TokenRefreshCron] Cron job não está em execução');
    return;
  }

  cronJob.stop();
  cronJob = null;
  console.log('[TokenRefreshCron] ⏹️ Cron job parado');
}

/**
 * Verificar status do cron job
 */
export function isTokenRefreshCronRunning(): boolean {
  return cronJob !== null;
}

/**
 * Forçar verificação imediata (útil para testes e UI)
 */
export async function forceTokenRefreshCheck(): Promise<void> {
  console.log('[TokenRefreshCron] 🔄 Forçando verificação imediata...');
  await checkAndRefreshToken();
}

/**
 * Obter status completo do token (para UI e diagnóstico)
 */
export async function getTokenStatus(): Promise<{
  ok: boolean;
  hasToken: boolean;
  expiresIn?: number;
  lastRefresh?: Date;
  lastRefreshStatus?: string | null;
  lastRefreshError?: string | null;
  consecutiveFailures?: number;
  needsReauth?: boolean;
  cronRunning: boolean;
}> {
  try {
    const db = await getDb();
    if (!db) {
      return { ok: false, hasToken: false, cronRunning: isTokenRefreshCronRunning() };
    }

    const tokens = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.updatedAt))
      .limit(1);

    if (!tokens.length) {
      return { ok: false, hasToken: false, cronRunning: isTokenRefreshCronRunning() };
    }

    const tokenRecord = tokens[0];
    const now = Date.now();
    const expiresAt = tokenRecord.expiresAt?.getTime() || 0;
    const expiresIn = Math.round((expiresAt - now) / 1000);

    return {
      ok: expiresIn > 0 && !tokenRecord.needsReauth,
      hasToken: true,
      expiresIn,
      lastRefresh: tokenRecord.lastRefreshAt || tokenRecord.updatedAt,
      lastRefreshStatus: tokenRecord.lastRefreshStatus,
      lastRefreshError: tokenRecord.lastRefreshError,
      consecutiveFailures: tokenRecord.consecutiveFailures || 0,
      needsReauth: tokenRecord.needsReauth || false,
      cronRunning: isTokenRefreshCronRunning(),
    };
  } catch (error: any) {
    console.error('[TokenRefreshCron] Erro ao obter status:', error.message);
    return { ok: false, hasToken: false, cronRunning: isTokenRefreshCronRunning() };
  }
}

/**
 * Resetar needsReauth após reautorização bem-sucedida (chamado pelo callback handler)
 */
export async function resetReauthFlag(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db
      .update(contaAzulTokens)
      .set({
        needsReauth: false,
        consecutiveFailures: 0,
        lastRefreshStatus: 'success',
        lastRefreshError: null,
        lastRefreshAt: new Date(),
      });

    console.log('[TokenRefreshCron] ✅ needsReauth resetado após reautorização');
  } catch (error: any) {
    console.error('[TokenRefreshCron] Erro ao resetar needsReauth:', error.message);
  }
}
