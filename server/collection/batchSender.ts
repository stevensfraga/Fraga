/**
 * BLOCO 11 — ETAPA 11.3: Envio controlado em lote
 * 
 * Seleciona receivables elegíveis, gera mensagem, envia via ZapContábil,
 * registra auditoria com correlationId.
 */

import axios from 'axios';
import { getDb } from '../db';
import { whatsappAudit, receivables } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { BucketCode } from './buckets';
import { EligibilityResult, getEligibleReceivables, normalizeWhatsApp } from './eligibilityFilter';
import { renderMessage, formatBRL, formatDate, generateCorrelationId } from './messageTemplates';

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

export interface SendResult {
  receivableId: number;
  clientId: number;
  clientName: string;
  whatsappNumber: string;
  correlationId: string;
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  auditId?: number;
  error?: string;
  messagePreview?: string;
}

export interface BatchResult {
  batchId: string;
  bucketCode: BucketCode;
  timestamp: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: SendResult[];
  dryRun: boolean;
}

/**
 * Enviar mensagem via ZapContábil
 */
async function sendViaZapContabil(
  phone: string,
  message: string,
  correlationId: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!ZAP_API_KEY) {
    return { success: false, error: 'ZAP_CONTABIL_API_KEY não configurada' };
  }

  try {
    // Normalizar para apenas dígitos (formato esperado pela API ZapContábil)
    const phoneDigits = phone.replace(/\D/g, '');
    
    console.log(`[BatchSender] 📤 Enviando via ZapContábil: phone=${phoneDigits}, correlationId=${correlationId}`);
    
    const queueId = Number(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO) || undefined;
    console.log(`[BatchSender] 📤 queueId=${queueId || 'nenhum'} (Financeiro)`);
    
    const response = await axios.post(
      `${ZAP_API_URL}/api/send/${phoneDigits}`,
      {
        body: message,
        connectionFrom: 0,
        ...(queueId ? { queueId } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const messageId = response.data?.message?.id || response.data?.messageId || response.data?.id;
    
    console.log(`[BatchSender] ✅ Mensagem enviada: correlationId=${correlationId}, messageId=${messageId}, httpStatus=${response.status}`);
    
    return {
      success: true,
      messageId: messageId || `ack_${Date.now()}`,
    };
  } catch (error: any) {
    const errMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro desconhecido';
    const httpStatus = error.response?.status || 0;
    
    console.error(`[BatchSender] ❌ Falha no envio: correlationId=${correlationId}, status=${httpStatus}, error=${errMsg}`);
    
    return {
      success: false,
      error: `HTTP ${httpStatus}: ${errMsg}`,
    };
  }
}

/**
 * Registrar auditoria de envio
 */
async function recordAudit(
  result: SendResult,
  messageContent: string,
  templateUsed: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const insertResult = await db.insert(whatsappAudit).values({
      clientId: result.clientId,
      receivableId: result.receivableId,
      messageId: result.messageId || null,
      correlationId: result.correlationId,
      providerTrackingMode: result.messageId ? 'WITH_ID' : 'ACK_ONLY',
      providerAck: result.status === 'sent',
      sentAt: new Date(),
      templateUsed,
      status: result.status === 'sent' ? 'sent' : 'failed',
      errorMessage: result.error || null,
      phoneNumber: result.whatsappNumber,
      messageContent,
      pdfUrl: null,
    });

    const auditId = insertResult[0]?.insertId;
    console.log(`[BatchSender] 📝 Auditoria registrada: auditId=${auditId}, correlationId=${result.correlationId}`);
    return auditId || null;
  } catch (error: any) {
    console.error(`[BatchSender] ❌ Erro ao registrar auditoria: ${error.message}`);
    return null;
  }
}

/**
 * Atualizar receivable com dados de último envio
 */
async function updateReceivableDispatch(receivableId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(receivables)
      .set({
        lastDispatchedAt: new Date(),
        dispatchCount: (await db
          .select({ count: receivables.dispatchCount })
          .from(receivables)
          .where(eq(receivables.id, receivableId))
          .then(r => (r[0]?.count || 0) + 1)),
      })
      .where(eq(receivables.id, receivableId));
  } catch (error: any) {
    console.error(`[BatchSender] ❌ Erro ao atualizar receivable: ${error.message}`);
  }
}

