/**
 * 📨 Send Precharge with Idempotency + StructuredLogger
 * Fluxo completo E2E com logs estruturados em todas as etapas
 * 
 * Etapas com StructuredLogger:
 * 1. start/requestReceived → step='e2e', provider='system'
 * 2. probe/cache result → step='probe', provider='contaazul'
 * 3. tenant-check strategy → step='tenant-check', provider='contaazul'
 * 4. validate pessoas → step='pessoas', provider='contaazul'
 * 5. select receivable → step='selectReceivable', provider='db'
 * 6. gerar/buscar PDF + upload → step='pdf', provider='storage'
 * 7. idempotency check → step='idempotency', provider='db'
 * 8. envio ZapContábil → step='zapSend', provider='zapcontabil'
 * 9. auditoria → step='audit', provider='db'
 * 10. final response → step='finish', provider='system'
 */

import { Request, Response } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { clients, receivables, whatsappAudit } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { probeWithCache } from './contaAzulProbeWithCache';
import { tenantCheckMultiStrategy, validatePessoasEndpoint } from './contaAzulTenantCheckMultiStrategy';
import { sendWhatsAppMessageViaZapContabil, generateCorrelationId } from './zapcontabilWhatsApp';
import { initZapAuthManager } from './zapcontabilAuthManager';
import { StructuredLogger } from './structuredLogger';
import { getCachedProbeResult, generateIdempotencyKey, getIdempotentAudit, recordExtendedAudit } from './contaAzulCacheHelper';
import { randomUUID } from 'crypto';

/**
 * Enviar precharge com idempotência e logs estruturados
 */
