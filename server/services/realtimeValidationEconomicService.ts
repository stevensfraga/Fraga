/**
 * Realtime Validation — Modo Econômico
 *
 * Estratégia de cache para evitar rate limit no Conta Azul:
 *   - Cache 5-10 min por contaAzulId durante o ciclo
 *   - Só consultar CA em tempo real se:
 *     * valor >= 500 OU
 *     * estágio D+15/jurídico OU
 *     * lastSyncedAt > 24h
 *   - Se CA indisponível: fallback para status local + risk=MEDIUM
 *   - Nunca bloqueia a régua (apenas registra risco)
 */

import mysql from 'mysql2/promise';
import axios from 'axios';
import { getValidAccessToken } from '../contaAzulOAuthManager';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface EconomicValidationResult {
  receivableId: number;
  clientId: number;
  isValid: boolean; // true = pode enviar
  decision?: 'ALLOW_SEND' | 'ABORT_TERMINAL' | 'ABORT_NOT_OVERDUE' | 'FALLBACK_MEDIUM';
  riskLevel: RiskLevel;
  reason: string; // Motivo da decisão
  usedCache: boolean;
  caStatus?: string;
  updatedAt: Date;
}

// ─── CACHE ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  status: string;
  cachedAt: Date;
  expiresAt: Date;
}

const validationCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5-10 minutos

function getCacheKey(contaAzulId: string): string {
  return `ca-${contaAzulId}`;
}

function isCacheValid(entry: CacheEntry): boolean {
  return new Date() < entry.expiresAt;
}

function getFromCache(contaAzulId: string): string | null {
  const key = getCacheKey(contaAzulId);
  const entry = validationCache.get(key);

  if (!entry || !isCacheValid(entry)) {
    validationCache.delete(key);
    return null;
  }

  return entry.status;
}

function setCache(contaAzulId: string, status: string): void {
  const key = getCacheKey(contaAzulId);
  validationCache.set(key, {
    status,
    cachedAt: new Date(),
    expiresAt: new Date(Date.now() + CACHE_TTL_MS),
  });
}

// ─── VALIDAÇÃO ECONÔMICA ─────────────────────────────────────────────────────

/**
 * Decidir se deve consultar Conta Azul em tempo real.
 *
 * Critérios:
 *   - valor >= 500
 *   - estágio D+15 ou jurídico
 *   - lastSyncedAt > 24h
 */
function shouldCheckRealtimeCA(
  amount: number,
  stage: string,
  lastSyncedAt: Date | null
): boolean {
  // Valor alto
  if (amount >= 500) return true;

  // Estágio crítico
  if (['d_plus_15', 'd_plus_30', 'd_plus_45', 'd_plus_60', 'd_plus_90', 'd_plus_180', 'd_plus_365', 'juridico'].includes(stage)) {
    return true;
  }

  // Não sincronizado há mais de 24h
  if (lastSyncedAt) {
    const hoursSinceSyncedAt = (Date.now() - lastSyncedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSyncedAt > 24) return true;
  }

  return false;
}

/**
 * Validar receivable em modo econômico.
 *
 * Retorna:
 *   - isValid=true: pode enviar (status OK ou risco aceitável)
 *   - isValid=false: não enviar (status terminal ou risco alto)
 */
