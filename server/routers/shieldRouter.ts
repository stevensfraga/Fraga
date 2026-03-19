/**
 * Shield Router — Validação pós-deploy do Collection Shield
 *
 * 3 endpoints read-only para checagem rápida:
 *   1. GET /api/shield/health
 *   2. GET /api/shield/preflight
 *   3. GET /api/shield/verify-realtime
 */

import { Router, Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { validateReceivableEconomic, getCacheStats } from '../services/realtimeValidationEconomicService';

const router = Router();

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface ShieldHealthResponse {
  ok: boolean;
  requestId: string;
  timestamp: string;
  timezone: string;
  buildVersion?: string;
  serverTime: number;
  database: {
    ok: boolean;
    latencyMs?: number;
  };
  cron: {
    enabled: boolean;
    nextRuns: Array<{ job: string; cronExpression: string; timezone: string }>;
  };
  flags: {
    KILL_SWITCH: boolean;
    ALLOW_REAL_SEND: boolean;
    REGUA_ENABLED: boolean;
    REGUA_DAILY_LIMIT: number;
  };
}

interface PreflightCandidate {
  clientId: number;
  name: string;
  totalDebt: number;
  titlesCount: number;
  stage: string;
  reasonEligible: string;
  riskLevel: string;
}

interface PreflightBlocked {
  clientId: number;
  name: string;
  totalDebt: number;
  titlesCount: number;
  stage: string;
  blockReason: string;       // NEGOTIATION_BLOCK, NO_WHATSAPP, ABORT_TERMINAL, ABORT_NOT_OVERDUE, FALLBACK_MEDIUM
  decision: string;          // decisão da validação realtime
  dbStatus: string;
  caStatus?: string;
  riskLevel: string;
}

interface PreflightResponse {
  ok: boolean;
  requestId: string;
  timestamp: string;
  bucket: string;
  dryRun: boolean;
  eligible: PreflightCandidate[];
  blocked: PreflightBlocked[];
  stats: {
    totalEligible: number;
    totalBlocked: number;
    estimatedSend: number;
    byDecision: Record<string, number>;
    byCaStatus: Record<string, number>;
    byDbStatus: Record<string, number>;
  };
}

interface VerifyRealtimeResponse {
  ok: boolean;
  requestId: string;
  timestamp: string;
  receivableId?: number;
  contaAzulId?: string;
  dbStatus: string;
  caStatus?: string;
  cached: boolean;
  lastSyncedAt?: string;
  decision: 'ALLOW_SEND' | 'ABORT_TERMINAL' | 'ABORT_NEGOTIATED' | 'FALLBACK_MEDIUM' | 'ERROR';
  reason: string;
  riskLevel: string;
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────

function generateRequestId(): string {
  return `shield-${Date.now()}-${uuidv4().substring(0, 8)}`;
}

// Rate limit simples (em memória)
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(ip: string, limit: number = 30, windowMs: number = 60000): boolean {
  const now = Date.now();
  const key = `rl-${ip}`;

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, [now]);
    return true;
  }

  const timestamps = rateLimitMap.get(key)!;
  const recentTimestamps = timestamps.filter(t => now - t < windowMs);

  if (recentTimestamps.length >= limit) {
    return false;
  }

  recentTimestamps.push(now);
  rateLimitMap.set(key, recentTimestamps);
  return true;
}

// ─── ENDPOINT 1: GET /api/shield/health ──────────────────────────────────────