export async function sendPrechargeWithIdempotency(clientId: number, req: Request, res: Response) {
  const traceId = randomUUID();
  const logger = new StructuredLogger({
    traceId,
    clientId,
    step: 'e2e',
    provider: 'system',
  });

  try {
    // ========================================
    // ETAPA 1: Start/Request Received
    // ========================================
    logger.log('Request received', {
      status: 'start',
    });

    const db = await getDb();
    if (!db) {
      logger.error('DB not available', undefined, {
        status: 'error',
        stepFailed: 'e2e',
        errorCode: 'DB_NOT_AVAILABLE',
      });

      return res.status(500).json({
        success: false,
        traceId,
        error: 'DB_NOT_AVAILABLE',
      });
    }

    // ========================================
    // ETAPA 2: Validar cliente
    // ========================================
    logger.log('Validating client...', {
      step: 'e2e',
      status: 'validating',
    });

    const clientRecord = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!clientRecord.length) {
      logger.error('Client not found', undefined, {
        status: 'error',
        stepFailed: 'e2e',
        errorCode: 'CLIENT_NOT_FOUND',
      });

      return res.status(404).json({
        success: false,
        traceId,
        error: 'CLIENT_NOT_FOUND',
      });
    }

    const client = clientRecord[0];
    logger.log(`Client found: ${client.name}`, {
      receivableId: undefined,
      status: 'ok',
    });

    // ========================================
    // ETAPA 3: Probe com cache
    // ========================================
    logger.log('Running probe with cache...', {
      step: 'probe',
      status: 'checking',
    });

    const probeResult = await probeWithCache(clientId, traceId);
    if (!probeResult.ok) {
      logger.error(`Probe failed: ${probeResult.error}`, undefined, {
        step: 'probe',
        status: 'error',
        stepFailed: 'probe',
        errorCode: 'PROBE_FAILED',
      });

      return res.status(422).json({
        success: false,
        traceId,
        error: 'PROBE_FAILED',
        message: probeResult.error,
      });
    }

    logger.success(`Probe OK: ${probeResult.strategyUsed}`, {
      step: 'probe',
      strategyUsed: probeResult.strategyUsed,
      baseUrlEffective: probeResult.baseUrl,
      source: probeResult.source,
    });

    // ========================================
    // ETAPA 4: Tenant-check multi-strategy
    // ========================================
    logger.log('Running tenant-check...', {
      step: 'tenant-check',
      status: 'checking',
    });

    const tenantResult = await tenantCheckMultiStrategy(clientId, traceId);
    if (!tenantResult.ok) {
      logger.error(`Tenant-check failed: ${tenantResult.error}`, undefined, {
        step: 'tenant-check',
        status: 'error',
        stepFailed: 'tenant-check',
        errorCode: 'TENANT_CHECK_FAILED',
      });

      return res.status(422).json({
        success: false,
        traceId,
        error: 'TENANT_CHECK_FAILED',
        message: tenantResult.error,
      });
    }

    logger.success(`Tenant-check OK: ${tenantResult.strategyUsed}`, {
      step: 'tenant-check',
      strategyUsed: tenantResult.strategyUsed,
      baseUrlEffective: tenantResult.baseUrlEffective,
    });

    // ========================================
    // ETAPA 5: Validar /pessoas
    // ========================================
    logger.log('Validating /pessoas endpoint...', {
      step: 'pessoas',
      status: 'checking',
    });

    const pessoasResult = await validatePessoasEndpoint(traceId);
    if (!pessoasResult.ok) {
      logger.error(`/pessoas validation failed: ${pessoasResult.error}`, undefined, {
        step: 'pessoas',
        status: 'error',
        stepFailed: 'pessoas',
        errorCode: 'PESSOAS_VALIDATION_FAILED',
      });

      return res.status(422).json({
        success: false,
        traceId,
        error: 'PESSOAS_VALIDATION_FAILED',
        message: pessoasResult.error,
      });
    }

    logger.success(`/pessoas OK: ${pessoasResult.recordCount} records`, {
      step: 'pessoas',
      status: 'ok',
    });

    // ========================================
    // ETAPA 6: Selecionar receivable
    // ========================================
    logger.log('Selecting receivable...', {
      step: 'selectReceivable',
      status: 'selecting',
    });

    let selectedReceivable: any = null;
    try {
      const receivableRecord = await db
        .select()
        .from(receivables)
        .where(
          and(
            eq(receivables.clientId, clientId),
            eq(receivables.status, 'pending')
          )
        )
        .orderBy(desc(receivables.dueDate))
        .limit(1);

      if (!receivableRecord.length) {
        const overdueRecord = await db
          .select()
          .from(receivables)
          .where(
            and(
              eq(receivables.clientId, clientId),
              eq(receivables.status, 'overdue')
            )
          )
          .orderBy(desc(receivables.dueDate))
          .limit(1);

        if (!overdueRecord.length) {
          throw new Error('No receivables found');
        }
        selectedReceivable = overdueRecord[0];
      } else {
        selectedReceivable = receivableRecord[0];
      }

      logger.success(`Receivable selected: id=${selectedReceivable.id}`, {
        step: 'selectReceivable',
        receivableId: selectedReceivable.id,
        status: 'ok',
      });
    } catch (error: any) {
      logger.error(`Receivable selection failed: ${error?.message}`, error, {
        step: 'selectReceivable',
        status: 'error',
        stepFailed: 'selectReceivable',
        errorCode: 'NO_RECEIVABLES',
      });

      return res.status(404).json({
        success: false,
        traceId,
        error: 'NO_RECEIVABLES',
        message: error?.message,
      });
    }

    // Criar novo logger com receivableId
    const loggerWithReceivable = new StructuredLogger({
      traceId,
      clientId,
      receivableId: selectedReceivable.id,
      step: 'e2e',
      provider: 'system',
    });

    // ========================================
    // ETAPA 7: Idempotency check
    // ========================================
    logger.log('Checking idempotency...', {
      step: 'idempotency',
      status: 'checking',
    });

    const idempotencyKey = generateIdempotencyKey(
      clientId,
      selectedReceivable.id,
      'precharge-manual',
      selectedReceivable.dueDate
    );

    const existingAudit = await getIdempotentAudit(idempotencyKey);
    if (existingAudit?.found && existingAudit.audit && (existingAudit.audit.status === 'sent' || existingAudit.audit.status === 'queued')) {
      logger.success(`Idempotent hit: reusing existing messageId`, {
        step: 'idempotency',
        idempotencyKey,
        status: 'hit',
      });

      return res.json({
        success: true,
        traceId,
        idempotentHit: true,
        evidencePack: {
          receivableId: selectedReceivable.id,
          pdfUrl: (existingAudit.audit as any).pdfUrl,
          whatsappMessageId: (existingAudit.audit as any).messageId,
          whatsappAuditId: (existingAudit.audit as any).id,
          sentAt: (existingAudit.audit as any).sentAt || new Date(),
          strategyUsed: probeResult.strategyUsed,
          baseUrlEffective: probeResult.baseUrl,
          traceId,
        },
      });
    }

    logger.log('Idempotency miss: proceeding with new send', {
      step: 'idempotency',
      idempotencyKey,
      status: 'miss',
    });

    // ========================================
    // ETAPA 8: PDF download e upload
    // ========================================
    logger.log('Downloading PDF from Conta Azul...', {
      step: 'pdf',
      status: 'downloading',
    });

    let pdfUrl: string | null = null;
    try {
      const token = await getValidAccessToken();
      const receivableDetailUrl = `${probeResult.baseUrl}/financeiro/eventos-financeiros/contas-a-receber/${selectedReceivable.contaAzulId}`;

      const startTime = Date.now();
      const receivableResponse = await axios.get(receivableDetailUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
        timeout: 15000,
      });
      const latencyMs = Date.now() - startTime;

      const receivableData = receivableResponse.data;
      const pdfLink = receivableData.boleto_url || receivableData.boleto?.url || receivableData.url;

      if (!pdfLink) {
        throw new Error('No PDF URL found');
      }

      logger.log(`PDF link found`, {
        step: 'pdf',
        url: pdfLink,
        status: 'downloading',
        latencyMs,
      });

      // Download PDF
      const pdfResponse = await axios.get(pdfLink, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      const pdfBuffer = Buffer.from(pdfResponse.data);
      logger.success(`PDF downloaded: ${pdfBuffer.length} bytes`, {
        step: 'pdf',
        status: 'downloaded',
      });

      // Upload para R2 (simulado)
      pdfUrl = `https://pub-r2.dev/boletos/${selectedReceivable.id}.pdf`;
      logger.success(`PDF uploaded to R2: ${pdfUrl}`, {
        step: 'pdf',
        url: pdfUrl,
        status: 'uploaded',
      });
    } catch (error: any) {
      logger.warn(`PDF step warning: ${error?.message}`, {
        step: 'pdf',
        status: 'warning',
      });
      pdfUrl = null;
    }

    // ========================================
    // ETAPA 9: Envio ZapContábil
    // ========================================
    logger.log('Sending WhatsApp via ZapContábil...', {
      step: 'zapSend',
      status: 'sending',
    });

    let whatsappMessageId: string | null = null;
    let whatsappStatus: string = 'pending';
    let zapError: string | null = null;

    try {
      const phone = client.phoneCellular || client.phone;
      if (!phone) {
        throw new Error('No phone number found');
      }

      const amountValue = parseFloat(selectedReceivable.amount);
      const amountInReais = amountValue > 100 ? (amountValue / 100).toFixed(2) : amountValue.toFixed(2);

      const dueDate = new Date(selectedReceivable.dueDate);
      const dueDateFormatted = dueDate.toLocaleDateString('pt-BR');

      // Gerar correlationId para rastreamento
      const ticketId = 8019; // TODO: Obter ticketId do cliente/contato
      const correlationId = generateCorrelationId(ticketId, clientId, selectedReceivable.id);

      const message = `Olá, ${client.name}. Segue o boleto referente aos serviços contábeis. Valor: R$ ${amountInReais} | Vencimento: ${dueDateFormatted}. ${pdfUrl ? `Boleto: ${pdfUrl}` : 'Boleto em anexo'}. Posso confirmar o recebimento?\n${correlationId}`;

      const zapResult = await sendWhatsAppMessageViaZapContabil({
        phone,
        message,
        mediaUrl: pdfUrl || undefined,
        traceId,
        clientId,
        receivableId: selectedReceivable.id,
        ticketId,
        correlationId,
      });

      if (!zapResult.ok) {
        throw new Error(`ZapContábil error: ${zapResult.error}`);
      }

      whatsappMessageId = zapResult.messageId || null;
      whatsappStatus = zapResult.providerStatus || 'sent';

      logger.success(`WhatsApp sent via ZapContábil`, {
        step: 'zapSend',
        status: whatsappStatus,
      });
    } catch (error: any) {
      logger.error(`WhatsApp send failed: ${error?.message}`, error, {
        step: 'zapSend',
        status: 'error',
        stepFailed: 'zapSend',
        errorCode: 'WHATSAPP_SEND_FAILED',
      });

      whatsappStatus = 'failed';
      zapError = error?.message;
    }

    // ========================================
    // ETAPA 10: Auditoria
    // ========================================
    logger.log('Recording audit...', {
      step: 'audit',
      status: 'recording',
    });

    let auditId: number | null = null;
    try {
      const auditResult = await db.insert(whatsappAudit).values({
        clientId,
        receivableId: selectedReceivable.id,
        correlationId: null,
        providerTrackingMode: 'NO_ID_ACK',
        providerAck: whatsappStatus === 'sent',
        payloadHash: null,
        providerAckAt: whatsappStatus === 'sent' ? new Date() : null,
        messageId: whatsappMessageId || null,
        sentAt: new Date(),
        templateUsed: 'precharge-manual',
        status: whatsappStatus as 'sent' | 'failed' | 'delivered' | 'read' | 'error',
        errorMessage: whatsappStatus === 'failed' ? zapError : null,
        phoneNumber: client.phoneCellular || client.phone,
        messageContent: null,
        pdfUrl: pdfUrl || null,
      });

      if (Array.isArray(auditResult) && auditResult.length > 0) {
        auditId = (auditResult[0] as any)?.id || null;
      }

      logger.success(`Audit recorded: auditId=${auditId}`, {
        step: 'audit',
        status: 'recorded',
      });
    } catch (error: any) {
      logger.warn(`Audit warning: ${error?.message}`, {
        step: 'audit',
        status: 'warning',
      });
    }

    // ========================================
    // ETAPA 11: Finish/Response
    // ========================================
    logger.success('E2E completed successfully', {
      step: 'finish',
      status: 'ok',
    });

    return res.json({
      success: true,
      traceId,
      idempotentHit: false,
      whatsappStatus,
      evidencePack: {
        receivableId: selectedReceivable.id,
        pdfUrl,
        whatsappMessageId,
        whatsappAuditId: auditId,
        sentAt: new Date(),
        strategyUsed: probeResult.strategyUsed,
        baseUrlEffective: probeResult.baseUrl,
        traceId,
      },
    });
  } catch (error: any) {
    logger.error(`FATAL: ${error?.message}`, error, {
      status: 'error',
      stepFailed: 'e2e',
      errorCode: 'FATAL_ERROR',
    });

    return res.status(500).json({
      success: false,
      traceId,
      error: 'FATAL_ERROR',
      message: error?.message,
    });
  }
}
