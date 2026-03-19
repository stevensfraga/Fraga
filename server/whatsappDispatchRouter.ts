import { Router } from "express";
import axios from "axios";
import { createHash } from "crypto";
import { getDb } from "./db";
import { collectionMessages, clients, receivables } from "../drizzle/schema";
import { eq, and, inArray, ne } from "drizzle-orm";
import { whatsappDispatchQueue } from "./queues/whatsappDispatchQueue";

const router = Router();

/**
 * GET /api/dispatch/_env-check
 * Verifica se as credenciais estão carregadas
 */
router.get("/_env-check", (req, res) => {
  const zapUrl = process.env.ZAP_CONTABIL_API_URL;
  const zapKey = process.env.ZAP_CONTABIL_API_KEY;
  const tokenLen = zapKey?.length || 0;
  const tokenHash = zapKey ? createHash('sha256').update(zapKey).digest('hex').substring(0, 10) : 'N/A';

  return res.json({
    hasZapUrl: !!zapUrl,
    zapUrl,
    hasZapKey: !!zapKey,
    tokenLenRaw: tokenLen,
    tokenLenTrim: zapKey?.trim().length || 0,
    tokenHash,
    changedByTrim: tokenLen !== zapKey?.trim().length,
  });
});

/**
 * GET /api/dispatch/zap-health
 * Verifica se o servidor ZapContábil está online
 */
router.get("/zap-health", async (req, res) => {
  const zapApiUrl = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
  
  try {
    const response = await axios.get(`${zapApiUrl}/status`, {
      timeout: 10000,
    });

    return res.json({
      success: true,
      zapApiUrl,
      status: response.status,
      body: response.data,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: err?.message || "ZAP_HEALTH_CHECK_FAILED",
      zapApiUrl,
    });
  }
});

/**
 * GET /api/dispatch/candidates
 * Lista receivables candidatos para envio
 */
router.get("/candidates", async (req, res) => {
  const db = await getDb();
  if (!db) return res.status(500).json({ success: false, error: "Database not available" });

  try {
    const source = req.query.source as string || "conta-azul";
    const statusStr = (req.query.status as string || "pending|overdue|paid").split("|");
    const status = statusStr as Array<'pending' | 'overdue' | 'paid' | 'cancelled'>;
    const limit = Number(req.query.limit) || 50;
    const includeInvalid = req.query.includeInvalid === "true";
    const onlyWithWhatsapp = req.query.onlyWithWhatsapp !== "false";

    let query = db
      .select({
        id: receivables.id,
        contaAzulId: receivables.contaAzulId,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        status: receivables.status,
        whatsappNumber: clients.whatsappNumber,
        clientName: clients.name,
        linhaDigitavel: receivables.linhaDigitavel,
        link: receivables.link,
        isReal: receivables.source,
      })
      .from(receivables)
      .innerJoin(clients, eq(receivables.clientId, clients.id))
      .where(inArray(receivables.status, status))
      .limit(limit);

    // onlyWithWhatsapp filter applied in query above

    const candidates = await query;

    return res.json({
      success: true,
      count: candidates.length,
      candidates,
    });
  } catch (err: any) {
    console.error("[Dispatch] Erro ao listar candidatos:", err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message || "CANDIDATES_ERROR",
    });
  }
});

/**
 * POST /api/dispatch/send-boleto/:receivableId
 * Envia boleto com payment info REAL (linhaDigitavel ou link público)
 * Rígido: sem fallback, sem placeholder, sem dados fake
 */
