/**
 * Serviço de Reconciliação Automática Conta Azul × Banco Local
 * 
 * Responsabilidades:
 * 1. Buscar receivables no CA (janela 365 dias)
 * 2. Comparar totais CA vs DB
 * 3. Detectar órfãos (no DB mas não no CA)
 * 4. Detectar renegociações
 * 5. Registrar divergências de status/valor
 * 6. Gerar alertas se diff > 1%
 */

import mysql from 'mysql2/promise';
import { getDb } from '../db';
import { 
  reconciliationAudit, 
  orphanReceivables, 
  receivableMismatchHistory,
  receivables,
  clients,
} from '../../drizzle/schema';
import { sql, eq, and, gte, lte } from 'drizzle-orm';
import axios from 'axios';

const logger = {
  log: (msg: string) => console.log(`[Reconciliação] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Reconciliação] ❌ ${msg}`, err?.message || ''),
  warn: (msg: string) => console.warn(`[Reconciliação] ⚠️ ${msg}`),
};

interface ReconciliationResult {
  runId: string;
  caTotal: number;
  caCount: number;
  dbTotal: number;
  dbCount: number;
  diffValue: number;
  diffPercent: number;
  orphanCount: number;
  statusMismatchCount: number;
  valueMismatchCount: number;
  renegotiationCount: number;
  isAlerted: boolean;
  alertMessage?: string;
  durationMs: number;
  status: 'completed' | 'failed';
  errorMessage?: string;
}

/**
 * Buscar todos os receivables do Conta Azul (janela 365 dias)
 */
async function fetchContaAzulReceivables(): Promise<Map<string, any>> {
  logger.log('Buscando receivables do Conta Azul (janela 365 dias)...');
  
  const { getValidAccessToken } = await import('../contaAzulOAuthManager');
  const token = await getValidAccessToken();
  if (!token) throw new Error('No OAuth token available');
  
  const caClient = axios.create({
    baseURL: 'https://api-v2.contaazul.com/v1',
    headers: { Authorization: `Bearer ${token}` },
  });
  const receivablesMap = new Map<string, any>();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  
  try {
    // Buscar receivables com status overdue
    const response = await caClient.get('/receivables', {
      params: {
        status: 'overdue',
        limit: 100,
        offset: 0,
      },
    });

    if (response.data?.data) {
      for (const receivable of response.data.data) {
        receivablesMap.set(receivable.id, {
          id: receivable.id,
          amount: parseFloat(receivable.amount || 0),
          status: receivable.status,
          dueDate: new Date(receivable.dueDate),
          clientId: receivable.client?.id,
        });
      }
    }

    logger.log(`✓ ${receivablesMap.size} receivables encontrados no CA`);
    return receivablesMap;
  } catch (error) {
    logger.error('Erro ao buscar receivables do CA', error);
    throw error;
  }
}

/**
 * Buscar receivables do banco local (status overdue)
 */
async function fetchLocalReceivables(): Promise<Map<string, any>> {
  logger.log('Buscando receivables locais (status overdue)...');
  
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    const localReceivables = await db
      .select({
        id: receivables.id,
        contaAzulId: receivables.contaAzulId,
        clientId: receivables.clientId,
        amount: receivables.amount,
        status: receivables.status,
        dueDate: receivables.dueDate,
      })
      .from(receivables)
      .where(eq(receivables.status, 'overdue'));

    const receivablesMap = new Map<string, any>();
    for (const rec of localReceivables) {
      receivablesMap.set(rec.contaAzulId, {
        id: rec.id,
        contaAzulId: rec.contaAzulId,
        clientId: rec.clientId,
        amount: parseFloat(rec.amount),
        status: rec.status,
        dueDate: rec.dueDate,
      });
    }

    logger.log(`✓ ${receivablesMap.size} receivables encontrados no DB`);
    return receivablesMap;
  } catch (error) {
    logger.error('Erro ao buscar receivables locais', error);
    throw error;
  }
}

/**
 * Detectar órfãos (no DB mas não no CA)
 */
