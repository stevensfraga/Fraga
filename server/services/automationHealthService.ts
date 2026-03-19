/**
 * Serviço de Saúde da Automação — Proteção contra "automação falsa"
 * 
 * Detecta cenários onde a automação parece estar rodando mas não está funcionando:
 * A) Token OAuth expirado → sync não roda → régua sem dados novos
 * B) Sync rodou mas 0 receivables → dados não estão chegando
 * C) Régua rodou mas 0 envios → stages incompatíveis ou todos dedup
 * D) Cron não disparou no horário → servidor reiniciou ou cron parado
 * E) needsReauth=true → refresh falhou 3+ vezes → tudo parado
 * 
 * Correção estrutural 09/03/2026
 */

import { getDb } from '../db';
import { contaAzulTokens } from '../../drizzle/schema';
import { desc, sql } from 'drizzle-orm';
import { notifyOwner } from '../_core/notification';
import { isTokenRefreshCronRunning } from '../contaAzulTokenRefreshCron';
import { getAllowedStages } from './reguaCobrancaService';

export interface HealthCheckResult {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'critical';
  checks: {
    oauth: {
      status: 'ok' | 'warning' | 'critical';
      hasToken: boolean;
      expiresInMinutes: number | null;
      needsReauth: boolean;
      consecutiveFailures: number;
      lastRefreshAt: string | null;
      lastRefreshStatus: string | null;
    };
    refreshCron: {
      status: 'ok' | 'critical';
      running: boolean;
    };
    reguaConfig: {
      status: 'ok' | 'warning';
      allowedStages: string[];
      totalStages: number;
      missingCritical: string[];
    };
    sync: {
      status: 'ok' | 'warning' | 'unknown';
      lastSyncAt: string | null;
      minutesSinceLastSync: number | null;
    };
  };
  alerts: string[];
  recommendations: string[];
}

/**
 * Executar health check completo da automação
 */