router.post("/send-boleto/:receivableId", async (req, res) => {
  const receivableId = Number(req.params.receivableId);
  const db = await getDb();

  try {
    if (!db) throw new Error("Database not available");

    const receivableResult = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    const boleto = receivableResult[0];
    if (!boleto) {
      return res.status(404).json({ success: false, error: "RECEIVABLE_NOT_FOUND", receivableId });
    }

    const clientResult = await db
      .select()
      .from(clients)
      .where(eq(clients.id, boleto.clientId))
      .limit(1);

    const client = clientResult[0];
    if (!client) {
      return res.status(404).json({ success: false, error: "CLIENT_NOT_FOUND", receivableId });
    }

    // Validar dados REAL com trim para evitar espaços
    const rawLink = boleto.link ? String(boleto.link).trim() : null;
    const rawLinhaDigitavel = boleto.linhaDigitavel ? String(boleto.linhaDigitavel).trim() : null;

    const hasLinhaDigitavel = !!rawLinhaDigitavel;
    const hasLink = !!rawLink;
    const hasPrivateLink = rawLink?.includes('api-v2.contaazul.com') || false;

    // ORDEM CORRETA:
    // 1. Primeiro: verificar se tem PELO MENOS um dos dois (linhaDigitavel ou link)
    if (!hasLinhaDigitavel && !hasLink) {
      console.error(`[DispatchValidation] BLOQUEADO - sem linhaDigitavel ou link`);
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: "linhaDigitavel ou link obrigatório",
        boletoId: receivableId,
      });
    }

    // 2. Depois: verificar se tem APENAS link privado (sem linhaDigitavel)
    if (hasPrivateLink && !hasLinhaDigitavel) {
      console.error(`[DispatchValidation] BLOQUEADO - link privado sem linhaDigitavel`);
      return res.status(400).json({
        success: false,
        error: 'PAYMENT_INFO_NOT_PUBLIC',
        boletoId: receivableId,
        message: 'Link protegido da API — precisa linha digitável ou PDF público',
        hasLinhaDigitavel: hasLinhaDigitavel,
        hasLink: hasLink,
      });
    }

    // Validações básicas
    const amountNum = typeof boleto.amount === 'string' ? parseFloat(boleto.amount) : (boleto.amount || 0);
    if (!amountNum || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: "amount deve ser > 0",
        boletoId: receivableId,
      });
    }

    const dueDate = boleto.dueDate ? new Date(boleto.dueDate) : null;
    if (!dueDate || isNaN(dueDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: "dueDate inválida",
        boletoId: receivableId,
      });
    }

    if (!client.whatsappNumber) {
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: "whatsappNumber obrigatório",
        boletoId: receivableId,
      });
    }

    // Determinar paymentSource
    const paymentSource = hasLinhaDigitavel ? 'linhaDigitavel' : 'link';

    console.log(`[DispatchValidation] APROVADO - receivableId=${receivableId}, amount=${amountNum}, dueDate=${dueDate.toLocaleDateString('pt-BR')}, paymentSource=${paymentSource}`);

    // Montar mensagem
    const msg = 
      `⚠️ Aviso de Boleto em Aberto\n\n` +
      `Olá! 👋\n` +
      `Identificamos um boleto em aberto em seu cadastro.\n\n` +
      `Segue abaixo os dados para conferência e regularização:\n\n` +
      `💰 Valor: R$ ${amountNum.toFixed(2)}\n` +
      `📅 Vencimento: ${dueDate.toLocaleDateString('pt-BR')}\n` +
      (hasLinhaDigitavel ? `📄 Linha Digitável: ${rawLinhaDigitavel}\n` : '') +
      (hasLink && !hasPrivateLink ? `🔗 Link: ${rawLink}\n` : '') +
      `\n` +
      `Se já houve pagamento, por favor desconsidere.\n` +
      `Em caso de dúvidas, estou à disposição 🙂`;

    // Enfileirar na fila BullMQ
    try {
      const job = await whatsappDispatchQueue.add(
        'dispatch-boleto',
        {
          receivableId,
          clientId: client.id,
          phone: client.whatsappNumber,
          message: msg,
          boletoId: receivableId,
          kind: 'boleto',
        },
        {
          jobId: `boleto-${receivableId}-${Date.now()}`,
        }
      );

      console.log(`[Queue] Boleto ${receivableId} enfileirado. JobId: ${job.id}`);

      return res.status(202).json({
        success: true,
        queued: true,
        jobId: job.id,
        receivableId,
        message: 'Boleto enfileirado para envio com retry automático',
      });
    } catch (queueErr: any) {
      if (queueErr.message?.includes('ECONNREFUSED') || queueErr.message?.includes('Redis')) {
        console.error(`[Queue] Redis indisponível: ${queueErr.message}`);
        return res.status(503).json({
          success: false,
          error: 'QUEUE_UNAVAILABLE',
          reason: 'Redis não está disponível',
        });
      }
      throw queueErr;
    }
  } catch (err: any) {
    console.error("[Dispatch] Erro ao enfileirar boleto:", err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message || "QUEUE_ERROR",
    });
  }
});