async function detectOrphans(
  runId: string,
  caMap: Map<string, any>,
  dbMap: Map<string, any>
): Promise<number> {
  logger.log('Detectando títulos órfãos...');
  
  let orphanCount = 0;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    for (const [contaAzulId, dbRec] of Array.from(dbMap.entries())) {
      if (!caMap.has(contaAzulId)) {
        // Título no DB mas não no CA
        const lastFoundInCA = await db
          .select()
          .from(orphanReceivables)
          .where(eq(orphanReceivables.receivableId, dbRec.id))
          .orderBy(sql`createdAt DESC`)
          .limit(1);

        const orphanType = lastFoundInCA.length === 0 ? 'never_synced' : 'deleted_from_ca';

        await conn.execute(
          `INSERT INTO orphan_receivables 
           (receivableId, clientId, contaAzulId, amount, dueDate, dbStatus, detectedAt, orphanType)
           VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
          [
            dbRec.id,
            dbRec.clientId,
            contaAzulId,
            dbRec.amount,
            dbRec.dueDate,
            dbRec.status,
            orphanType,
          ]
        );

        orphanCount++;
        logger.log(`  → Órfão detectado: ${contaAzulId} (${orphanType})`);
      }
    }

    logger.log(`✓ ${orphanCount} órfãos detectados`);
    return orphanCount;
  } catch (error) {
    logger.error('Erro ao detectar órfãos', error);
    throw error;
  } finally {
    await conn.end();
  }
}

/**
 * Detectar divergências de status e valor
 */
async function detectMismatches(
  runId: string,
  caMap: Map<string, any>,
  dbMap: Map<string, any>
): Promise<{ statusMismatchCount: number; valueMismatchCount: number }> {
  logger.log('Detectando divergências de status e valor...');
  
  let statusMismatchCount = 0;
  let valueMismatchCount = 0;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    for (const [contaAzulId, dbRec] of Array.from(dbMap.entries())) {
      const caRec = caMap.get(contaAzulId);
      
      if (!caRec) continue; // Já foi detectado como órfão

      let mismatchType = '';
      let severity = 'low';
      let action = 'pending';

      // Verificar status
      if (caRec.status !== dbRec.status) {
        statusMismatchCount++;
        mismatchType = 'status_changed';
        severity = 'high'; // Status diferente é crítico
        logger.log(`  → Status divergente: CA=${caRec.status}, DB=${dbRec.status}`);
      }

      // Verificar valor
      const valueDiff = Math.abs(caRec.amount - dbRec.amount);
      if (valueDiff > 0.01) {
        valueMismatchCount++;
        mismatchType = mismatchType ? 'multiple_changes' : 'amount_changed';
        severity = valueDiff > 100 ? 'high' : 'medium';
        logger.log(`  → Valor divergente: CA=${caRec.amount}, DB=${dbRec.amount}`);
      }

      // Registrar divergência
      if (mismatchType) {
        await conn.execute(
          `INSERT INTO receivable_mismatch_history
           (receivableId, reconciliationRunId, caStatus, caAmount, caDueDate, 
            dbStatus, dbAmount, dbDueDate, mismatchType, severity, action)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            dbRec.id,
            runId,
            caRec.status,
            caRec.amount,
            caRec.dueDate,
            dbRec.status,
            dbRec.amount,
            dbRec.dueDate,
            mismatchType,
            severity,
            action,
          ]
        );
      }
    }

    logger.log(`✓ ${statusMismatchCount} status divergentes, ${valueMismatchCount} valores divergentes`);
    return { statusMismatchCount, valueMismatchCount };
  } catch (error) {
    logger.error('Erro ao detectar divergências', error);
    throw error;
  } finally {
    await conn.end();
  }
}

/**
 * Executar reconciliação completa
 */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const runId = `reconciliation-${Date.now()}`;
  const startedAt = new Date();
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    logger.log(`Iniciando reconciliação (runId=${runId})`);

    // Registrar início
    await conn.execute(
      `INSERT INTO reconciliation_audit (runId, caTotal, caCount, dbTotal, dbCount, diffValue, diffPercent, startedAt, status)
       VALUES (?, 0, 0, 0, 0, 0, 0, NOW(), 'running')`,
      [runId]
    );

    // Buscar receivables
    const caMap = await fetchContaAzulReceivables();
    const dbMap = await fetchLocalReceivables();
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Calcular totais
    let caTotal = 0;
    for (const rec of Array.from(caMap.values())) {
      caTotal += rec.amount;
    }

    let dbTotal = 0;
    for (const rec of Array.from(dbMap.values())) {
      dbTotal += rec.amount;
    }

    logger.log(`Totais: CA=R$ ${caTotal.toFixed(2)}, DB=R$ ${dbTotal.toFixed(2)}`);

    // Calcular diferença
    const diffValue = Math.abs(caTotal - dbTotal);
    const diffPercent = caTotal > 0 ? (diffValue / caTotal) * 100 : 0;
    const isAlerted = diffPercent > 1;

    logger.log(`Diferença: R$ ${diffValue.toFixed(2)} (${diffPercent.toFixed(2)}%)`);

    // Detectar problemas
    const orphanCount = await detectOrphans(runId, caMap, dbMap);
    const { statusMismatchCount, valueMismatchCount } = await detectMismatches(runId, caMap, dbMap);

    // Gerar alerta se necessário
    let alertMessage = '';
    if (isAlerted) {
      alertMessage = `Reconciliação: Diferença de R$ ${diffValue.toFixed(2)} (${diffPercent.toFixed(2)}%) detectada. ` +
        `Órfãos: ${orphanCount}, Status divergentes: ${statusMismatchCount}, Valores divergentes: ${valueMismatchCount}`;
      logger.warn(alertMessage);
    }

    // Atualizar registro de auditoria
    const durationMs = Date.now() - startedAt.getTime();
    await conn.execute(
      `UPDATE reconciliation_audit 
       SET caTotal = ?, caCount = ?, dbTotal = ?, dbCount = ?, diffValue = ?, diffPercent = ?,
           orphanCount = ?, statusMismatchCount = ?, valueMismatchCount = ?,
           isAlerted = ?, alertMessage = ?, completedAt = NOW(), durationMs = ?, status = 'completed'
       WHERE runId = ?`,
      [
        caTotal,
        caMap.size,
        dbTotal,
        dbMap.size,
        diffValue,
        diffPercent,
        orphanCount,
        statusMismatchCount,
        valueMismatchCount,
        isAlerted ? 1 : 0,
        alertMessage,
        durationMs,
        runId,
      ]
    );

    logger.log(`✅ Reconciliação concluída em ${durationMs}ms`);

    return {
      runId,
      caTotal,
      caCount: caMap.size,
      dbTotal,
      dbCount: dbMap.size,
      diffValue,
      diffPercent,
      orphanCount,
      statusMismatchCount,
      valueMismatchCount,
      renegotiationCount: 0, // TODO: Implementar detecção de renegociação
      isAlerted,
      alertMessage: isAlerted ? alertMessage : undefined,
      durationMs,
      status: 'completed',
    };
  } catch (error) {
    logger.error('Erro na reconciliação', error);

    const durationMs = Date.now() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      await conn.execute(
        `UPDATE reconciliation_audit 
         SET status = 'failed', errorMessage = ?, durationMs = ?, completedAt = NOW()
         WHERE runId = ?`,
        [errorMessage, durationMs, runId]
      );
    } catch (updateError) {
      logger.error('Erro ao atualizar status de falha', updateError);
    }

    return {
      runId,
      caTotal: 0,
      caCount: 0,
      dbTotal: 0,
      dbCount: 0,
      diffValue: 0,
      diffPercent: 0,
      orphanCount: 0,
      statusMismatchCount: 0,
      valueMismatchCount: 0,
      renegotiationCount: 0,
      isAlerted: false,
      durationMs: Date.now() - startedAt.getTime(),
      status: 'failed',
      errorMessage,
    };
  } finally {
    await conn.end();
  }
}