router.get('/health', async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  const ip = req.ip || 'unknown';

  if (!checkRateLimit(ip, 30, 60000)) {
    return res.status(429).json({
      ok: false,
      requestId,
      error: 'Rate limit exceeded (30/min)',
    });
  }

  try {
    const timestamp = new Date().toISOString();
    const timezone = 'America/Sao_Paulo'; // SP = UTC-3
    const serverTime = Date.now();

    // ── Verificar DB ──
    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      const startTime = Date.now();
      await conn.execute('SELECT 1');
      dbLatencyMs = Date.now() - startTime;
      dbOk = true;
      await conn.end();
    } catch (error) {
      console.error(`[Shield] DB ping failed: ${error}`);
    }

    // ── Flags ──
    const flags = {
      KILL_SWITCH: process.env.KILL_SWITCH === 'true',
      ALLOW_REAL_SEND: process.env.ALLOW_REAL_SEND === 'true',
      REGUA_ENABLED: process.env.REGUA_ENABLED === 'true',
      REGUA_DAILY_LIMIT: parseInt(process.env.REGUA_DAILY_LIMIT || '500', 10),
    };

    // ── Próximas execuções (hardcoded para SP) ──
    const nextRuns = [
      { job: 'recon-lite', cronExpression: '0 50 6 * * 1-5', timezone },
      { job: 'recon-full', cronExpression: '0 10 7 * * 1-5', timezone },
      { job: 'collection-run', cronExpression: '0 30 7 * * 1-5', timezone },
    ];

    const response: ShieldHealthResponse = {
      ok: dbOk,
      requestId,
      timestamp,
      timezone,
      buildVersion: process.env.BUILD_VERSION || 'unknown',
      serverTime,
      database: {
        ok: dbOk,
        latencyMs: dbOk ? dbLatencyMs : undefined,
      },
      cron: {
        enabled: flags.REGUA_ENABLED,
        nextRuns,
      },
      flags,
    };

    res.json(response);
  } catch (error: any) {
    console.error(`[Shield] Health check error: ${error.message}`);
    res.status(500).json({
      ok: false,
      requestId,
      error: error.message,
    });
  }
});

// ─── ENDPOINT 2: GET /api/shield/preflight ───────────────────────────────────

