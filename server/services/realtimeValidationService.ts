/**
 * Serviço de Validação em Tempo Real — Conta Azul
 *
 * Valida o status de cada receivable no Conta Azul ANTES de enviar cobrança.
 * Protege contra:
 *   - Cobrança após pagamento
 *   - Cobrança após renegociação
 *   - Cobrança após cancelamento
 *   - Alterações manuais não sincronizadas
 *
 * Fluxo:
 *   1. Buscar receivable no DB (local)
 *   2. Consultar status no CA (real-time)
 *   3. Se status mudou → atualizar DB e abortar envio
 *   4. Se status continua overdue → permitir envio
 *   5. Registrar log com motivo (REALTIME_ABORT, NEGOTIATION_BLOCK, OK)
 */

import mysql from 'mysql2/promise';
import axios from 'axios';
import { getValidAccessToken } from '../contaAzulOAuthManager';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type ValidationReason = 'OK' | 'REALTIME_ABORT' | 'NEGOTIATION_BLOCK' | 'API_ERROR' | 'INVALID_RECEIVABLE';

export interface RealtimeValidationResult {
  receivableId: number;
  clientId: number;
  isValid: boolean; // true = pode enviar, false = abortar
  reason: ValidationReason;
  dbStatus: string;
  caStatus?: string; // Status obtido do Conta Azul
  caReceivableId?: string;
  updatedAt?: Date;
  errorMessage?: string;
}

// ─── VALIDAÇÃO EM TEMPO REAL ─────────────────────────────────────────────────

/**
 * Validar receivable em tempo real contra Conta Azul ANTES de enviar cobrança.
 *
 * Retorna:
 *   - isValid=true: pode enviar
 *   - isValid=false: abortar envio (e atualizar DB se necessário)
 */
export async function validateReceivableRealtime(
  receivableId: number,
  clientId: number,
  contaAzulReceivableId: string
): Promise<RealtimeValidationResult> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    // ── 1. Buscar receivable no DB ──
    const [rows] = await conn.execute(
      `SELECT r.id, r.clientId, r.status, r.amount, r.dueDate, c.negotiatedUntil
       FROM receivables r
       INNER JOIN clients c ON c.id = r.clientId
       WHERE r.id = ? AND r.clientId = ?`,
      [receivableId, clientId]
    );

    if (!rows || (rows as any[]).length === 0) {
      console.warn(`[RealtimeValidation] ⚠️ Receivable não encontrado: ${receivableId}`);
      return {
        receivableId,
        clientId,
        isValid: false,
        reason: 'INVALID_RECEIVABLE',
        dbStatus: 'NOT_FOUND',
        errorMessage: 'Receivable não encontrado no banco local',
      };
    }

    const receivable = (rows as any[])[0];
    const dbStatus = receivable.status;
    const negotiatedUntil = receivable.negotiatedUntil ? new Date(receivable.negotiatedUntil) : null;

    // ── 2. Verificar bloqueio por negociação ──
    if (negotiatedUntil && negotiatedUntil >= new Date()) {
      console.log(`[RealtimeValidation] 🤝 Cliente em negociação até ${negotiatedUntil.toISOString()}`);
      return {
        receivableId,
        clientId,
        isValid: false,
        reason: 'NEGOTIATION_BLOCK',
        dbStatus,
        updatedAt: negotiatedUntil,
      };
    }

    // ── 3. Consultar status em tempo real no Conta Azul ──
    let caStatus: string | undefined;
    let caReceivableId: string | undefined;

    try {
      const token = await getValidAccessToken();
      if (!token) {
        console.warn(`[RealtimeValidation] ⚠️ Token do Conta Azul não disponível — MODO DEGRADADO: usando status local`);
        // MODO DEGRADADO: sem token, não bloqueia a régua.
        // Se o status local indica pendente/vencido → permite envio.
        // Apenas bloqueia se o status local já indica pago/cancelado/renegociado.
        const terminalStatuses = ['paid', 'cancelled', 'renegotiated', 'pago', 'cancelado', 'renegociado'];
        const localStatusOk = !terminalStatuses.includes(dbStatus.toLowerCase());
        return {
          receivableId,
          clientId,
          isValid: localStatusOk,
          reason: localStatusOk ? 'OK' : 'REALTIME_ABORT',
          dbStatus,
          errorMessage: localStatusOk
            ? 'Token CA indisponível — status local OK (modo degradado)'
            : `Token CA indisponível — status local indica terminal: ${dbStatus}`,
        };
      }

      // Buscar receivable no CA
      const caUrl = `${process.env.CONTA_AZUL_API_BASE || 'https://api.contaazul.com'}/v1/receivables/${contaAzulReceivableId}`;
      const response = await axios.get(caUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      const caData = response.data;
      caStatus = caData.status || caData.situacao; // CA pode usar 'status' ou 'situacao'
      caReceivableId = caData.id || contaAzulReceivableId;

      console.log(`[RealtimeValidation] 🔍 CA Status: ${caStatus} | DB Status: ${dbStatus}`);
    } catch (error: any) {
      console.warn(`[RealtimeValidation] ⚠️ Erro ao consultar CA: ${error.message} — MODO DEGRADADO: usando status local`);
      // MODO DEGRADADO: se a API CA falhar, não bloqueia a régua.
      // Usa o status local para decidir se pode enviar.
      const terminalStatuses = ['paid', 'cancelled', 'renegotiated', 'pago', 'cancelado', 'renegociado'];
      const localStatusOk = !terminalStatuses.includes(dbStatus.toLowerCase());
      return {
        receivableId,
        clientId,
        isValid: localStatusOk,
        reason: localStatusOk ? 'OK' : 'REALTIME_ABORT',
        dbStatus,
        errorMessage: localStatusOk
          ? `CA indisponível (${error.message}) — status local OK (modo degradado)`
          : `CA indisponível (${error.message}) — status local indica terminal: ${dbStatus}`,
      };
    }

    // ── 4. Comparar status ──
    const statusesToAbort = ['paid', 'received', 'acquitted', 'cancelled', 'renegotiated', 'pago', 'recebido', 'quitado', 'cancelado', 'renegociado'];
    const caStatusLower = (caStatus || '').toLowerCase();
    const dbStatusLower = dbStatus.toLowerCase();

    // Se status mudou no CA para um estado terminal
    if (statusesToAbort.includes(caStatusLower)) {
      console.log(`[RealtimeValidation] 🛑 ABORT: Status no CA mudou para ${caStatus} (era ${dbStatus} no DB)`);

      // Atualizar DB com o status correto
      await conn.execute(
        `UPDATE receivables SET status = ?, updatedAt = NOW() WHERE id = ?`,
        [caStatus, receivableId]
      );

      return {
        receivableId,
        clientId,
        isValid: false,
        reason: 'REALTIME_ABORT',
        dbStatus,
        caStatus,
        caReceivableId,
        updatedAt: new Date(),
        errorMessage: `Status mudou no Conta Azul: ${dbStatus} → ${caStatus}`,
      };
    }

    // ── 5. Status continua overdue → permitir envio ──
    if (dbStatusLower === 'overdue' || dbStatusLower === 'pending') {
      console.log(`[RealtimeValidation] ✅ OK: Receivable elegível para envio`);
      return {
        receivableId,
        clientId,
        isValid: true,
        reason: 'OK',
        dbStatus,
        caStatus,
        caReceivableId,
      };
    }

    // Status desconhecido
    console.warn(`[RealtimeValidation] ⚠️ Status desconhecido: ${dbStatus}`);
    return {
      receivableId,
      clientId,
      isValid: false,
      reason: 'INVALID_RECEIVABLE',
      dbStatus,
      caStatus,
      errorMessage: `Status desconhecido: ${dbStatus}`,
    };
  } catch (error: any) {
    console.error(`[RealtimeValidation] ❌ Erro geral: ${error.message}`);
    return {
      receivableId,
      clientId,
      isValid: false,
      reason: 'API_ERROR',
      dbStatus: 'ERROR',
      errorMessage: error.message,
    };
  } finally {
    await conn.end();
  }
}

