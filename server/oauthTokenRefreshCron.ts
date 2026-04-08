/**
 * Job Cron para Verificação Periódica de Token OAuth
 * Executa a cada X minutos para renovar tokens expirados
 */

import * as cron from 'node-cron';
import { getDb } from './db';
import { contaAzulTokens, users } from '../drizzle/schema';
import { refreshAccessToken, isTokenExpiringSoon } from './oauthTokenRefreshService';
import { notifyOwner } from './_core/notification';
import { shouldSendOAuthAlert } from './oauthAlertCooldown';

const CONTA_AZUL_CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID || '';
const CONTA_AZUL_CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET || '';

/**
 * Inicia o job cron de verificação de tokens
 * Executa a cada 10 minutos
 */
export function startTokenRefreshCron() {
  // Desabilitar via ENV: OAUTH_TOKEN_CHECK_ENABLED=false
  if (process.env.OAUTH_TOKEN_CHECK_ENABLED !== 'true') {
    console.log('[OAuthCron] ⏹️ Job cron desabilitado (OAUTH_TOKEN_CHECK_ENABLED !== true)');
    return null;
  }
  
  // Executar a cada 10 minutos
  const job = cron.schedule('*/10 * * * *', async () => {
    console.log('[OAuthCron] 🔄 Iniciando verificação periódica de tokens...');
    try {
      await checkAndRefreshAllTokens();
    } catch (error) {
      console.error('[OAuthCron] ❌ Erro na verificação periódica:', error);
    }
  });

  console.log('[OAuthCron] ✅ Job cron iniciado: verificação a cada 10 minutos');
  return job;
}

/**
 * Verifica e renova todos os tokens expirados
 */
async function checkAndRefreshAllTokens() {
  try {
    const db = await getDb();
    if (!db) {
      console.error('[OAuthCron] ❌ Banco de dados não disponível');
      return;
    }

    // Buscar todos os tokens armazenados
    const allTokens = await db.select().from(contaAzulTokens);

    if (!allTokens || allTokens.length === 0) {
      console.log('[OAuthCron] ℹ️ Nenhum token armazenado para verificar');
      return;
    }

    console.log(`[OAuthCron] 📊 Verificando ${allTokens.length} token(s)...`);

    let renewedCount = 0;
    let failedCount = 0;

    for (const token of allTokens) {
      try {
        const isExpiring = await isTokenExpiringSoon(token.userId || 0, 5);

        if (isExpiring) {
          console.log(`[OAuthCron] ⏰ Token do usuário ${token.userId} próximo da expiração, renovando...`);
          
          const result = await refreshAccessToken(
            token.userId || 0,
            CONTA_AZUL_CLIENT_ID,
            CONTA_AZUL_CLIENT_SECRET
          );

          if (result.success) {
            renewedCount++;
            console.log(`[OAuthCron] ✅ Token renovado para usuário ${token.userId}`);
          } else {
            failedCount++;
            console.error(`[OAuthCron] ❌ Falha ao renovar token para usuário ${token.userId}: ${result.error}`);
          }
        } else {
          console.log(`[OAuthCron] ℹ️ Token do usuário ${token.userId} ainda válido`);
        }
      } catch (error) {
        failedCount++;
        console.error(`[OAuthCron] ❌ Erro ao processar token do usuário ${token.userId}:`, error);
      }
    }

    // Registrar resumo
    console.log(`[OAuthCron] 📈 Resumo: ${renewedCount} renovado(s), ${failedCount} falha(s)`);

    // Notificar se houver falhas (com cooldown 24h)
    if (failedCount > 0 && process.env.OAUTH_ALERTS_ENABLED === 'true') {
      if (shouldSendOAuthAlert()) {
        await notifyOwner({
          title: '⚠️ Falhas na Verificação de Tokens OAuth',
          content: `
Relatório da verificação periódica de tokens OAuth:

**Tokens Verificados:** ${allTokens.length}
**Renovados com Sucesso:** ${renewedCount}
**Falhas:** ${failedCount}

Por favor, verifique os logs para mais detalhes.
        `,
        });
      }
    }
  } catch (error) {
    console.error('[OAuthCron] ❌ Erro ao verificar tokens:', error);
    if (process.env.OAUTH_ALERTS_ENABLED === 'true') {
      await notifyOwner({
        title: '❌ Erro no Job de Verificação de Tokens',
        content: `
Ocorreu um erro ao executar o job de verificação periódica de tokens OAuth:

**Erro:** ${error instanceof Error ? error.message : 'Erro desconhecido'}
**Timestamp:** ${new Date().toLocaleString('pt-BR')}

Por favor, verifique os logs do servidor.
      `,
      });
    }
  }
}

/**
 * Para o job cron
 */
export function stopTokenRefreshCron(job: any) {
  job.stop();
  console.log('[OAuthCron] ⏹️ Job cron parado');
}

/**
 * Executa verificação manual imediatamente
 */
export async function runTokenRefreshCheckNow() {
  console.log('[OAuthCron] 🚀 Executando verificação manual de tokens...');
  await checkAndRefreshAllTokens();
  console.log('[OAuthCron] ✅ Verificação manual concluída');
}