export async function validateReceivableEconomic(
  receivableId: number,
  clientId: number,
  contaAzulReceivableId: string,
  amount: number,
  stage: string,
  lastSyncedAt: Date | null
): Promise<EconomicValidationResult> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    // ── 1. Buscar receivable no DB ──
    const [rows] = await conn.execute(
      `SELECT r.id, r.status, c.negotiatedUntil
       FROM receivables r
       INNER JOIN clients c ON c.id = r.clientId
       WHERE r.id = ? AND r.clientId = ?`,
      [receivableId, clientId]
    );

    if (!rows || (rows as any[]).length === 0) {
      return {
        receivableId,
        clientId,
        isValid: false,
        riskLevel: 'HIGH',
        reason: 'Receivable não encontrado no DB',
        usedCache: false,
        updatedAt: new Date(),
      };
    }

    const receivable = (rows as any[])[0];
    const dbStatus = receivable.status;
    const negotiatedUntil = receivable.negotiatedUntil ? new Date(receivable.negotiatedUntil) : null;

    // ── 2. Verificar bloqueio por negociação ──
    if (negotiatedUntil && negotiatedUntil >= new Date()) {
      return {
        receivableId,
        clientId,
        isValid: false,
        riskLevel: 'HIGH',
        reason: `Cliente em negociação até ${negotiatedUntil.toISOString()}`,
        usedCache: false,
        updatedAt: new Date(),
      };
    }

    // ── 3. Decidir se consulta CA em tempo real ──
    if (!shouldCheckRealtimeCA(amount, stage, lastSyncedAt)) {
      // Usar status local (sem consultar CA)
      const statusesToAbort = ['paid', 'received', 'acquitted', 'cancelled', 'renegotiated'];
      const shouldAbort = statusesToAbort.includes(dbStatus.toLowerCase());

      return {
        receivableId,
        clientId,
        isValid: !shouldAbort,
        riskLevel: 'LOW', // Confiança alta no status local
        reason: `Status local: ${dbStatus} (sem consulta CA)`,
        usedCache: false,
        updatedAt: new Date(),
      };
    }

    // ── 4. Consultar CA em tempo real (com cache) ──
    let caStatus: string | undefined;
    let usedCache = false;

    // Tentar cache primeiro
    const cachedStatus = getFromCache(contaAzulReceivableId);
    if (cachedStatus) {
      caStatus = cachedStatus;
      usedCache = true;
      console.log(`[EconomicValidation] 💾 Cache hit: ${contaAzulReceivableId} → ${caStatus}`);
    } else {
      // Consultar CA
      try {
        const token = await getValidAccessToken();
        if (!token) {
          // Fallback: usar status local com risco MEDIUM
          return {
            receivableId,
            clientId,
            isValid: true,
            riskLevel: 'MEDIUM',
            reason: 'Token CA não disponível, usando status local',
            usedCache: false,
            updatedAt: new Date(),
            caStatus: undefined,
          };
        }

        // Fix: remove trailing /v1 from base to avoid /v1/v1/... duplication
        const rawBase = (process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1').replace(/\/v1$/, '');
        const caUrl = `${rawBase}/v1/financeiro/eventos-financeiros/parcelas/${contaAzulReceivableId}`;
        const response = await axios.get(caUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000, // Timeout curto para não travar
        });

        // Mapear status CA (PT/EN) → status DB
        const mapCaStatus = (s: string): string => {
          const upper = (s || '').toUpperCase();
          if (['QUITADO', 'ACQUITTED', 'RECEBIDO', 'RECEIVED'].includes(upper)) return 'paid';
          if (['ATRASADO', 'OVERDUE'].includes(upper)) return 'overdue';
          // Pagamento parcial: ainda há saldo devedor, tratar como overdue
          if (['RECEBIDO_PARCIAL', 'PARTIAL', 'PARTIALLY_PAID'].includes(upper)) return 'overdue';
          if (['PENDENTE', 'PENDING'].includes(upper)) return 'pending';
          if (['PERDIDO', 'CANCELLED', 'CANCELADO', 'LOST', 'RENEGOTIATED', 'RENEGOCIADO'].includes(upper)) return 'cancelled';
          return s.toLowerCase();
        };

        const rawCaStatus = response.data.status || response.data.situacao || response.data.status_traduzido;
        caStatus = rawCaStatus ? mapCaStatus(rawCaStatus) : undefined;
        if (caStatus) {
          setCache(contaAzulReceivableId, caStatus);
        }
        console.log(`[EconomicValidation] 🔍 CA consultado: ${contaAzulReceivableId} → rawStatus=${rawCaStatus} → mappedStatus=${caStatus}`);
      } catch (error: any) {
        console.warn(`[EconomicValidation] ⚠️ Erro ao consultar CA: ${error.message}`);
        // Fallback: usar status local com risco MEDIUM
        return {
          receivableId,
          clientId,
          isValid: true,
          riskLevel: 'MEDIUM',
          reason: `Erro ao consultar CA: ${error.message}. Usando status local.`,
          usedCache: false,
          updatedAt: new Date(),
          caStatus: undefined,
        };
      }
    }

    // ── 5. Comparar status ──
    const caStatusLower = (caStatus || '').toLowerCase();

    // Status terminal → ABORT_TERMINAL
    const statusesTerminal = ['paid', 'received', 'acquitted', 'cancelled', 'renegotiated'];
    if (statusesTerminal.includes(caStatusLower)) {
      console.log(`[EconomicValidation] 🛑 ABORT_TERMINAL — CA status: ${caStatus}`);
      return {
        receivableId,
        clientId,
        isValid: false,
        decision: 'ABORT_TERMINAL' as const,
        riskLevel: 'HIGH',
        reason: `Status terminal no CA: ${caStatus}. Cobrança bloqueada.`,
        usedCache,
        caStatus,
        updatedAt: new Date(),
      };
    }

    // Status pending (não vencido) → ABORT_NOT_OVERDUE
    // Não deve ser cobrado: título ainda não está em atraso no CA
    const statusesNotOverdue = ['pending'];
    if (statusesNotOverdue.includes(caStatusLower)) {
      console.log(`[EconomicValidation] ⏸️ ABORT_NOT_OVERDUE — CA status: ${caStatus} (DB: ${dbStatus})`);
      return {
        receivableId,
        clientId,
        isValid: false,
        decision: 'ABORT_NOT_OVERDUE' as const,
        riskLevel: 'MEDIUM',
        reason: `Título não está vencido no CA (status: ${caStatus}). DB pode estar desatualizado.`,
        usedCache,
        caStatus,
        updatedAt: new Date(),
      };
    }

    // Status overdue confirmado no CA → ALLOW_SEND
    if (caStatusLower === 'overdue') {
      console.log(`[EconomicValidation] ✅ ALLOW_SEND — CA confirma overdue`);
      return {
        receivableId,
        clientId,
        isValid: true,
        decision: 'ALLOW_SEND' as const,
        riskLevel: 'LOW',
        reason: `CA confirma overdue. Cobrança autorizada.`,
        usedCache,
        caStatus,
        updatedAt: new Date(),
      };
    }

    // Status desconhecido → FALLBACK_MEDIUM (não travar régua, mas registrar)
    console.warn(`[EconomicValidation] ⚠️ FALLBACK_MEDIUM — status desconhecido no CA: ${caStatus}`);
    return {
      receivableId,
      clientId,
      isValid: true,
      decision: 'FALLBACK_MEDIUM' as const,
      riskLevel: 'MEDIUM',
      reason: `Status CA desconhecido: ${caStatus}. Usando status local (${dbStatus}) com risco MEDIUM.`,
      usedCache,
      caStatus,
      updatedAt: new Date(),
    };
  } catch (error: any) {
    console.error(`[EconomicValidation] ❌ Erro geral: ${error.message}`);
    // Fallback: permitir com risco MEDIUM
    return {
      receivableId,
      clientId,
      isValid: true,
      riskLevel: 'MEDIUM',
      reason: `Erro geral: ${error.message}. Permitindo com risco.`,
      usedCache: false,
      updatedAt: new Date(),
    };
  } finally {
    await conn.end();
  }
}

// ─── LIMPEZA DE CACHE ─────────────────────────────────────────────────────────

export function clearValidationCache(): void {
  const before = validationCache.size;
  validationCache.clear();
  console.log(`[EconomicValidation] 🧹 Cache limpo: ${before} entradas removidas`);
}

export function getCacheStats(): { size: number; entries: Array<{ key: string; expiresIn: number }> } {
  const entries: Array<{ key: string; expiresIn: number }> = [];

  validationCache.forEach((entry, key) => {
    const expiresIn = Math.max(0, entry.expiresAt.getTime() - Date.now());
    entries.push({ key, expiresIn });
  });

  return { size: validationCache.size, entries };
}