router.get('/preflight', async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  const ip = req.ip || 'unknown';

  if (!checkRateLimit(ip, 30, 60000)) {
    return res.status(429).json({
      ok: false,
      requestId,
      error: 'Rate limit exceeded (30/min)',
    });
  }

  try {
    const bucket = (req.query.bucket as string) || 'all'; // D, D+15, D+30, etc
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const dryRun = req.query.dryRun === 'true';

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    // ── Query de elegíveis (mesmo da régua) ──
    const limitValue = Math.min(limit * 2, 1000);
    const [rows] = await conn.execute(
      `SELECT 
         r.id AS receivableId,
         r.clientId,
         r.contaAzulId,
         r.amount,
         r.dueDate,
         r.status,
         r.paymentInfoUpdatedAt,
         c.name AS clientName,
         c.whatsappNumber,
         c.negotiatedUntil,
         DATEDIFF(CURDATE(), DATE(r.dueDate)) AS daysOverdue
       FROM receivables r
       INNER JOIN clients c ON c.id = r.clientId
       WHERE r.status IN ('pending', 'overdue')
         AND r.status NOT IN ('paid', 'cancelled', 'renegotiated')
         AND CAST(r.amount AS DECIMAL(12,2)) > 0
         AND c.whatsappNumber IS NOT NULL
         AND c.whatsappNumber != ''
         AND c.optOut = 0
       ORDER BY CAST(r.amount AS DECIMAL(12,2)) DESC
       LIMIT ${limitValue}`
    );

    const eligible: PreflightCandidate[] = [];
    const blocked: PreflightBlocked[] = [];
    const byDecision: Record<string, number> = {};
    const byCaStatus: Record<string, number> = {};
    const byDbStatus: Record<string, number> = {};

    const incr = (map: Record<string, number>, key: string) => { map[key] = (map[key] || 0) + 1; };

    for (const row of rows as any[]) {
      const daysOverdue = Number(row.daysOverdue);
      const amount = parseFloat(row.amount) || 0;
      const negotiatedUntil = row.negotiatedUntil ? new Date(row.negotiatedUntil) : null;
      const dbStatus = row.status as string;

      incr(byDbStatus, dbStatus);

      // Determinar estágio
      let stage = 'unknown';
      if (daysOverdue < 0) stage = 'd_0';
      else if (daysOverdue <= 7) stage = 'd_plus_7';
      else if (daysOverdue <= 15) stage = 'd_plus_15';
      else if (daysOverdue <= 30) stage = 'd_plus_30';
      else if (daysOverdue <= 45) stage = 'd_plus_45';
      else if (daysOverdue <= 60) stage = 'd_plus_60';
      else if (daysOverdue <= 90) stage = 'd_plus_90';
      else if (daysOverdue <= 180) stage = 'd_plus_180';
      else stage = 'd_plus_365';

      // Filtrar por bucket se especificado
      if (bucket !== 'all' && stage !== bucket) continue;

      // ── Bloqueio 1: Negociação ──
      if (negotiatedUntil && negotiatedUntil >= new Date()) {
        incr(byDecision, 'NEGOTIATION_BLOCK');
        blocked.push({
          clientId: row.clientId,
          name: row.clientName,
          totalDebt: amount,
          titlesCount: 1,
          stage,
          blockReason: 'NEGOTIATION_BLOCK',
          decision: 'NEGOTIATION_BLOCK',
          dbStatus,
          riskLevel: 'LOW',
        });
        continue;
      }

      // ── Bloqueio 2: Sem WhatsApp ──
      if (!row.whatsappNumber) {
        incr(byDecision, 'NO_WHATSAPP');
        blocked.push({
          clientId: row.clientId,
          name: row.clientName,
          totalDebt: amount,
          titlesCount: 1,
          stage,
          blockReason: 'NO_WHATSAPP',
          decision: 'NO_WHATSAPP',
          dbStatus,
          riskLevel: 'LOW',
        });
        continue;
      }

      // ── Validação Realtime (CA) ──
      // Consultar CA apenas para títulos que passaram nos filtros locais
      let realtimeDecision: string = 'ALLOW_SEND';
      let caStatus: string | undefined;
      let riskLevel = amount >= 500 ? 'LOW' : 'MEDIUM';

      try {
        const validation = await validateReceivableEconomic(
          row.receivableId,
          row.clientId,
          row.contaAzulId || '',
          amount,
          stage,
          row.paymentInfoUpdatedAt ? new Date(row.paymentInfoUpdatedAt) : null
        );
        realtimeDecision = validation.decision || (validation.isValid ? 'ALLOW_SEND' : 'ABORT_TERMINAL');
        caStatus = validation.caStatus;
        riskLevel = validation.riskLevel;
        if (caStatus) incr(byCaStatus, caStatus);
      } catch (e: any) {
        // Erro na consulta CA: usar fallback
        realtimeDecision = 'FALLBACK_MEDIUM';
        riskLevel = 'MEDIUM';
      }

      incr(byDecision, realtimeDecision);

      // ── Decisão final ──
      if (realtimeDecision === 'ALLOW_SEND' || realtimeDecision === 'FALLBACK_MEDIUM') {
        eligible.push({
          clientId: row.clientId,
          name: row.clientName,
          totalDebt: amount,
          titlesCount: 1,
          stage,
          reasonEligible: caStatus
            ? `CA confirma ${caStatus}, ${daysOverdue} dias de atraso`
            : `DB status ${dbStatus}, ${daysOverdue} dias de atraso (sem consulta CA)`,
          riskLevel,
        });
        if (eligible.length >= limit) break;
      } else {
        // ABORT_TERMINAL, ABORT_NOT_OVERDUE
        blocked.push({
          clientId: row.clientId,
          name: row.clientName,
          totalDebt: amount,
          titlesCount: 1,
          stage,
          blockReason: realtimeDecision,
          decision: realtimeDecision,
          dbStatus,
          caStatus,
          riskLevel,
        });
      }
    }

    await conn.end();

    const response: PreflightResponse = {
      ok: true,
      requestId,
      timestamp: new Date().toISOString(),
      bucket,
      dryRun,
      eligible,
      blocked,
      stats: {
        totalEligible: eligible.length,
        totalBlocked: blocked.length,
        estimatedSend: dryRun ? 0 : eligible.length,
        byDecision,
        byCaStatus,
        byDbStatus,
      },
    };

    res.json(response);
  } catch (error: any) {
    console.error(`[Shield] Preflight error: ${error.message}`);
    res.status(500).json({
      ok: false,
      requestId,
      error: error.message,
    });
  }
});

