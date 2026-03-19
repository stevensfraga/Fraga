/**
 * BLOCO 11 — Router Express para endpoints de cobrança controlada
 * 
 * Endpoints:
 * GET  /receivables-by-bucket — Classificação por faixa de atraso
 * GET  /eligible/:bucketCode — Listar elegíveis por faixa
 * POST /send-batch — Enviar lote controlado
 * GET  /batch-status/:batchId — Status de um lote
 */

import { Router, Request, Response } from 'express';
import { BUCKET_DEFINITIONS, classifyReceivables, groupByBucket, BucketCode } from './buckets';
import { getEligibleReceivables } from './eligibilityFilter';
import { executeBatch } from './batchSender';
import { enrichWhatsAppFromContaAzul } from './whatsappEnrichment';
import { enrichFromContaAzulAPI } from './enrichFromContaAzulAPI';
import { getDb } from '../db';
import { receivables, clients, whatsappAudit } from '../../drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

const router = Router();

/**
 * GET /receivables-by-bucket
 * Retorna receivables OVERDUE classificados por faixa de atraso
 */
router.get('/receivables-by-bucket', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    // Buscar todos os receivables OVERDUE
    const overdueRows = await db
      .select({
        id: receivables.id,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        link: receivables.link,
      })
      .from(receivables)
      .where(eq(receivables.status, 'overdue'));

    // Classificar em buckets
    const classified = classifyReceivables(overdueRows);
    const grouped = groupByBucket(classified);

    // Resumo
    const summary = grouped.map(g => ({
      bucket: g.bucket.code,
      label: g.bucket.label,
      description: g.bucket.description,
      messageType: g.bucket.messageType,
      count: g.count,
      totalAmount: g.totalAmount.toFixed(2),
    }));

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalOverdue: overdueRows.length,
      buckets: summary,
      definitions: BUCKET_DEFINITIONS.map(d => ({
        code: d.code,
        label: d.label,
        range: `D+${d.minDays} a D+${d.maxDays === Infinity ? '∞' : d.maxDays}`,
        messageType: d.messageType,
      })),
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em receivables-by-bucket:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /eligible/:bucketCode
 * Listar receivables elegíveis para envio em uma faixa específica
 */
router.get('/eligible/:bucketCode', async (req: Request, res: Response) => {
  try {
    const bucketCode = req.params.bucketCode?.toUpperCase() as BucketCode;
    if (!['A', 'B', 'C', 'D'].includes(bucketCode)) {
      return res.status(400).json({ error: 'bucketCode inválido. Use A, B, C ou D' });
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const eligibles = await getEligibleReceivables(bucketCode, Math.min(limit, 50));

    const eligible = eligibles.filter(e => e.eligible);
    const ineligible = eligibles.filter(e => !e.eligible);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      bucketCode,
      total: eligibles.length,
      eligible: eligible.length,
      ineligible: ineligible.length,
      eligibleList: eligible.map(e => ({
        receivableId: e.receivableId,
        clientId: e.clientId,
        clientName: e.clientName,
        whatsappNumber: e.whatsappNumber,
        amount: e.amount,
        dueDate: e.dueDate,
        daysOverdue: e.daysOverdue,
        link: e.link ? 'SIM' : 'NÃO',
      })),
      ineligibleList: ineligible.map(e => ({
        receivableId: e.receivableId,
        clientName: e.clientName,
        reasons: e.rejectionReasons,
      })),
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em eligible:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /send-batch foi movido para sendBatchRouter.ts (BLOCO 11 C)
 * com proteções adicionais: dryRun + confirm, rate-limit, idempotência
 */

/**
 * GET /audit-log
 * Últimos envios de auditoria
 */
router.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    
    const logs = await db
      .select({
        id: whatsappAudit.id,
        clientId: whatsappAudit.clientId,
        receivableId: whatsappAudit.receivableId,
        correlationId: whatsappAudit.correlationId,
        messageId: whatsappAudit.messageId,
        status: whatsappAudit.status,
        phoneNumber: whatsappAudit.phoneNumber,
        templateUsed: whatsappAudit.templateUsed,
        sentAt: whatsappAudit.sentAt,
        errorMessage: whatsappAudit.errorMessage,
        providerAck: whatsappAudit.providerAck,
        providerTrackingMode: whatsappAudit.providerTrackingMode,
      })
      .from(whatsappAudit)
      .orderBy(desc(whatsappAudit.sentAt))
      .limit(limit);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total: logs.length,
      logs,
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em audit-log:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /enrich-from-api
 * Enriquecer base de WhatsApp via API Conta Azul (busca telefones)
 * Query params:
 * - dryRun=true|false (default: true)
 * - limit=N (default: 50)
 */
router.post('/enrich-from-api', async (req: Request, res: Response) => {
  try {
    const dryRun = req.query.dryRun === 'false' ? false : true;
    const limit = parseInt(req.query.limit as string) || 50;

    console.log(`[CollectionBatch] Enriquecimento via API Conta Azul: dryRun=${dryRun}, limit=${limit}`);

    const result = await enrichFromContaAzulAPI(dryRun, limit);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      dryRun,
      ...result,
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em enrich-from-api:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /enrich-whatsapp
 * Enriquecer base de WhatsApp via Conta Azul (phone -> whatsappNumber)
 * Query params:
 * - dryRun=true|false (default: true)
 * - limit=N (default: 100)
 */
router.post('/enrich-whatsapp', async (req: Request, res: Response) => {
  try {
    const dryRun = req.query.dryRun === 'false' ? false : true;
    const limit = parseInt(req.query.limit as string) || 100;

    console.log(`[CollectionBatch] Enriquecimento WhatsApp: dryRun=${dryRun}, limit=${limit}`);

    const result = await enrichWhatsAppFromContaAzul(dryRun, limit);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      dryRun,
      ...result,
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em enrich-whatsapp:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /summary
 * Resumo geral do sistema de cobrança
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    // Contar receivables por status
    const statusCounts = await db
      .select({
        status: receivables.status,
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<string>`ROUND(SUM(amount), 2)`,
      })
      .from(receivables)
      .groupBy(receivables.status);

    // Contar clientes com WhatsApp
    const clientStats = await db
      .select({
        total: sql<number>`COUNT(*)`,
        comWhatsapp: sql<number>`SUM(CASE WHEN whatsappNumber IS NOT NULL AND whatsappNumber != '' THEN 1 ELSE 0 END)`,
        semOptout: sql<number>`SUM(CASE WHEN optOut = 0 THEN 1 ELSE 0 END)`,
      })
      .from(clients);

    // Contar auditorias de hoje
    const todayAudits = await db
      .select({
        total: sql<number>`COUNT(*)`,
        sent: sql<number>`SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
      })
      .from(whatsappAudit)
      .where(sql`DATE(sentAt) = CURDATE()`);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      receivables: statusCounts,
      clients: clientStats[0] || { total: 0, comWhatsapp: 0, semOptout: 0 },
      todayActivity: todayAudits[0] || { total: 0, sent: 0, failed: 0 },
      zapApiConfigured: !!process.env.ZAP_CONTABIL_API_KEY || !!process.env.WHATSAPP_API_KEY,
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em summary:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /send-direct
 * Enviar cobrança para um receivableId específico (bypass de faixa)
 * 
 * Body:
 * {
 *   receivableId: 420468,
 *   dryRun: false
 * }
 */
router.post('/send-direct', async (req: Request, res: Response) => {
  try {
    const { receivableId: rawId, dryRun: rawDryRun } = req.body;

    if (!rawId) {
      return res.status(400).json({ error: 'receivableId é obrigatório' });
    }

    const receivableId = parseInt(rawId);
    const dryRun = rawDryRun !== false && rawDryRun !== 'false';

    console.log(`[CollectionBatch] POST /send-direct: receivableId=${receivableId}, dryRun=${dryRun}`);

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    // 1. Buscar receivable + cliente
    const rows = await db
      .select({
        id: receivables.id,
        contaAzulId: receivables.contaAzulId,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        status: receivables.status,
        link: receivables.link,
        paymentLinkCanonical: receivables.paymentLinkCanonical, // Link canônico (OBRIGATÓRIO)
        description: receivables.description,
        dispatchCount: receivables.dispatchCount,
        clientName: clients.name,
        whatsappNumber: clients.whatsappNumber,
        whatsappSource: clients.whatsappSource,
        optOut: clients.optOut,
      })
      .from(receivables)
      .innerJoin(clients, eq(receivables.clientId, clients.id))
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: `Receivable ${receivableId} não encontrado` });
    }

    const row = rows[0];

    // 2. Validações
    const validations: { field: string; value: any; expected: string; ok: boolean }[] = [];

    validations.push({ field: 'status', value: row.status, expected: 'overdue', ok: row.status === 'overdue' });
    validations.push({ field: 'whatsappNumber', value: row.whatsappNumber, expected: 'preenchido', ok: !!row.whatsappNumber });
    validations.push({ field: 'optOut', value: row.optOut, expected: 'false', ok: !row.optOut });
    validations.push({ field: 'paymentLinkCanonical', value: row.paymentLinkCanonical ? 'SIM' : 'NÃO', expected: 'SIM', ok: !!row.paymentLinkCanonical });

    const allValid = validations.every(v => v.ok);

    if (!allValid) {
      return res.status(412).json({
        error: 'Receivable não passou nas validações',
        receivableId,
        clientName: row.clientName,
        validations,
      });
    }

    // 3. Calcular dias de atraso e bucket
    const now = new Date();
    const due = new Date(row.dueDate);
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));

    let bucketCode: 'A' | 'B' | 'C' | 'D' = 'D';
    if (daysOverdue <= 3) bucketCode = 'A';
    else if (daysOverdue <= 15) bucketCode = 'B';
    else if (daysOverdue <= 30) bucketCode = 'C';

    // 4. Importar funções necessárias
    const { renderMessage, formatBRL, formatDate, generateCorrelationId } = await import('./messageTemplates');
    const { normalizeWhatsApp } = await import('./eligibilityFilter');

    const correlationId = generateCorrelationId(row.clientId, receivableId);
    const phone = normalizeWhatsApp(row.whatsappNumber!);
    const dispatchCount = row.dispatchCount || 0;

    // SEMPRE usar paymentLinkCanonical (nunca link legado)
    const message = renderMessage(
      bucketCode,
      {
        nome: row.clientName.split(' ')[0],
        valor: formatBRL(row.amount),
        vencimento: formatDate(row.dueDate),
        diasAtraso: daysOverdue,
        link: row.paymentLinkCanonical || 'Link não disponível',
        correlationId,
      },
      dispatchCount
    );

    const templateSuffix = bucketCode === 'D' && dispatchCount === 0 ? 'D1_soft' : `${bucketCode}_${daysOverdue}d`;
    const templateName = `bloco11_${templateSuffix}`;

    // 5. Se dry run, retornar preview
    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        receivableId,
        clientId: row.clientId,
        clientName: row.clientName,
        whatsappNumber: phone,
        amount: row.amount,
        dueDate: row.dueDate,
        daysOverdue,
        bucketCode,
        templateName,
        correlationId,
        validations,
        messagePreview: message,
      });
    }

    // 5.5. PROTEÇÃO: Envio real exige ALLOW_REAL_SEND=true
    if (process.env.ALLOW_REAL_SEND !== 'true') {
      console.log('[GUARD] REAL_SEND_BLOCKED: ALLOW_REAL_SEND!=true (send-direct)');
      return res.status(403).json({
        success: false,
        decision: 'REAL_SEND_DISABLED',
        message: 'Envio real desabilitado. Configure ALLOW_REAL_SEND=true para habilitar.',
        hint: 'Esta é uma proteção de segurança para evitar envios acidentais em produção.',
        currentState: {
          dryRun: false,
          allowRealSend: process.env.ALLOW_REAL_SEND || 'false',
        },
      });
    }

    // 6. Validar phone antes de enviar
    if (!phone) {
      return res.status(412).json({
        error: 'Número de WhatsApp inválido após normalização',
        receivableId,
        clientName: row.clientName,
        rawPhone: row.whatsappNumber,
      });
    }
    
    // 7. Enviar via ZapContábil
    const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
    const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

    if (!ZAP_API_KEY) {
      return res.status(500).json({ error: 'ZAP_CONTABIL_API_KEY não configurada' });
    }

    const phoneDigits = phone.replace(/\D/g, '');
    const queueId = Number(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO) || undefined;
    console.log(`[SendDirect] 📤 Enviando para ${row.clientName} (${phoneDigits}), receivableId=${receivableId}, queueId=${queueId || 'nenhum'}`);

    const zapResponse = await (await import('axios')).default.post(
      `${ZAP_API_URL}/api/send/${phoneDigits}`,
      { body: message, connectionFrom: 0, ...(queueId ? { queueId } : {}) },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const messageId = zapResponse.data?.message?.id || zapResponse.data?.messageId || zapResponse.data?.id;
    const providerAck = !!messageId;
    const providerTrackingMode = messageId ? 'WITH_ID' : 'ACK_ONLY';

    console.log(`[SendDirect] ✅ Enviado: messageId=${messageId}, providerAck=${providerAck}`);

    // 7. Registrar auditoria
    const auditInsert = await db.insert(whatsappAudit).values({
      clientId: row.clientId,
      receivableId,
      messageId: messageId || null,
      correlationId,
      providerTrackingMode,
      providerAck,
      sentAt: new Date(),
      templateUsed: templateName,
      status: 'sent',
      errorMessage: null,
      phoneNumber: phone,
      messageContent: message,
      pdfUrl: null,
    });

    const auditId = auditInsert[0]?.insertId;

    // 8. Atualizar receivable
    await db
      .update(receivables)
      .set({
        lastDispatchedAt: new Date(),
        dispatchCount: dispatchCount + 1,
      })
      .where(eq(receivables.id, receivableId));

    console.log(`[SendDirect] 📝 Auditoria registrada: auditId=${auditId}`);

    return res.json({
      success: true,
      dryRun: false,
      receivableId,
      clientId: row.clientId,
      clientName: row.clientName,
      whatsappNumber: phone,
      amount: row.amount,
      dueDate: row.dueDate,
      daysOverdue,
      bucketCode,
      templateName,
      correlationId,
      status: 'sent',
      messageId,
      providerAck,
      providerTrackingMode,
      auditId,
      sentAt: new Date().toISOString(),
      validations,
      messageContent: message,
    });
  } catch (error: any) {
    console.error('[SendDirect] ❌ Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /whatsapp-quality
 * Relatório de qualidade dos números de WhatsApp
 * 
 * Retorna:
 * - totalClients: total de clientes
 * - comWhatsapp: clientes com whatsappNumber preenchido
 * - validFormat: clientes com formato E.164 válido (+55...)
 * - invalidFormat: clientes com formato inválido
 * - nullWhatsapp: clientes sem WhatsApp
 * - coveragePercent: % de cobertura (validFormat / totalClients)
 */
router.get('/whatsapp-quality', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    // Buscar todos os clientes
    const allClients = await db
      .select({
        id: clients.id,
        name: clients.name,
        whatsappNumber: clients.whatsappNumber,
        whatsappSource: clients.whatsappSource,
      })
      .from(clients);

    const totalClients = allClients.length;
    const comWhatsapp = allClients.filter(c => c.whatsappNumber && c.whatsappNumber.trim() !== '').length;
    const nullWhatsapp = totalClients - comWhatsapp;

    // Validar formato E.164
    const { isValidWhatsAppE164 } = await import('./normalizeWhatsApp');
    
    const validFormat = allClients.filter(c => 
      c.whatsappNumber && isValidWhatsAppE164(c.whatsappNumber)
    ).length;
    
    const invalidFormat = comWhatsapp - validFormat;
    const coveragePercent = totalClients > 0 ? ((validFormat / totalClients) * 100).toFixed(1) : '0.0';

    // Listar clientes com formato inválido (para debug)
    const invalidClients = allClients
      .filter(c => c.whatsappNumber && !isValidWhatsAppE164(c.whatsappNumber))
      .slice(0, 10) // Limitar a 10 exemplos
      .map(c => ({
        id: c.id,
        name: c.name,
        whatsappNumber: c.whatsappNumber,
        source: c.whatsappSource,
      }));

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        totalClients,
        comWhatsapp,
        validFormat,
        invalidFormat,
        nullWhatsapp,
        coveragePercent: `${coveragePercent}%`,
      },
      validation: {
        expectedFormat: '+55XXXXXXXXXXX (13 ou 14 caracteres)',
        constraint: 'CHECK (whatsappNumber IS NULL OR whatsappNumber LIKE \'+55%\')',
      },
      invalidExamples: invalidClients,
    });
  } catch (error: any) {
    console.error('[CollectionBatch] Erro em whatsapp-quality:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