/**
 * Validar status em tempo real antes da régua rodar
 */
export async function validateReceivableBeforeRegua(
  receivableId: number,
  contaAzulId: string,
  runId: string
): Promise<{ isValid: boolean; action: 'proceed' | 'skip' | 'update_and_proceed' | 'cancel_regua'; message: string }> {
  try {
    logger.log(`Validando receivable ${contaAzulId} antes da régua...`);

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Buscar no DB
    const dbRec = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (!dbRec.length) {
      return {
        isValid: false,
        action: 'skip',
        message: 'Título não encontrado no DB',
      };
    }

    // Buscar no CA
    const { getValidAccessToken } = await import('../contaAzulOAuthManager');
    const token = await getValidAccessToken();
    if (!token) throw new Error('No OAuth token available');
    
    const caClient = axios.create({
      baseURL: 'https://api-v2.contaazul.com/v1',
      headers: { Authorization: `Bearer ${token}` },
    });
    const caResponse = await caClient.get(`/receivables/${contaAzulId}`);
    const caRec = caResponse.data;

    // Comparar
    const dbStatus = dbRec[0].status;
    const caStatus = caRec.status;
    const dbAmount = parseFloat(dbRec[0].amount);
    const caAmount = parseFloat(caRec.amount || 0);

    // Validar
    const isValid = dbStatus === caStatus && Math.abs(dbAmount - caAmount) < 0.01;

    if (isValid) {
      return {
        isValid: true,
        action: 'proceed',
        message: 'Título válido, prosseguir com envio',
      };
    }

    // Se status mudou para paid, skip
    if (caStatus === 'paid' || caStatus === 'received') {
      return {
        isValid: false,
        action: 'skip',
        message: `Título já pago no CA (status=${caStatus})`,
      };
    }

    // Se valor mudou, atualizar e prosseguir
    if (Math.abs(dbAmount - caAmount) > 0.01) {
      logger.log(`  → Atualizando valor: DB=${dbAmount}, CA=${caAmount}`);
      const updateDb = await getDb();
      if (updateDb) {
        await updateDb
          .update(receivables)
          .set({ amount: String(caAmount) })
          .where(eq(receivables.id, receivableId));
      }

      return {
        isValid: true,
        action: 'update_and_proceed',
        message: `Valor atualizado de R$ ${dbAmount} para R$ ${caAmount}`,
      };
    }

    // Status divergente
    return {
      isValid: false,
      action: 'cancel_regua',
      message: `Status divergente: DB=${dbStatus}, CA=${caStatus}`,
    };
  } catch (error) {
    logger.error('Erro ao validar receivable', error);
    return {
      isValid: false,
      action: 'skip',
      message: `Erro na validação: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Obter relatório de reconciliação
 */
export async function getReconciliationReport(runId?: string) {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    if (runId) {
      const results = await db
        .select()
        .from(reconciliationAudit)
        .where(eq(reconciliationAudit.runId, runId));
      return results;
    } else {
      const results = await db
        .select()
        .from(reconciliationAudit)
        .orderBy(sql`createdAt DESC`)
        .limit(7);
      return results;
    }
  } catch (error) {
    logger.error('Erro ao obter relatório', error);
    throw error;
  }
}
