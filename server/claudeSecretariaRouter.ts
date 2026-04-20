/**
 * Router: Secretária Virtual — Painel Admin
 * Base: /api/claude-secretary
 */

import { Router, Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { getConversationStats, clearConversation, getSystemPrompt, QUEUE_MAP } from './services/claudeSecretariaService';
import { FEATURE_FLAGS } from './_core/featureFlags';

const router = Router();

// ─── STATUS ──────────────────────────────────────────────────────────────────

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const stats = getConversationStats();
    res.json({
      enabled: FEATURE_FLAGS.CLAUDE_SECRETARY_ENABLED,
      model: 'claude-haiku-4-5-20251001',
      ...stats,
      queues: QUEUE_MAP,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LOGS ─────────────────────────────────────────────────────────────────────

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const phone = req.query.phone as string | undefined;
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    let query = `
      SELECT 
        l.id,
        l.fromPhone,
        l.clientId,
        c.name as clientName,
        l.intent,
        l.dbQueryMeta,
        l.response,
        l.handoffToHuman,
        l.handoffReason,
        l.correlationId,
        l.createdAt
      FROM ai_assistant_log l
      LEFT JOIN clients c ON c.id = l.clientId
      WHERE JSON_EXTRACT(l.dbQueryMeta, '$.source') = 'claude_secretary'
    `;
    const params: any[] = [];

    if (phone) {
      query += ` AND l.fromPhone LIKE ?`;
      params.push(`%${phone}%`);
    }

    query += ` ORDER BY l.createdAt DESC LIMIT ${limit}`;

    const [rows] = await conn.execute(query, params);
    await conn.end();

    const parsed = (rows as any[]).map(row => {
      let meta: any = {};
      try { meta = typeof row.dbQueryMeta === 'string' ? JSON.parse(row.dbQueryMeta) : row.dbQueryMeta; } catch {}
      return {
        ...row,
        meta,
        dbQueryMeta: undefined,
      };
    });

    res.json({ count: parsed.length, data: parsed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    const [totalRows] = await conn.execute(`
      SELECT COUNT(*) as total
      FROM ai_assistant_log
      WHERE JSON_EXTRACT(dbQueryMeta, '$.source') = 'claude_secretary'
    `);

    const [todayRows] = await conn.execute(`
      SELECT COUNT(*) as today
      FROM ai_assistant_log
      WHERE JSON_EXTRACT(dbQueryMeta, '$.source') = 'claude_secretary'
      AND DATE(createdAt) = CURDATE()
    `);

    const [transferRows] = await conn.execute(`
      SELECT COUNT(*) as transfers
      FROM ai_assistant_log
      WHERE JSON_EXTRACT(dbQueryMeta, '$.source') = 'claude_secretary'
      AND handoffToHuman = 1
    `);

    const [queueBreakdown] = await conn.execute(`
      SELECT 
        handoffReason as queueName,
        COUNT(*) as count
      FROM ai_assistant_log
      WHERE JSON_EXTRACT(dbQueryMeta, '$.source') = 'claude_secretary'
      AND handoffToHuman = 1
      AND handoffReason IS NOT NULL
      GROUP BY handoffReason
      ORDER BY count DESC
    `);

    await conn.end();

    res.json({
      total: (totalRows as any[])[0]?.total || 0,
      today: (todayRows as any[])[0]?.today || 0,
      transfers: (transferRows as any[])[0]?.transfers || 0,
      queueBreakdown: queueBreakdown,
      liveConversations: getConversationStats(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RESET CONVERSA ───────────────────────────────────────────────────────────

router.post('/reset-conversation', (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'phone obrigatório' });
    return;
  }
  const cleared = clearConversation(phone);
  res.json({ cleared, phone });
});

// ─── PROMPT ──────────────────────────────────────────────────────────────────

router.get('/prompt', (_req: Request, res: Response) => {
  res.json({ prompt: getSystemPrompt() });
});

export default router;
