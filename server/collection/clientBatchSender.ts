/**
 * COBRANÇA CONSOLIDADA — Envio em lote por CLIENTE (mode=client)
 * 
 * Em vez de 1 msg por receivable, envia 1 msg por cliente com
 * todos os títulos consolidados. Anti-spam: máx 1 msg/cliente/dia + 48h cooldown.
 * 
 * Auditoria inclui metaJson com {receivableIds, qtd, totalDebt, bucket}.
 */

import axios from 'axios';
import { getDb } from '../db';
import { whatsappAudit, receivables } from '../../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { BucketCode } from './buckets';
import { ConsolidatedClient, getEligibleClientsForBucket } from './clientConsolidation';
import {
  renderConsolidatedMessage,
  formatBRL,
  formatDate,
  generateConsolidatedCorrelationId,
  CONSOLIDATED_TEMPLATES,
} from './messageTemplates';
import { normalizeWhatsApp } from './normalizeWhatsApp';

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

export interface ClientSendResult {
  clientId: number;
  clientName: string;
  whatsappNumber: string;
  correlationId: string;
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  auditId?: number;
  error?: string;
  reason?: string;
  messagePreview?: string;
  templateUsed?: string;
  paymentLinkCanonical?: string;
  titlesCount?: number;
  totalDebt?: number;
  receivableIds?: number[];
  zap?: {
    connectionFrom: number;
    messageId: string | null;
    providerAck: boolean;
  };
}

export interface ClientBatchResult {
  batchId: string;
  bucketCode: BucketCode;
  mode: 'client';
  timestamp: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: ClientSendResult[];
  dryRun: boolean;
}

/**
 * Enviar mensagem via ZapContábil
 */
async function sendViaZapContabil(
  phone: string,
  message: string,
  correlationId: string
): Promise<{ success: boolean; messageId?: string; error?: string; connectionFrom: number }> {
  if (!ZAP_API_KEY) {
    return { success: false, error: 'ZAP_CONTABIL_API_KEY não configurada', connectionFrom: 0 };
  }

  try {
    const phoneDigits = phone.replace(/\D/g, '');

    const queueId = Number(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO) || undefined;
    console.log(`[ClientBatchSender] 📤 Enviando via ZapContábil: phone=${phoneDigits}, correlationId=${correlationId}, queueId=${queueId || 'nenhum'}`);

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

    console.log(`[ClientBatchSender] ✅ Mensagem enviada: correlationId=${correlationId}, messageId=${messageId}, httpStatus=${response.status}`);

    return {
      success: true,
      messageId: messageId || `ack_${Date.now()}`,
      connectionFrom: 0,
    };
  } catch (error: any) {
    const errMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro desconhecido';
    const httpStatus = error.response?.status || 0;

    console.error(`[ClientBatchSender] ❌ Falha no envio: correlationId=${correlationId}, status=${httpStatus}, error=${errMsg}`);

    return {
      success: false,
      error: `HTTP ${httpStatus}: ${errMsg}`,
      connectionFrom: 0,
    };
  }
}

/**
 * Registrar auditoria consolidada com metaJson
 * Salva 1 registro de audit por CLIENTE (não por receivable)
 * O receivableId aponta para o receivable mais antigo (principal)
 */
async function recordConsolidatedAudit(
  result: ClientSendResult,
  messageContent: string,
  templateUsed: string,
  metaJson: {
    receivableIds: number[];
    qtd: number;
    totalDebt: number;
    bucket: BucketCode;
    mode: 'client';
  }
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // Usar o primeiro receivableId como referência principal
    const primaryReceivableId = metaJson.receivableIds[0];

    const insertResult = await db.insert(whatsappAudit).values({
      clientId: result.clientId,
      receivableId: primaryReceivableId,
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
      pdfUrl: JSON.stringify(metaJson), // Usar pdfUrl como campo para metaJson (temporário)
    });

    const auditId = insertResult[0]?.insertId;
    console.log(`[ClientBatchSender] 📝 Auditoria consolidada: auditId=${auditId}, receivableIds=[${metaJson.receivableIds.join(',')}]`);
    return auditId || null;
  } catch (error: any) {
    console.error(`[ClientBatchSender] ❌ Erro ao registrar auditoria: ${error.message}`);
    return null;
  }
}

/**
 * Atualizar receivables com dados de último envio (todos do cliente)
 */