// ─── ENDPOINT 3: GET /api/shield/verify-realtime ──────────────────────────────

router.get('/verify-realtime', async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  const ip = req.ip || 'unknown';

  if (!checkRateLimit(ip, 30, 60000)) {
    return res.status(429).json({
      ok: false,
      requestId,
      error: 'Rate limit exceeded (30/min)',
    });
  }

  try {
    const receivableId = req.query.receivableId ? parseInt(req.query.receivableId as string) : undefined;
    const contaAzulId = req.query.contaAzulId as string;

    if (!receivableId && !contaAzulId) {
      return res.status(400).json({
        ok: false,
        requestId,
        error: 'Forneça receivableId ou contaAzulId',
      });
    }

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    // ── Buscar receivable ──
    let query = `SELECT r.id, r.clientId, r.amount, r.status, r.contaAzulId, r.dueDate, r.paymentInfoUpdatedAt
                 FROM receivables r`;
    let params: any[] = [];

    if (receivableId) {
      query += ` WHERE r.id = ?`;
      params = [receivableId];
    } else {
      query += ` WHERE r.contaAzulId = ?`;
      params = [contaAzulId];
    }

    const [rows] = await conn.execute(query, params);

    if (!rows || (rows as any[]).length === 0) {
      await conn.end();
      return res.status(404).json({
        ok: false,
        requestId,
        error: 'Receivable não encontrado',
      });
    }

    const receivable = (rows as any[])[0];
    const rId = receivable.id;
    const cId = receivable.clientId;
    const caId = receivable.contaAzulId;
    const amount = parseFloat(receivable.amount) || 0;
    const dbStatus = receivable.status;
    const lastSyncedAt = receivable.paymentInfoUpdatedAt ? new Date(receivable.paymentInfoUpdatedAt) : null;

    // ── Validação econômica ──
    const validationResult = await validateReceivableEconomic(
      rId,
      cId,
      caId,
      amount,
      'd_plus_15', // Estágio padrão para verificação
      lastSyncedAt
    );

    await conn.end();

    // ── Mapear decision ──
    let decision: 'ALLOW_SEND' | 'ABORT_TERMINAL' | 'ABORT_NEGOTIATED' | 'FALLBACK_MEDIUM' | 'ERROR' = 'ERROR';
    if (validationResult.isValid) {
      if (validationResult.riskLevel === 'MEDIUM') {
        decision = 'FALLBACK_MEDIUM';
      } else {
        decision = 'ALLOW_SEND';
      }
    } else {
      if (validationResult.reason.includes('negociação')) {
        decision = 'ABORT_NEGOTIATED';
      } else {
        decision = 'ABORT_TERMINAL';
      }
    }

    const response: VerifyRealtimeResponse = {
      ok: true,
      requestId,
      timestamp: new Date().toISOString(),
      receivableId: rId,
      contaAzulId: caId,
      dbStatus,
      caStatus: validationResult.caStatus,
      cached: validationResult.usedCache,
      lastSyncedAt: lastSyncedAt?.toISOString(),
      decision,
      reason: validationResult.reason,
      riskLevel: validationResult.riskLevel,
    };

    res.json(response);
  } catch (error: any) {
    console.error(`[Shield] Verify realtime error: ${error.message}`);
    res.status(500).json({
      ok: false,
      requestId,
      error: error.message,
    });
  }
});