// ─── VALIDAR MÚLTIPLOS RECEIVABLES ───────────────────────────────────────────

export async function validateMultipleReceivables(
  receivables: Array<{ receivableId: number; clientId: number; contaAzulReceivableId: string }>
): Promise<RealtimeValidationResult[]> {
  const results: RealtimeValidationResult[] = [];

  for (const r of receivables) {
    const result = await validateReceivableRealtime(r.receivableId, r.clientId, r.contaAzulReceivableId);
    results.push(result);

    // Pequeno delay para não sobrecarregar a API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

// ─── REGISTRAR VALIDAÇÃO ─────────────────────────────────────────────────────

export async function logValidationResult(
  runId: string,
  result: RealtimeValidationResult,
  phoneE164?: string
): Promise<void> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    await conn.execute(
      `INSERT INTO pre_regua_validation 
       (runId, receivableId, clientId, validationReason, isValid, dbStatus, caStatus, phoneE164, errorMessage, validatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        runId,
        result.receivableId,
        result.clientId,
        result.reason,
        result.isValid ? 1 : 0,
        result.dbStatus,
        result.caStatus || null,
        phoneE164 || null,
        result.errorMessage || null,
      ]
    );

    console.log(`[RealtimeValidation] 📝 Validação registrada: ${result.receivableId} | ${result.reason}`);
  } catch (error: any) {
    console.error(`[RealtimeValidation] ❌ Erro ao registrar validação: ${error.message}`);
  } finally {
    await conn.end();
  }
}

// ─── MARCAR CLIENTE EM NEGOCIAÇÃO ────────────────────────────────────────────

/**
 * Marcar cliente como em negociação até uma data específica.
 * Bloqueia a régua para este cliente até essa data.
 */
export async function markClientNegotiation(clientId: number, negotiatedUntilDate: Date): Promise<boolean> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const [result] = await conn.execute(
      `UPDATE clients SET negotiatedUntil = ?, updatedAt = NOW() WHERE id = ?`,
      [negotiatedUntilDate, clientId]
    );

    const affected = (result as any).affectedRows || 0;
    console.log(`[RealtimeValidation] 🤝 Cliente ${clientId} marcado em negociação até ${negotiatedUntilDate.toISOString()}`);
    return affected > 0;
  } catch (error: any) {
    console.error(`[RealtimeValidation] ❌ Erro ao marcar negociação: ${error.message}`);
    return false;
  } finally {
    await conn.end();
  }
}

/**
 * Desbloquear cliente (remover negociação)
 */
export async function unmarkClientNegotiation(clientId: number): Promise<boolean> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const [result] = await conn.execute(
      `UPDATE clients SET negotiatedUntil = NULL, updatedAt = NOW() WHERE id = ?`,
      [clientId]
    );

    const affected = (result as any).affectedRows || 0;
    console.log(`[RealtimeValidation] ✅ Cliente ${clientId} desbloqueado da negociação`);
    return affected > 0;
  } catch (error: any) {
    console.error(`[RealtimeValidation] ❌ Erro ao desbloquear: ${error.message}`);
    return false;
  } finally {
    await conn.end();
  }
}