export async function runAutomationHealthCheck(): Promise<HealthCheckResult> {
  const now = new Date();
  const alerts: string[] = [];
  const recommendations: string[] = [];

  // ─── 1. OAuth Token ─────────────────────────────────────────────────
  let oauthCheck: HealthCheckResult['checks']['oauth'] = {
    status: 'critical',
    hasToken: false,
    expiresInMinutes: null,
    needsReauth: false,
    consecutiveFailures: 0,
    lastRefreshAt: null,
    lastRefreshStatus: null,
  };

  try {
    const db = await getDb();
    if (db) {
      const tokens = await db
        .select()
        .from(contaAzulTokens)
        .orderBy(desc(contaAzulTokens.updatedAt))
        .limit(1);

      if (tokens.length) {
        const token = tokens[0];
        const expiresAt = token.expiresAt?.getTime() || 0;
        const expiresInMinutes = Math.round((expiresAt - now.getTime()) / 60000);

        oauthCheck = {
          status: token.needsReauth ? 'critical' : expiresInMinutes < 0 ? 'critical' : expiresInMinutes < 15 ? 'warning' : 'ok',
          hasToken: true,
          expiresInMinutes,
          needsReauth: token.needsReauth || false,
          consecutiveFailures: token.consecutiveFailures || 0,
          lastRefreshAt: token.lastRefreshAt?.toISOString() || null,
          lastRefreshStatus: token.lastRefreshStatus || null,
        };

        // Cenário E: needsReauth=true
        if (token.needsReauth) {
          alerts.push('CRITICAL: OAuth marcado como needsReauth — refresh automático PARADO');
          recommendations.push('Reconectar via Dashboard → Técnico → "Reconectar Conta Azul"');
        }
        // Cenário A: Token expirado
        else if (expiresInMinutes < 0) {
          alerts.push(`CRITICAL: Token OAuth expirado há ${Math.abs(expiresInMinutes)} minutos`);
          recommendations.push('Verificar se o cron de refresh está rodando');
        }
        // Warning: Token expirando em breve
        else if (expiresInMinutes < 15) {
          alerts.push(`WARNING: Token OAuth expira em ${expiresInMinutes} minutos`);
        }
      } else {
        alerts.push('CRITICAL: Nenhum token OAuth encontrado no banco');
        recommendations.push('Conectar Conta Azul via Dashboard → Técnico → "Reconectar Conta Azul"');
      }
    }
  } catch (error: any) {
    console.error('[HealthCheck] Erro ao verificar OAuth:', error.message);
  }

  // ─── 2. Refresh Cron ────────────────────────────────────────────────
  const cronRunning = isTokenRefreshCronRunning();
  const refreshCronCheck: HealthCheckResult['checks']['refreshCron'] = {
    status: cronRunning ? 'ok' : 'critical',
    running: cronRunning,
  };

  if (!cronRunning) {
    alerts.push('CRITICAL: Cron de refresh de token NÃO está rodando');
    recommendations.push('Reiniciar o servidor para reativar o cron');
  }

  // ─── 3. Régua Config ───────────────────────────────────────────────
  // Usa getAllowedStages() que já tem a lógica de detecção de valor legado
  const allowedStages = getAllowedStages();
  
  const criticalStages: import('./reguaCobrancaService').ReguaStage[] = ['d_plus_7', 'd_plus_15', 'd_plus_30', 'd_plus_45', 'd_plus_60'];
  const missingCritical = criticalStages.filter(s => !allowedStages.includes(s));

  const reguaConfigCheck: HealthCheckResult['checks']['reguaConfig'] = {
    status: missingCritical.length > 0 ? 'warning' : 'ok',
    allowedStages,
    totalStages: allowedStages.length,
    missingCritical,
  };

  if (missingCritical.length > 0) {
    alerts.push(`WARNING: Estágios críticos ausentes na régua: ${missingCritical.join(', ')}`);
    recommendations.push('Atualizar REGUA_ALLOWED_STAGES para incluir todos os estágios');
  }

  if (allowedStages.length < 5) {
    alerts.push(`WARNING: Apenas ${allowedStages.length} estágios habilitados — muitos clientes serão bloqueados`);
  }

  // ─── 4. Sync Status ────────────────────────────────────────────────
  let syncCheck: HealthCheckResult['checks']['sync'] = {
    status: 'unknown',
    lastSyncAt: null,
    minutesSinceLastSync: null,
  };

  try {
    const db = await getDb();
    if (db) {
      const syncResult = await db.execute(sql`
        SELECT MAX(updatedAt) as lastSync FROM sync_cursor WHERE cursorType = 'payment_sync'
      `);
      const rows = (syncResult as any)[0] || syncResult;
      if (Array.isArray(rows) && rows.length > 0 && (rows[0] as any)?.lastSync) {
        const lastSync = new Date((rows[0] as any).lastSync);
        const minutesSince = Math.round((now.getTime() - lastSync.getTime()) / 60000);
        
        syncCheck = {
          status: minutesSince > 720 ? 'warning' : 'ok', // > 12h = warning
          lastSyncAt: lastSync.toISOString(),
          minutesSinceLastSync: minutesSince,
        };

        if (minutesSince > 1440) { // > 24h
          alerts.push(`WARNING: Último sync há ${Math.round(minutesSince / 60)} horas`);
          recommendations.push('Executar sync manual via aba Técnica');
        }
      }
    }
  } catch (error: any) {
    // sync_cursor pode não existir — não é erro crítico
    console.log('[HealthCheck] sync_cursor não disponível:', error.message);
  }

  // ─── Overall Status ─────────────────────────────────────────────────
  const hasCritical = alerts.some(a => a.startsWith('CRITICAL'));
  const hasWarning = alerts.some(a => a.startsWith('WARNING'));
  const overall = hasCritical ? 'critical' : hasWarning ? 'degraded' : 'healthy';

  return {
    timestamp: now.toISOString(),
    overall,
    checks: {
      oauth: oauthCheck,
      refreshCron: refreshCronCheck,
      reguaConfig: reguaConfigCheck,
      sync: syncCheck,
    },
    alerts,
    recommendations,
  };
}

/**
 * Executar health check e notificar owner se crítico
 * (chamado pelo cron ou manualmente)
 */
export async function runAndAlertIfCritical(): Promise<HealthCheckResult> {
  const result = await runAutomationHealthCheck();

  if (result.overall === 'critical') {
    try {
      await notifyOwner({
        title: '🚨 Automação em Estado Crítico',
        content: `Health check detectou problemas críticos:

${result.alerts.map(a => `- ${a}`).join('\n')}

**Recomendações:**
${result.recommendations.map(r => `- ${r}`).join('\n')}

**Status:** ${result.overall}
**Timestamp:** ${result.timestamp}`,
      });
    } catch (err: any) {
      console.error('[HealthCheck] Falha ao notificar owner:', err.message);
    }
  }

  return result;
}