/**
 * Processar um único envio
 */
async function processSingleSend(
  eligible: EligibilityResult,
  bucketCode: BucketCode,
  dryRun: boolean
): Promise<SendResult> {
  const correlationId = generateCorrelationId(eligible.clientId, eligible.receivableId);
  
  // Se não é elegível, pular
  if (!eligible.eligible) {
    return {
      receivableId: eligible.receivableId,
      clientId: eligible.clientId,
      clientName: eligible.clientName,
      whatsappNumber: eligible.whatsappNumber || '',
      correlationId,
      status: 'skipped',
      error: eligible.rejectionReasons.join('; '),
    };
  }

  // Gerar mensagem (com dispatchCount para escolher D1 vs D)
  // SEMPRE usar paymentLinkCanonical (nunca link legado)
  const link = eligible.paymentLinkCanonical || 'Link não disponível';
  const dispatchCount = eligible.dispatchCount || 0;
  const message = renderMessage(
    bucketCode,
    {
      nome: eligible.clientName.split(' ')[0], // Primeiro nome
      valor: formatBRL(eligible.amount),
      vencimento: formatDate(eligible.dueDate),
      diasAtraso: eligible.daysOverdue,
      link,
      correlationId,
    },
    dispatchCount // Usado para escolher D1 (primeiro toque) vs D (pré-jurídico)
  );

  const phone = normalizeWhatsApp(eligible.whatsappNumber!);
  
  // Se normalização falhou, retornar erro
  if (!phone) {
    return {
      receivableId: eligible.receivableId,
      clientId: eligible.clientId,
      clientName: eligible.clientName,
      whatsappNumber: eligible.whatsappNumber || 'N/A',
      correlationId,
      status: 'failed',
      error: `INVALID_PHONE_FORMAT: ${eligible.whatsappNumber}`,
      messagePreview: '',
    };
  }
  
  // Template name: se D e dispatchCount=0, usar D1_soft, senão usar bucket original
  const templateSuffix = bucketCode === 'D' && dispatchCount === 0 ? 'D1_soft' : `${bucketCode}_${eligible.daysOverdue}d`;
  const templateName = `bloco11_${templateSuffix}`;

  // Se dry run, não enviar
  if (dryRun) {
    return {
      receivableId: eligible.receivableId,
      clientId: eligible.clientId,
      clientName: eligible.clientName,
      whatsappNumber: phone,
      correlationId,
      status: 'skipped',
      messagePreview: message,
      error: 'DRY_RUN: mensagem não enviada (modo preview)',
    };
  }

  // Enviar via ZapContábil
  console.log(`[BatchSender] 📤 Enviando para ${eligible.clientName} (${phone})...`);
  const sendResult = await sendViaZapContabil(phone, message, correlationId);

  const result: SendResult = {
    receivableId: eligible.receivableId,
    clientId: eligible.clientId,
    clientName: eligible.clientName,
    whatsappNumber: phone,
    correlationId,
    status: sendResult.success ? 'sent' : 'failed',
    messageId: sendResult.messageId,
    error: sendResult.error,
    messagePreview: message,
  };

  // Registrar auditoria
  const auditId = await recordAudit(result, message, templateName);
  result.auditId = auditId || undefined;

  // Atualizar receivable se enviado com sucesso
  if (sendResult.success) {
    await updateReceivableDispatch(eligible.receivableId);
  }

  return result;
}

/**
 * Executar envio em lote controlado
 * 
 * @param bucketCode - Faixa de atraso (A, B, C, D)
 * @param limit - Máximo de mensagens a enviar (default: 10)
 * @param dryRun - Se true, apenas gera preview sem enviar
 */