async function updateReceivablesDispatch(receivableIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    for (const receivableId of receivableIds) {
      await db
        .update(receivables)
        .set({
          lastDispatchedAt: new Date(),
          dispatchCount: sql`${receivables.dispatchCount} + 1`,
        })
        .where(eq(receivables.id, receivableId));
    }
  } catch (error: any) {
    console.error(`[ClientBatchSender] ❌ Erro ao atualizar receivables: ${error.message}`);
  }
}

/**
 * Processar envio consolidado para um único cliente
 */
async function processClientSend(
  client: ConsolidatedClient,
  bucketCode: BucketCode,
  dryRun: boolean
): Promise<ClientSendResult> {
  const receivableIds = client.topReceivables.map(r => r.receivableId);
  const correlationId = generateConsolidatedCorrelationId(client.clientId, receivableIds);

  // Se não é elegível, pular com motivo
  if (!client.eligible) {
    return {
      clientId: client.clientId,
      clientName: client.clientName,
      whatsappNumber: client.whatsappNumber || '',
      correlationId,
      status: 'skipped',
      reason: client.rejectionReasons.join('; '),
      error: client.rejectionReasons.join('; '),
      titlesCount: client.titlesCount,
      totalDebt: client.totalDebt,
      receivableIds,
    };
  }

  // Normalizar telefone
  const phone = normalizeWhatsApp(client.whatsappNumber);
  if (!phone) {
    return {
      clientId: client.clientId,
      clientName: client.clientName,
      whatsappNumber: client.whatsappNumber || 'N/A',
      correlationId,
      status: 'failed',
      reason: `INVALID_PHONE_FORMAT: ${client.whatsappNumber}`,
      error: `INVALID_PHONE_FORMAT: ${client.whatsappNumber}`,
      titlesCount: client.titlesCount,
      totalDebt: client.totalDebt,
      receivableIds,
    };
  }

  // Gerar mensagem consolidada com lista de boletos por mês/ano
  const templateName = `bloco11_CONSOLIDADO_v2_${bucketCode}`;
  const message = renderConsolidatedMessage(bucketCode, {
    nome: client.clientName.split(' ')[0],
    qtd: client.titlesCount,
    total: formatBRL(client.totalDebt),
    maisAntigo: formatDate(client.oldestDue),
    maisRecente: formatDate(client.newestDue),
    diasAtraso: client.maxDaysOverdue,
    link: client.paymentLinkCanonical || 'Link não disponível',
    correlationId,
    // Passar todos os receivables para gerar lista por mês/ano
    receivablesList: client.topReceivables.map(r => ({
      dueDate: r.dueDate,
      paymentLinkCanonical: r.paymentLinkCanonical,
    })),
  });

  // Se dry run, retornar preview
  if (dryRun) {
    return {
      clientId: client.clientId,
      clientName: client.clientName,
      whatsappNumber: phone,
      correlationId,
      status: 'skipped',
      reason: 'DRY_RUN: mensagem não enviada (modo preview)',
      error: 'DRY_RUN',
      messagePreview: message,
      templateUsed: templateName,
      paymentLinkCanonical: client.paymentLinkCanonical,
      titlesCount: client.titlesCount,
      totalDebt: client.totalDebt,
      receivableIds,
    };
  }

  // Enviar via ZapContábil
  console.log(`[ClientBatchSender] 📤 Enviando consolidado para ${client.clientName} (${phone}) — ${client.titlesCount} títulos, ${formatBRL(client.totalDebt)}`);
  const sendResult = await sendViaZapContabil(phone, message, correlationId);

  const result: ClientSendResult = {
    clientId: client.clientId,
    clientName: client.clientName,
    whatsappNumber: phone,
    correlationId,
    status: sendResult.success ? 'sent' : 'failed',
    messageId: sendResult.messageId,
    error: sendResult.error,
    messagePreview: message,
    templateUsed: templateName,
    paymentLinkCanonical: client.paymentLinkCanonical,
    titlesCount: client.titlesCount,
    totalDebt: client.totalDebt,
    receivableIds,
    zap: {
      connectionFrom: sendResult.connectionFrom,
      messageId: sendResult.messageId || null,
      providerAck: sendResult.success,
    },
  };

  // Registrar auditoria consolidada com metaJson
  const auditId = await recordConsolidatedAudit(result, message, templateName, {
    receivableIds,
    qtd: client.titlesCount,
    totalDebt: client.totalDebt,
    bucket: bucketCode,
    mode: 'client',
  });
  result.auditId = auditId || undefined;

  // Atualizar todos os receivables do cliente
  if (sendResult.success) {
    await updateReceivablesDispatch(receivableIds);
  }

  return result;
}