// ─── 4. POST /api/shield/dedup-override ─────────────────────────────────────
/**
 * Override controlado de dedup para um receivableId + stage específico.
 * Não deleta registros de auditoria — apenas marca como 'overridden' para
 * que o dedup ignore na próxima execução da régua.
 *
 * Requer header: X-Admin-Key: <FRAGA_ADMIN_KEY>
 *
 * Body: { receivableId: number, stage: string, reason: string }
 * Resposta: { ok, requestId, overriddenCount, message }
 */
router.post('/dedup-override', async (req: Request, res: Response) => {
  const requestId = uuidv4();
  const adminKey = req.headers['x-admin-key'];

  // Validar chave admin
  if (!adminKey || adminKey !== process.env.FRAGA_ADMIN_KEY) {
    return res.status(403).json({
      ok: false,
      requestId,
      error: 'Acesso negado. Cabeçalho X-Admin-Key inválido.',
    });
  }

  const { receivableId, stage, reason } = req.body || {};

  if (!receivableId || typeof receivableId !== 'number') {
    return res.status(400).json({
      ok: false,
      requestId,
      error: 'receivableId (number) é obrigatório.',
    });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({
      ok: false,
      requestId,
      error: 'reason (string, mín 5 chars) é obrigatório para auditoria.',
    });
  }

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // Verificar se o receivable existe
    const [recRows] = await conn.execute(
      'SELECT r.id, r.status, c.name FROM receivables r INNER JOIN clients c ON c.id = r.clientId WHERE r.id = ?',
      [receivableId]
    ) as any[];

    if (!recRows.length) {
      await conn.end();
      return res.status(404).json({
        ok: false,
        requestId,
        error: `receivableId ${receivableId} não encontrado.`,
      });
    }

    const rec = recRows[0];

    // Construir query de update
    // Marca registros de dedup como 'overridden' para que o checkDedup ignore
    // Preserva auditoria completa — nenhum registro é deletado
    let query = `UPDATE regua_audit SET status = 'overridden', skipReason = CONCAT('OVERRIDE: ', ?) WHERE receivableId = ? AND status IN ('sent', 'dry_run')`;
    const params: any[] = [reason.trim(), receivableId];

    if (stage) {
      query += ' AND stage = ?';
      params.push(stage);
    }

    const [result] = await conn.execute(query, params) as any[];
    const overriddenCount = result.affectedRows || 0;

    // Registrar o override como novo registro de auditoria
    await conn.execute(
      `INSERT INTO regua_audit (runId, clientId, receivableId, stage, status, skipReason, createdAt)
       VALUES (?, ?, ?, ?, 'override_log', ?, NOW())`,
      [
        `override-${requestId}`,
        rec.id,
        receivableId,
        stage || 'ALL',
        `MANUAL_OVERRIDE by admin. Reason: ${reason.trim()}. Affected: ${overriddenCount} records.`,
      ]
    );

    await conn.end();

    console.log(`[Shield] 🔓 Dedup override: receivableId=${receivableId}, stage=${stage || 'ALL'}, affected=${overriddenCount}, reason=${reason}`);

    return res.json({
      ok: true,
      requestId,
      timestamp: new Date().toISOString(),
      receivableId,
      clientName: rec.name,
      receivableStatus: rec.status,
      stage: stage || 'ALL',
      overriddenCount,
      reason: reason.trim(),
      message: overriddenCount > 0
        ? `Dedup removido para ${overriddenCount} registro(s). Cliente poderá receber cobrança na próxima execução da régua.`
        : `Nenhum registro de dedup encontrado para receivableId=${receivableId}${stage ? ` stage=${stage}` : ''}. Cliente já está apto para cobrança.`,
    });
  } catch (error: any) {
    await conn.end().catch(() => {});
    console.error(`[Shield] Dedup override error: ${error.message}`);
    return res.status(500).json({
      ok: false,
      requestId,
      error: error.message,
    });
  }
});

export default router;