export async function executeBatch(
  bucketCode: BucketCode,
  limit: number = 10,
  dryRun: boolean = false
): Promise<BatchResult> {
  const batchId = `batch_${bucketCode}_${Date.now()}`;
  
  // KILL_SWITCH: Abortar tudo se KILL_SWITCH=true
  if (process.env.KILL_SWITCH === 'true') {
    console.error('[KILL_SWITCH] ❌ SISTEMA ABORTADO POR KILL_SWITCH');
    throw new Error('KILLED_BY_OWNER: Sistema abortado por KILL_SWITCH ativo');
  }
  
  console.log(`[BatchSender] 🚀 Iniciando lote: batchId=${batchId}, bucket=${bucketCode}, limit=${limit}, dryRun=${dryRun}`);
  console.log(`[BatchSender] 🔍 DEBUG: ALLOW_REAL_SEND=${process.env.ALLOW_REAL_SEND}, KILL_SWITCH=${process.env.KILL_SWITCH}`);

  // 1. Buscar elegíveis
  console.log(`[BatchSender] 🔍 Chamando getEligibleReceivables(${bucketCode}, ${limit})...`);
  const eligibles = await getEligibleReceivables(bucketCode, limit);
  console.log(`[BatchSender] 🔍 getEligibleReceivables retornou ${eligibles.length} receivables`);
  
  console.log(`[BatchSender] 📊 Encontrados ${eligibles.length} receivables (${eligibles.filter(e => e.eligible).length} elegíveis)`);

  // 2. Processar cada um
  const results: SendResult[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let aborted = false;
  let abortReason = '';

  for (let i = 0; i < eligibles.length; i++) {
    const eligible = eligibles[i];
    
    if (sent >= limit) break; // Respeitar limite

    // CIRCUIT BREAKER: verificar a cada 5 envios (ou no final)
    if (!dryRun && i > 0 && i % 5 === 0) {
      const totalAttempted = sent + failed;
      const failureRate = totalAttempted > 0 ? failed / totalAttempted : 0;
      
      console.log(`[BatchSender] 🔍 CIRCUIT BREAKER CHECK: sent=${sent}, failed=${failed}, failureRate=${(failureRate * 100).toFixed(1)}%`);
      
      if (failureRate > 0.10) {
        console.error(`[BatchSender] ❌ CIRCUIT BREAKER ABORTA: failureRate=${(failureRate * 100).toFixed(1)}% > 10%`);
        aborted = true;
        abortReason = `ABORT_ZAP_FAILURE_RATE: ${(failureRate * 100).toFixed(1)}% > 10%`;
        
        // Marcar restantes como aborted
        for (let j = i; j < eligibles.length; j++) {
          const remaining = eligibles[j];
          results.push({
            receivableId: remaining.receivableId,
            clientId: remaining.clientId,
            clientName: remaining.clientName,
            whatsappNumber: remaining.whatsappNumber || 'N/A',
            correlationId: generateCorrelationId(remaining.clientId, remaining.receivableId),
            status: 'skipped',
            error: 'ABORTED_BY_CIRCUIT_BREAKER',
          });
          skipped++;
        }
        
        break; // ABORTAR batch
      }
    }

    const result = await processSingleSend(eligible, bucketCode, dryRun);
    results.push(result);

    switch (result.status) {
      case 'sent':
        sent++;
        break;
      case 'failed':
        failed++;
        break;
      case 'skipped':
        skipped++;
        break;
    }

    // Delay entre envios (1-3 segundos) para não sobrecarregar API
    if (!dryRun && result.status === 'sent') {
      const delay = 1000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const batchResult: BatchResult = {
    batchId,
    bucketCode,
    timestamp: new Date().toISOString(),
    total: results.length,
    sent,
    failed,
    skipped,
    results,
    dryRun,
  };

  console.log(`[BatchSender] ✅ Lote concluído: sent=${sent}, failed=${failed}, skipped=${skipped}`);

  return batchResult;
}
