import { Router, Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import {
  resolveClientByPhone,
  getOpenDebtSummary,
  intentDetect,
  buildReply,
  sendWhatsAppReply,
  auditAIInteraction,
} from './aiDebtAssistant';

const router = Router();

// Rate limiter simples em memória (produção: usar Redis)
const rateLimitMap = new Map<string, number>();

function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const lastCall = rateLimitMap.get(phone) || 0;
  
  // Limite: 1 resposta por 10 segundos
  if (now - lastCall < 10000) {
    return false;
  }
  
  rateLimitMap.set(phone, now);
  return true;
}

/**
 * POST /api/whatsapp/inbound
 * Recebe mensagem de entrada do cliente
 * Payload esperado: { fromPhone, text, messageId? }
 */
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const { fromPhone, text, messageId } = req.body;

    // Validação básica
    if (!fromPhone || !text) {
      return res.status(400).json({ error: 'fromPhone e text são obrigatórios' });
    }

    // Rate limiting
    if (!checkRateLimit(fromPhone)) {
      return res.status(429).json({ error: 'Muitas requisições. Aguarde 10 segundos.' });
    }

    const correlationId = uuidv4();
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    try {
      // 1. Persistir mensagem de entrada
      const [insertResult] = await conn.execute(
        `INSERT INTO inbound_messages (fromPhone, text, messageId, processed) 
         VALUES (?, ?, ?, false)`,
        [fromPhone, text, messageId || null]
      );

      // 2. Resolver cliente
      const clientInfo = await resolveClientByPhone(fromPhone);
      const clientId = clientInfo?.clientId || null;

      // 3. Detectar intenção
      const intent = intentDetect(text);

      // 4. Buscar dados de dívida (se cliente identificado)
      let debtSummary = null;
      let dbQueryMeta: any = { clientFound: !!clientInfo };

      if (clientId) {
        debtSummary = await getOpenDebtSummary(clientId);
        if (debtSummary) {
          dbQueryMeta = {
            clientFound: true,
            clientName: debtSummary.clientName,
            totalDebt: debtSummary.totalDebt,
            titlesCount: debtSummary.receivables.length,
            oldestDueDate: debtSummary.receivables[0]?.dueDate,
          };
        }
      }

      // 5. Detectar necessidade de handoff
      let handoffToHuman = false;
      let handoffReason: string | null = null;

      // Handoff se: ameaça legal, disputa, cancelamento, desconto incomum
      if (text.toLowerCase().includes('advogado') || 
          text.toLowerCase().includes('processo') ||
          text.toLowerCase().includes('jurídico')) {
        handoffToHuman = true;
        handoffReason = 'legal_threat';
      } else if (text.toLowerCase().includes('disputa') || 
                 text.toLowerCase().includes('não devo')) {
        handoffToHuman = true;
        handoffReason = 'dispute';
      } else if (text.toLowerCase().includes('cancelar') || 
                 text.toLowerCase().includes('encerrar')) {
        handoffToHuman = true;
        handoffReason = 'contract_cancellation';
      }

      // 6. Gerar resposta
      let response = '';
      if (handoffToHuman) {
        response = 'Sua solicitação foi encaminhada para nossa equipe de atendimento. Retornaremos em breve.';
      } else if (!clientId) {
        response = 'Não conseguimos identificar sua conta. Por favor, confirme seu CNPJ ou email para prosseguir.';
      } else if (!debtSummary || debtSummary.receivables.length === 0) {
        response = 'Não encontramos débitos abertos em sua conta. Obrigado!';
      } else {
        response = buildReply(intent, debtSummary);
      }

      // 7. Enviar resposta (se não for handoff)
      if (!handoffToHuman && clientId && debtSummary) {
        try {
          await sendWhatsAppReply(fromPhone, response);
        } catch (sendError) {
          console.error(`[Inbound] Erro ao enviar resposta para ${fromPhone}:`, sendError);
          // Continuar mesmo se falhar envio (auditoria será registrada)
        }
      }

      // 8. Auditar interação
      await auditAIInteraction({
        fromPhone,
        clientId,
        intent,
        dbQueryMeta: JSON.stringify(dbQueryMeta),
        response,
        correlationId,
        handoffToHuman,
        handoffReason: handoffReason || undefined,
      });

      // 9. Marcar como processada
      await conn.execute(
        `UPDATE inbound_messages SET processed = true, clientId = ? WHERE messageId = ?`,
        [clientId, messageId]
      );

      return res.status(200).json({
        success: true,
        correlationId,
        clientId,
        intent,
        handoffToHuman,
        response,
      });
    } finally {
      await conn.end();
    }
  } catch (error) {
    console.error('[Inbound] Erro ao processar mensagem:', error);
    return res.status(500).json({ 
      error: 'Erro ao processar mensagem',
      details: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

/**
 * GET /api/whatsapp/inbound/conversations
 * Lista conversas recentes (read-only para dashboard)
 * Query params: ?limit=20&offset=0&phone=&intent=&handoff=
 */
router.get('/inbound/conversations', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const phone = req.query.phone as string;
    const intent = req.query.intent as string;
    const handoff = req.query.handoff as string;

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    try {
      let query = `
        SELECT 
          aal.id,
          aal.fromPhone,
          aal.clientId,
          aal.intent,
          aal.response,
          aal.handoffToHuman,
          aal.handoffReason,
          aal.createdAt,
          c.name as clientName
        FROM ai_assistant_log aal
        LEFT JOIN clients c ON aal.clientId = c.id
        WHERE 1=1
      `;

      const params: any[] = [];

      if (phone) {
        query += ` AND aal.fromPhone LIKE ?`;
        params.push(`%${phone}%`);
      }

      if (intent) {
        query += ` AND aal.intent = ?`;
        params.push(intent);
      }

      if (handoff === 'true') {
        query += ` AND aal.handoffToHuman = true`;
      } else if (handoff === 'false') {
        query += ` AND aal.handoffToHuman = false`;
      }

      const safeLimit = Number.isFinite(limit) ? limit : 20;
      const safeOffset = Number.isFinite(offset) ? offset : 0;
      query += ` ORDER BY aal.createdAt DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

      const [rows] = await conn.execute(query, params);

      return res.status(200).json({
        success: true,
        data: rows,
        limit,
        offset,
      });
    } finally {
      await conn.end();
    }
  } catch (error) {
    console.error('[Inbound] Erro ao listar conversas:', error);
    return res.status(500).json({ 
      error: 'Erro ao listar conversas',
      details: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

/**
 * GET /api/whatsapp/inbound/stats
 * Estatísticas de interações do assistente IA
 */
router.get('/inbound/stats', async (req: Request, res: Response) => {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    try {
      const [stats] = await conn.execute(`
        SELECT 
          COUNT(*) as totalInteractions,
          SUM(CASE WHEN handoffToHuman = true THEN 1 ELSE 0 END) as handoffCount,
          COUNT(DISTINCT fromPhone) as uniquePhones,
          COUNT(DISTINCT clientId) as uniqueClients
        FROM ai_assistant_log
        WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `) as any;

      const [intentBreakdown] = await conn.execute(`
        SELECT 
          intent,
          COUNT(*) as count
        FROM ai_assistant_log
        WHERE createdAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY intent
      `) as any;

      return res.status(200).json({
        success: true,
        stats: (stats as any[])[0],
        intentBreakdown,
      });
    } finally {
      await conn.end();
    }
  } catch (error) {
    console.error('[Inbound] Erro ao obter estatísticas:', error);
    return res.status(500).json({ 
      error: 'Erro ao obter estatísticas',
      details: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

/**
 * GET /api/whatsapp/inbound/debug?phone=+5527981657804
 * Endpoint de debug para verificar pipeline completo de um telefone
 * Retorna: lastWebhookId, inbound_messages (last 5), ai_assistant_log (last 5) com sendResult
 */
router.get('/inbound/debug', async (req: Request, res: Response) => {
  try {
    const phone = (req.query.phone as string) || '';
    if (!phone) {
      return res.status(400).json({ error: 'Parâmetro phone é obrigatório (ex: ?phone=+5527981657804)' });
    }

    // Normalizar para busca: remover + e buscar com LIKE
    const phoneDigits = phone.replace(/\D/g, '');
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    try {
      // 1. Último webhook com este telefone
      const [webhooks] = await conn.execute(
        `SELECT id, provider, path, bodyJson, responseJson, processingTimeMs, createdAt 
         FROM webhook_raw_log 
         WHERE bodyJson LIKE ? 
         ORDER BY createdAt DESC LIMIT 5`,
        [`%${phoneDigits}%`]
      ) as any[];

      const parsedWebhooks = webhooks.map((w: any) => {
        let body = null;
        let response = null;
        try { body = JSON.parse(w.bodyJson); } catch {}
        try { response = JSON.parse(w.responseJson); } catch {}
        return {
          id: w.id,
          createdAt: w.createdAt,
          path: w.path,
          processingTimeMs: w.processingTimeMs,
          body,
          response,
        };
      });

      // 2. Inbound messages deste telefone
      const [inboundMsgs] = await conn.execute(
        `SELECT id, fromPhone, text, messageId, processed, clientId, createdAt 
         FROM inbound_messages 
         WHERE fromPhone LIKE ? 
         ORDER BY createdAt DESC LIMIT 5`,
        [`%${phoneDigits}%`]
      ) as any[];

      // 3. AI assistant log deste telefone
      const [aiLogs] = await conn.execute(
        `SELECT id, fromPhone, clientId, intent, dbQueryMeta, response, 
                correlationId, handoffToHuman, handoffReason, createdAt 
         FROM ai_assistant_log 
         WHERE fromPhone LIKE ? 
         ORDER BY createdAt DESC LIMIT 5`,
        [`%${phoneDigits}%`]
      ) as any[];

      const parsedAiLogs = aiLogs.map((log: any) => {
        let dbQueryMeta = null;
        try { dbQueryMeta = JSON.parse(log.dbQueryMeta); } catch { dbQueryMeta = log.dbQueryMeta; }
        return {
          ...log,
          dbQueryMeta,
        };
      });

      // 4. Verificar feature flags
      const { FEATURE_FLAGS, isPhoneWhitelisted } = require('../_core/featureFlags');
      const normalizedPhone = '+' + phoneDigits;

      return res.status(200).json({
        phone,
        phoneDigits,
        normalizedPhone,
        featureFlags: {
          INBOUND_AI_ENABLED: FEATURE_FLAGS.INBOUND_AI_ENABLED,
          isWhitelisted: isPhoneWhitelisted(normalizedPhone),
          whitelist: process.env.WHATSAPP_AI_WHITELIST || '(não definido)',
        },
        lastWebhookId: parsedWebhooks.length > 0 ? parsedWebhooks[0].id : null,
        webhooks: {
          count: parsedWebhooks.length,
          data: parsedWebhooks,
        },
        inboundMessages: {
          count: inboundMsgs.length,
          data: inboundMsgs,
        },
        aiAssistantLog: {
          count: parsedAiLogs.length,
          data: parsedAiLogs,
        },
        pipeline: {
          webhookReceived: parsedWebhooks.length > 0,
          inboundSaved: inboundMsgs.length > 0,
          aiProcessed: parsedAiLogs.length > 0,
          lastAiDecision: parsedAiLogs.length > 0 ? {
            intent: parsedAiLogs[0].intent,
            handoff: parsedAiLogs[0].handoffToHuman,
            sendResult: parsedAiLogs[0].dbQueryMeta?.sendResult || null,
            correlationId: parsedAiLogs[0].correlationId,
          } : null,
        },
      });
    } finally {
      await conn.end();
    }
  } catch (error) {
    console.error('[Inbound] Erro no debug:', error);
    return res.status(500).json({
      error: 'Erro no debug',
      details: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

export default router;