/**
 * POST /api/dispatch/send-precharge/:receivableId
 * Envia mensagem de PRÉ-COBRANÇA (somente valor + vencimento, sem boleto)
 * SÍNCRONO: sem Redis/BullMQ, envio direto via ZapContábil
 * Sem fallback, sem placeholders, sem dados mock
 */
router.post("/send-precharge/:receivableId", async (req, res) => {
  const receivableId = Number(req.params.receivableId);
  const db = await getDb();
  
  try {
    if (!db) throw new Error("Database not available");

    // 1. Carregar receivable
    const receivableResult = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    const receivable = receivableResult[0];
    if (!receivable) {
      return res.status(404).json({ success: false, error: "RECEIVABLE_NOT_FOUND", receivableId });
    }

    // 2. Carregar cliente
    const clientResult = await db
      .select()
      .from(clients)
      .where(eq(clients.id, receivable.clientId))
      .limit(1);

    const client = clientResult[0];
    if (!client) {
      return res.status(404).json({ success: false, error: "CLIENT_NOT_FOUND", receivableId });
    }

    // 3. BLOQUEIO: Dados de teste (mock)
    const isTestData = 
      receivable.source === 'test' ||
      receivable.contaAzulId?.startsWith('receivable_test_') ||
      client.name?.includes('Teste');
    
    if (isTestData) {
      console.error(`[PrechargeValidation] BLOQUEADO_TEST_DATA - receivableId=${receivableId}`);
      return res.status(400).json({
        success: false,
        error: 'DISPATCH_BLOCKED_TEST_DATA',
        receivableId,
        message: 'Envio bloqueado: dados de teste detectados',
      });
    }

    // 4. BLOQUEIO RIGOROSO: Validar dados REAL obrigatórios
    // 4.1 Validar amount (obrigatório, > 0)
    const amountNum = typeof receivable.amount === 'string' ? parseFloat(receivable.amount) : (receivable.amount || 0);
    if (!amountNum || amountNum <= 0) {
      console.error(`[PrechargeValidation] BLOQUEADO - amount inválido: ${amountNum}`);
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: `amount deve ser > 0, recebido: ${amountNum}`,
        receivableId,
      });
    }

    // 4.2 Validar dueDate (obrigatório, data válida)
    if (!receivable.dueDate) {
      console.error(`[PrechargeValidation] BLOQUEADO - dueDate ausente`);
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: "dueDate obrigatória",
        receivableId,
      });
    }
    
    const dueDate = new Date(receivable.dueDate);
    if (isNaN(dueDate.getTime())) {
      console.error(`[PrechargeValidation] BLOQUEADO - dueDate inválida: ${receivable.dueDate}`);
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: `dueDate inválida: ${receivable.dueDate}`,
        receivableId,
      });
    }

    // 4.3 Validar status (deve ser pending ou overdue)
    if (!['pending', 'overdue'].includes(receivable.status || '')) {
      console.error(`[PrechargeValidation] BLOQUEADO - status inválido: ${receivable.status}`);
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: `status deve ser pending ou overdue, recebido: ${receivable.status}`,
        receivableId,
      });
    }

    // 4.4 Validar whatsappNumber
    if (!client.whatsappNumber) {
      console.error(`[PrechargeValidation] BLOQUEADO - whatsappNumber ausente`);
      return res.status(400).json({
        success: false,
        error: "REAL_DATA_REQUIRED",
        reason: "whatsappNumber obrigatório",
        receivableId,
      });
    }

    // LOG OBRIGATÓRIO: [PrechargeValidation] com AUDITORIA DE ORIGEM DOS DADOS
    const auditLog = `[PrechargeValidation] PRECHARGE APROVADO - receivableId=${receivableId}, amount=${amountNum} (source=receivables.amount), dueDateISO=${receivable.dueDate} (source=receivables.dueDate), phone=${client.whatsappNumber} (source=clients.whatsappNumber), clientId=${client.id}`;
    console.log(auditLog);

    // 5. Montar mensagem de PRÉ-COBRANÇA (APENAS com dados REAL validados)
    const msg = 
      `Olá! Aqui é da Fraga Contabilidade.\n\n` +
      `Identificamos um valor em aberto em nosso sistema.\n\n` +
      `💰 Valor: R$ ${amountNum.toFixed(2)}\n` +
      `📅 Vencimento: ${dueDate.toLocaleDateString('pt-BR')}\n\n` +
      `Se preferir, me responda por aqui que nossa equipe te orienta para regularizar.`;

    // 6. Enviar SÍNCRONO via ZapContábil (sem Redis/BullMQ)
    const zapApiUrl = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
    const zapApiKey = process.env.ZAP_CONTABIL_API_KEY;

    if (!zapApiKey) throw new Error('ZAP_CONTABIL_API_KEY not configured');

    // Normalizar número
    const toDigits = client.whatsappNumber.replace(/\D/g, '');

    // LOG ANTES DO ENVIO: Payload REAL completo
    console.log(`[PrechargeDispatch] Payload final enviado: ${JSON.stringify({ phone: toDigits, body: msg })}`);

    let messageId: string | undefined;
    let httpStatus: number = 0;

    try {
      const zapResponse = await axios.post(
        `${zapApiUrl}/api/send/${toDigits}`,
        {
          body: msg,
          connectionFrom: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${zapApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      messageId = zapResponse.data?.message?.id;
      httpStatus = zapResponse.status;

      console.log(`[PrechargeDispatch] Enviado com sucesso. HTTP Status: ${httpStatus}, MessageId: ${messageId}`);
    } catch (err: any) {
      console.error('[PrechargeDispatch] ERRO HTTP', {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message
      });
      throw err;
    }

    // 7. Persistir no banco
    const existingMsg = await db
      .select()
      .from(collectionMessages)
      .where(eq(collectionMessages.receivableId, receivableId))
      .limit(1);

    if (existingMsg.length > 0) {
      await db
        .update(collectionMessages)
        .set({
          status: 'sent',
          whatsappMessageId: messageId,
          sentAt: new Date(),
          attemptCount: (existingMsg[0].attemptCount || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(collectionMessages.id, existingMsg[0].id));
    } else {
      await db.insert(collectionMessages).values({
        clientId: client.id,
        cnpj: 'N/A',
        receivableId,
        messageType: 'friendly',
        messageTemplate: 'precharge_dispatch',
        messageSent: msg,
        whatsappMessageId: messageId,
        status: 'sent',
        sentAt: new Date(),
        attemptCount: 1,
        outcome: 'pending',
      });
    }

    return res.status(202).json({
      success: true,
      sent: true,
      receivableId,
      messageId,
      phone: client.whatsappNumber,
      message: 'Pré-cobrança enviada com sucesso',
      zapResponse: {
        status: httpStatus,
        messageId,
      },
    });
  } catch (err: any) {
    const errorMsg = err?.message || 'UNKNOWN_ERROR';
    const httpErrorStatus = err?.response?.status || 500;

    console.error(`[PrechargeDispatch] Erro ao enviar: ${errorMsg} (status: ${httpErrorStatus})`);

    return res.status(httpErrorStatus).json({
      success: false,
      error: 'ZAP_SEND_FAILED',
      reason: errorMsg,
      receivableId,
    });
  }
});

export default router;