/**
 * Executar envio consolidado em lote por CLIENTE
 * 
 * @param bucketCode - Faixa de atraso (A, B, C, D)
 * @param limitClients - Máximo de clientes a enviar (default: 10)
 * @param dryRun - Se true, apenas gera preview sem enviar
 */
export async function executeClientBatch(
  bucketCode: BucketCode,
  limitClients: number = 10,
  dryRun: boolean = false
): Promise<ClientBatchResult> {
  const batchId = `batch_client_${bucketCode}_${Date.now()}`;

  // KILL_SWITCH
  if (process.env.KILL_SWITCH === 'true') {
    console.error('[KILL_SWITCH] ❌ SISTEMA ABORTADO POR KILL_SWITCH');
    throw new Error('KILLED_BY_OWNER: Sistema abortado por KILL_SWITCH ativo');
  }

  console.log(`[ClientBatchSender] 🚀 Iniciando lote CONSOLIDADO: batchId=${batchId}, bucket=${bucketCode}, limitClients=${limitClients}, dryRun=${dryRun}`);

  // 1. Buscar clientes elegíveis (já agrupados e filtrados)
  const allClients = await getEligibleClientsForBucket(bucketCode, limitClients * 2);
  console.log(`[ClientBatchSender] 📊 Encontrados ${allClients.length} clientes (${allClients.filter(c => c.eligible).length} elegíveis)`);

  // 2. Processar cada cliente
  const results: ClientSendResult[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const seenPhones = new Set<string>();

  for (const client of allClients) {
    if (sent >= limitClients) break;

    // Anti-duplicata: não enviar para mesmo telefone 2x no mesmo batch
    const normalizedPhone = normalizeWhatsApp(client.whatsappNumber);
    if (normalizedPhone && seenPhones.has(normalizedPhone)) {
      results.push({
        clientId: client.clientId,
        clientName: client.clientName,
        whatsappNumber: client.whatsappNumber,
        correlationId: generateConsolidatedCorrelationId(client.clientId, client.topReceivables.map(r => r.receivableId)),
        status: 'skipped',
        reason: 'DUPLICATE_PHONE_IN_BATCH: mesmo telefone já processado neste lote',
        error: 'DUPLICATE_PHONE_IN_BATCH',
        titlesCount: client.titlesCount,
        totalDebt: client.totalDebt,
        receivableIds: client.topReceivables.map(r => r.receivableId),
      });
      skipped++;
      continue;
    }

    // CIRCUIT BREAKER: verificar a cada 5 envios
    if (!dryRun && sent > 0 && sent % 5 === 0) {
      const totalAttempted = sent + failed;
      const failureRate = totalAttempted > 0 ? failed / totalAttempted : 0;

      console.log(`[ClientBatchSender] 🔍 CIRCUIT BREAKER: sent=${sent}, failed=${failed}, failureRate=${(failureRate * 100).toFixed(1)}%`);

      if (failureRate > 0.10) {
        console.error(`[ClientBatchSender] ❌ CIRCUIT BREAKER ABORTA: failureRate > 10%`);
        break;
      }
    }

    const result = await processClientSend(client, bucketCode, dryRun);
    results.push(result);

    if (normalizedPhone) seenPhones.add(normalizedPhone);

    switch (result.status) {
      case 'sent': sent++; break;
      case 'failed': failed++; break;
      case 'skipped': skipped++; break;
    }

    // Delay entre envios reais (1-3s)
    if (!dryRun && result.status === 'sent') {
      const delay = 1000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const batchResult: ClientBatchResult = {
    batchId,
    bucketCode,
    mode: 'client',
    timestamp: new Date().toISOString(),
    total: results.length,
    sent,
    failed,
    skipped,
    results,
    dryRun,
  };

  console.log(`[ClientBatchSender] ✅ Lote CONSOLIDADO concluído: sent=${sent}, failed=${failed}, skipped=${skipped}`);

  return batchResult;
}
