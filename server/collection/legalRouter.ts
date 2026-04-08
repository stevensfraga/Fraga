/**
 * Módulo JURÍDICO — Read-Only + Controle de Casos
 * 
 * Endpoints:
 *   GET  /candidates          — Lista candidatos (sugestão automática, não cria nada)
 *   POST /cases/create        — Cria drafts manuais
 *   POST /cases/approve       — Stevens aprova drafts → approved
 *   POST /cases/mark-sent     — Marca approved → sent_to_legal
 *   POST /cases/close         — Marca → closed
 *   GET  /cases               — Lista todos os casos (com filtro de status)
 *   GET  /cases/export        — Export individual (XLSX + TXT por caseId)
 *   GET  /cases/export-batch  — Export em lote (XLSX + TXT por status)
 * 
 * Garantias:
 *   - Read-only nos dados de cobrança (só SELECT em receivables/audit)
 *   - legal_cases é a única tabela com INSERT/UPDATE
 *   - Protegido por x-admin-key
 *   - Não toca em cron, envio, templates ou eligibility
 */
import { Router, Request, Response } from 'express';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import archiver from 'archiver';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAdminKey(): string {
  return process.env.FRAGA_ADMIN_KEY || '';
}

function requireAdmin(req: Request, res: Response): boolean {
  const key = req.headers['x-admin-key'] as string;
  if (!key || key !== getAdminKey()) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'x-admin-key inválida ou ausente' });
    return false;
  }
  return true;
}

async function getConnection() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/** Converte UTC Date para string BRT (UTC-3) */
function toBRT(d: Date | string | null): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// ─── Shared query logic ─────────────────────────────────────────────────────

interface LegalFilters {
  bucket?: string;
  minDaysOverdue: number;
  minTotalDebt: number;
  minSentAttempts: number;
  lastSentOlderThanDays: number;
  limit: number;
  debug: boolean;
}

function parseFilters(query: Record<string, any>): LegalFilters {
  return {
    bucket: query.bucket as string | undefined,
    minDaysOverdue: parseInt(query.minDays as string || query.minDaysOverdue as string) || 60,
    minTotalDebt: parseFloat(query.minDebt as string || query.minTotalDebt as string) || 500,
    minSentAttempts: parseInt(query.minDispatch as string || query.minSentAttempts as string) || 2,
    lastSentOlderThanDays: parseInt(query.lastSentOlderThanDays as string) || 15,
    limit: parseInt(query.limit as string) || 100,
    debug: query.debug === '1' || query.debug === 'true',
  };
}

interface ClientCandidate {
  clientId: number;
  name: string;
  document: string;
  email: string;
  whatsapp: string;
  totalDebt: number;
  titlesCount: number;
  maxDaysOverdue: number;
  oldestDueDate: string;
  lastSentAt: string;
  sentAttempts: number;
  lastTemplateUsed: string;
  lastMessageId: string;
  lastCorrelationId: string;
  legalStage: 'LEGAL_RECOMMENDED' | 'PRE_LEGAL';
}

interface InteractionRow {
  clientId: number;
  auditId: number;
  receivableId: string;
  sentAt: string;
  status: string;
  templateUsed: string;
  whatsapp: string;
  messageId: string;
  correlationId: string;
  errorMessage: string;
}

interface TitleRow {
  clientId: number;
  receivableId: number;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  status: string;
  paymentLinkCanonical: string;
  dispatchCount: number;
  lastDispatchedAt: string;
}

type BlockReason = 'NO_DISPATCH' | 'LOW_DISPATCH' | 'RECENT_MESSAGE' | 'LOW_DAYS' | 'LOW_DEBT';

interface EnrichedCandidate extends ClientCandidate {
  daysSinceLastSent: number;
  blockReasons: BlockReason[];
}

async function buildCandidateData(filters: LegalFilters) {
  const conn = await getConnection();
  try {
    // 1) Buscar TODOS os clientes com pelo menos 1 receivable vencido >= 30 dias
    //    (mínimo absoluto para ser considerado, independente dos filtros)
    const minAbsoluteDays = Math.min(filters.minDaysOverdue, 30);
    const [clientRows]: any = await conn.execute(`
      SELECT 
        c.id AS clientId,
        c.name,
        COALESCE(c.document, '') AS document,
        COALESCE(c.email, '') AS email,
        COALESCE(c.whatsappNumber, '') AS whatsapp,
        ROUND(SUM(r.amount), 2) AS totalDebt,
        COUNT(r.id) AS titlesCount,
        MAX(DATEDIFF(NOW(), r.dueDate)) AS maxDaysOverdue,
        MIN(r.dueDate) AS oldestDueDate
      FROM clients c
      JOIN receivables r ON r.clientId = c.id
      WHERE r.status IN ('overdue', 'pending')
        AND DATEDIFF(NOW(), r.dueDate) >= ?
      GROUP BY c.id
      ORDER BY maxDaysOverdue DESC
      LIMIT 500
    `, [minAbsoluteDays]);

    if (clientRows.length === 0) {
      return { candidates: [], allClientsWithDebt: [], blockSummary: { NO_DISPATCH: 0, LOW_DISPATCH: 0, RECENT_MESSAGE: 0, LOW_DAYS: 0, LOW_DEBT: 0 } };
    }

    const clientIds = clientRows.map((r: any) => r.clientId);
    const placeholders = clientIds.map(() => '?').join(',');

    // 2) Tentativas de envio + última info
    const [attemptRows]: any = await conn.execute(`
      SELECT 
        clientId,
        COUNT(*) AS sentAttempts,
        MAX(sentAt) AS lastSentAt
      FROM whatsappAudit
      WHERE clientId IN (${placeholders})
        AND status = 'sent'
      GROUP BY clientId
    `, clientIds);

    const attemptMap = new Map<number, { sentAttempts: number; lastSentAt: Date | null }>();
    for (const row of attemptRows) {
      attemptMap.set(row.clientId, { sentAttempts: row.sentAttempts, lastSentAt: row.lastSentAt });
    }

    // 3) Último envio detalhado por cliente
    const [lastSentRows]: any = await conn.execute(`
      SELECT wa.clientId, wa.templateUsed, wa.messageId, wa.correlationId
      FROM whatsappAudit wa
      INNER JOIN (
        SELECT clientId, MAX(sentAt) AS maxSent
        FROM whatsappAudit
        WHERE clientId IN (${placeholders}) AND status = 'sent'
        GROUP BY clientId
      ) latest ON wa.clientId = latest.clientId AND wa.sentAt = latest.maxSent
      WHERE wa.status = 'sent'
    `, clientIds);

    const lastSentMap = new Map<number, { templateUsed: string; messageId: string; correlationId: string }>();
    for (const row of lastSentRows) {
      lastSentMap.set(row.clientId, {
        templateUsed: row.templateUsed || '',
        messageId: row.messageId || '',
        correlationId: row.correlationId || '',
      });
    }

    // 4) Classificar TODOS — sem filtrar por dispatch
    const now = new Date();
    const allEnriched: EnrichedCandidate[] = [];
    const blockSummary: Record<BlockReason, number> = {
      NO_DISPATCH: 0,
      LOW_DISPATCH: 0,
      RECENT_MESSAGE: 0,
      LOW_DAYS: 0,
      LOW_DEBT: 0,
    };

    for (const row of clientRows) {
      const attempts = attemptMap.get(row.clientId);
      const sentAttempts = attempts?.sentAttempts || 0;
      const lastSentAt = attempts?.lastSentAt || null;
      const lastSent = lastSentMap.get(row.clientId);
      const totalDebt = parseFloat(row.totalDebt);

      let daysSinceLastSent = 999;
      if (lastSentAt) {
        daysSinceLastSent = Math.floor((now.getTime() - new Date(lastSentAt).getTime()) / (1000 * 60 * 60 * 24));
      }

      // Determinar bloqueios
      const blockReasons: BlockReason[] = [];
      if (sentAttempts === 0) { blockReasons.push('NO_DISPATCH'); blockSummary.NO_DISPATCH++; }
      else if (sentAttempts < filters.minSentAttempts) { blockReasons.push('LOW_DISPATCH'); blockSummary.LOW_DISPATCH++; }
      if (daysSinceLastSent < filters.lastSentOlderThanDays && sentAttempts > 0) { blockReasons.push('RECENT_MESSAGE'); blockSummary.RECENT_MESSAGE++; }
      if (row.maxDaysOverdue < filters.minDaysOverdue) { blockReasons.push('LOW_DAYS'); blockSummary.LOW_DAYS++; }
      if (totalDebt < filters.minTotalDebt) { blockReasons.push('LOW_DEBT'); blockSummary.LOW_DEBT++; }

      const isLegalRecommended =
        row.maxDaysOverdue >= filters.minDaysOverdue &&
        sentAttempts >= filters.minSentAttempts &&
        daysSinceLastSent >= filters.lastSentOlderThanDays &&
        totalDebt >= filters.minTotalDebt;

      allEnriched.push({
        clientId: row.clientId,
        name: row.name,
        document: row.document,
        email: row.email,
        whatsapp: row.whatsapp,
        totalDebt,
        titlesCount: row.titlesCount,
        maxDaysOverdue: row.maxDaysOverdue,
        oldestDueDate: toBRT(row.oldestDueDate),
        lastSentAt: toBRT(lastSentAt),
        sentAttempts,
        lastTemplateUsed: lastSent?.templateUsed || '',
        lastMessageId: lastSent?.messageId || '',
        lastCorrelationId: lastSent?.correlationId || '',
        legalStage: isLegalRecommended ? 'LEGAL_RECOMMENDED' : 'PRE_LEGAL',
        daysSinceLastSent,
        blockReasons,
      });
    }

    // Candidatos elegíveis = sem bloqueios OU apenas RECENT_MESSAGE (PRE_LEGAL)
    const candidates = allEnriched.filter(c =>
      c.blockReasons.length === 0 ||
      (c.blockReasons.length === 1 && c.blockReasons[0] === 'RECENT_MESSAGE')
    );

    return { candidates, allClientsWithDebt: allEnriched, blockSummary };
  } finally {
    await conn.end();
  }
}

/** Busca dados completos de um ou mais clientes para export */
async function buildExportData(clientIds: number[]) {
  const conn = await getConnection();
  try {
    const placeholders = clientIds.map(() => '?').join(',');

    // Clientes
    const [clientRows]: any = await conn.execute(`
      SELECT 
        c.id AS clientId, c.name, COALESCE(c.document, '') AS document,
        COALESCE(c.email, '') AS email, COALESCE(c.whatsappNumber, '') AS whatsapp
      FROM clients c WHERE c.id IN (${placeholders})
    `, clientIds);

    // Títulos
    const [titleRows]: any = await conn.execute(`
      SELECT 
        r.clientId, r.id AS receivableId, r.amount, r.dueDate,
        DATEDIFF(NOW(), r.dueDate) AS daysOverdue, r.status,
        COALESCE(r.paymentLinkCanonical, '') AS paymentLinkCanonical
      FROM receivables r
      WHERE r.clientId IN (${placeholders}) AND r.status IN ('overdue', 'pending')
      ORDER BY r.clientId, r.dueDate ASC
    `, clientIds);

    // Dispatch count por receivable
    const [dispatchRows]: any = await conn.execute(`
      SELECT receivableId, COUNT(*) AS dispatchCount, MAX(sentAt) AS lastDispatchedAt
      FROM whatsappAudit
      WHERE clientId IN (${placeholders}) AND status = 'sent'
      GROUP BY receivableId
    `, clientIds);

    const dispatchMap = new Map<number, { count: number; lastAt: Date | null }>();
    for (const r of dispatchRows) {
      if (r.receivableId) dispatchMap.set(r.receivableId, { count: r.dispatchCount, lastAt: r.lastDispatchedAt });
    }

    // Interações (últimas 10 por cliente)
    const [auditRows]: any = await conn.execute(`
      SELECT 
        wa.clientId, wa.id AS auditId, COALESCE(wa.receivableId, '') AS receivableId,
        wa.sentAt, wa.status, COALESCE(wa.templateUsed, '') AS templateUsed,
        COALESCE(wa.phoneNumber, '') AS whatsapp, COALESCE(wa.messageId, '') AS messageId,
        COALESCE(wa.correlationId, '') AS correlationId, COALESCE(wa.errorMessage, '') AS errorMessage
      FROM whatsappAudit wa
      WHERE wa.clientId IN (${placeholders})
      ORDER BY wa.sentAt DESC
    `, clientIds);

    // Agrupar por cliente (max 10 por cliente)
    const auditByClient = new Map<number, any[]>();
    for (const row of auditRows) {
      const list = auditByClient.get(row.clientId) || [];
      if (list.length < 10) list.push(row);
      auditByClient.set(row.clientId, list);
    }

    // Somatórios por cliente
    const summaryByClient = new Map<number, { totalDebt: number; titlesCount: number; maxDaysOverdue: number; oldestDueDate: string }>();
    for (const cid of clientIds) {
      const clientTitles = titleRows.filter((t: any) => t.clientId === cid);
      summaryByClient.set(cid, {
        totalDebt: clientTitles.reduce((s: number, t: any) => s + parseFloat(t.amount), 0),
        titlesCount: clientTitles.length,
        maxDaysOverdue: Math.max(0, ...clientTitles.map((t: any) => t.daysOverdue)),
        oldestDueDate: clientTitles.length > 0 ? toBRT(clientTitles[0].dueDate) : '',
      });
    }

    // Tentativas por cliente
    const [attemptRows]: any = await conn.execute(`
      SELECT clientId, COUNT(*) AS sentAttempts, MAX(sentAt) AS lastSentAt
      FROM whatsappAudit WHERE clientId IN (${placeholders}) AND status = 'sent'
      GROUP BY clientId
    `, clientIds);
    const attemptMap = new Map<number, { sentAttempts: number; lastSentAt: string }>();
    for (const r of attemptRows) {
      attemptMap.set(r.clientId, { sentAttempts: r.sentAttempts, lastSentAt: toBRT(r.lastSentAt) });
    }

    return {
      clients: clientRows,
      titles: titleRows.map((t: any) => {
        const d = dispatchMap.get(t.receivableId);
        return {
          ...t,
          amount: parseFloat(t.amount),
          dueDate: toBRT(t.dueDate),
          dispatchCount: d?.count || 0,
          lastDispatchedAt: toBRT(d?.lastAt || null),
        };
      }),
      auditByClient,
      summaryByClient,
      attemptMap,
      dispatchMap,
    };
  } finally {
    await conn.end();
  }
}

// ─── TXT Generator ──────────────────────────────────────────────────────────

function generateTXT(
  client: any,
  summary: any,
  attempts: any,
  titles: TitleRow[],
  interactions: any[],
  legalCase: any,
): string {
  const lines: string[] = [];
  const sep = '='.repeat(80);
  const sep2 = '-'.repeat(60);

  lines.push(sep);
  lines.push('DOSSIÊ JURÍDICO — FRAGA CONTABILIDADE');
  lines.push(`Gerado em: ${toBRT(new Date())}`);
  lines.push(sep);
  lines.push('');

  // Cliente
  lines.push('1. DADOS DO CLIENTE');
  lines.push(sep2);
  lines.push(`Nome:       ${client.name}`);
  lines.push(`ClientId:   ${client.clientId}`);
  lines.push(`Documento:  ${client.document || 'N/A'}`);
  lines.push(`Email:      ${client.email || 'N/A'}`);
  lines.push(`WhatsApp:   ${client.whatsapp || 'N/A'}`);
  lines.push('');

  // Dívida
  lines.push('2. RESUMO DA DÍVIDA');
  lines.push(sep2);
  lines.push(`Dívida Total:     R$ ${summary.totalDebt.toFixed(2)}`);
  lines.push(`Qtd Títulos:      ${summary.titlesCount}`);
  lines.push(`Atraso Máximo:    ${summary.maxDaysOverdue} dias`);
  lines.push(`Vencimento + antigo: ${summary.oldestDueDate || 'N/A'}`);
  lines.push(`Tentativas envio: ${attempts?.sentAttempts || 0}`);
  lines.push(`Último envio:     ${attempts?.lastSentAt || 'N/A'}`);
  lines.push('');

  // Títulos
  lines.push('3. TÍTULOS EM ABERTO');
  lines.push(sep2);
  for (const t of titles) {
    lines.push(`  Recv#${t.receivableId} | R$ ${t.amount.toFixed(2)} | Venc: ${t.dueDate} | ${t.daysOverdue}d atraso | ${t.status}`);
    if (t.paymentLinkCanonical) lines.push(`    Link: ${t.paymentLinkCanonical}`);
  }
  if (titles.length === 0) lines.push('  (nenhum título encontrado)');
  lines.push('');

  // Interações
  lines.push('4. INTERAÇÕES / PROVAS DE COBRANÇA (últimas 10)');
  lines.push(sep2);
  for (const i of interactions) {
    lines.push(`  ${toBRT(i.sentAt)} | ${i.status} | Template: ${i.templateUsed}`);
    lines.push(`    WhatsApp: ${i.whatsapp} | MsgId: ${i.messageId}`);
    lines.push(`    CorrelationId: ${i.correlationId}`);
    if (i.errorMessage) lines.push(`    Erro: ${i.errorMessage}`);
    lines.push('');
  }
  if (interactions.length === 0) lines.push('  (nenhuma interação registrada)');
  lines.push('');

  // Caso jurídico
  if (legalCase) {
    lines.push('5. CASO JURÍDICO');
    lines.push(sep2);
    lines.push(`Case ID:    ${legalCase.id}`);
    lines.push(`Status:     ${legalCase.status}`);
    lines.push(`Aprovado por: ${legalCase.approvedBy || 'N/A'}`);
    lines.push(`Aprovado em:  ${toBRT(legalCase.approvedAt)}`);
    if (legalCase.notes) {
      lines.push(`Observações: ${legalCase.notes}`);
    }
    lines.push('');
  }

  // Critérios
  lines.push('6. CRITÉRIOS DE CLASSIFICAÇÃO');
  lines.push(sep2);
  lines.push(`  - Atraso máximo >= 90 dias: ${summary.maxDaysOverdue >= 90 ? 'SIM' : 'NÃO'} (${summary.maxDaysOverdue}d)`);
  lines.push(`  - Tentativas >= 2: ${(attempts?.sentAttempts || 0) >= 2 ? 'SIM' : 'NÃO'} (${attempts?.sentAttempts || 0})`);
  lines.push(`  - Dívida >= R$ 500: ${summary.totalDebt >= 500 ? 'SIM' : 'NÃO'} (R$ ${summary.totalDebt.toFixed(2)})`);
  lines.push('');
  lines.push(sep);
  lines.push('FIM DO DOSSIÊ');
  lines.push(sep);

  return lines.join('\n');
}

// ─── XLSX Generator ─────────────────────────────────────────────────────────

function buildWorkbook(
  clients: any[],
  allTitles: TitleRow[],
  allInteractions: InteractionRow[],
  summaryByClient: Map<number, any>,
  attemptMap: Map<number, any>,
  legalCases: Map<number, any>,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Fraga Contabilidade - Módulo Jurídico';
  workbook.created = new Date();

  const headerStyle = (cell: ExcelJS.Cell, color: string) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.alignment = { horizontal: 'center' };
  };

  // ── Aba 1: Resumo ──────────────────────────────────────────────────────
  const wsResumo = workbook.addWorksheet('Resumo');
  wsResumo.columns = [
    { header: 'clientId', key: 'clientId', width: 10 },
    { header: 'Nome', key: 'name', width: 40 },
    { header: 'Documento', key: 'document', width: 20 },
    { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    { header: 'Dívida Total (R$)', key: 'totalDebt', width: 18 },
    { header: 'Qtd Títulos', key: 'titlesCount', width: 12 },
    { header: 'Venc. + Antigo', key: 'oldestDueDate', width: 22 },
    { header: 'Dias Atraso Máx', key: 'maxDaysOverdue', width: 16 },
    { header: 'Último Envio', key: 'lastSentAt', width: 22 },
    { header: 'Template Usado', key: 'lastTemplateUsed', width: 25 },
    { header: 'Status Caso', key: 'statusLegalCase', width: 18 },
  ];
  wsResumo.getRow(1).eachCell(cell => headerStyle(cell, 'FF1F4E79'));

  for (const c of clients) {
    const s = summaryByClient.get(c.clientId);
    const a = attemptMap.get(c.clientId);
    const lc = legalCases.get(c.clientId);
    wsResumo.addRow({
      clientId: c.clientId,
      name: c.name,
      document: c.document,
      whatsapp: c.whatsapp,
      totalDebt: s?.totalDebt || 0,
      titlesCount: s?.titlesCount || 0,
      oldestDueDate: s?.oldestDueDate || '',
      maxDaysOverdue: s?.maxDaysOverdue || 0,
      lastSentAt: a?.lastSentAt || '',
      lastTemplateUsed: '',
      statusLegalCase: lc?.status || 'N/A',
    });
  }
  wsResumo.autoFilter = { from: 'A1', to: 'K1' };

  // ── Aba 2: Titulos ─────────────────────────────────────────────────────
  const wsTitulos = workbook.addWorksheet('Titulos');
  wsTitulos.columns = [
    { header: 'clientId', key: 'clientId', width: 10 },
    { header: 'receivableId', key: 'receivableId', width: 12 },
    { header: 'Valor (R$)', key: 'amount', width: 14 },
    { header: 'Vencimento', key: 'dueDate', width: 22 },
    { header: 'Dias Atraso', key: 'daysOverdue', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Link Pagamento', key: 'paymentLinkCanonical', width: 50 },
    { header: 'Envios', key: 'dispatchCount', width: 10 },
    { header: 'Último Envio', key: 'lastDispatchedAt', width: 22 },
  ];
  wsTitulos.getRow(1).eachCell(cell => headerStyle(cell, 'FF2E7BA6'));
  for (const t of allTitles) { wsTitulos.addRow(t); }
  wsTitulos.autoFilter = { from: 'A1', to: 'I1' };

  // ── Aba 3: Interacoes ──────────────────────────────────────────────────
  const wsInter = workbook.addWorksheet('Interacoes');
  wsInter.columns = [
    { header: 'clientId', key: 'clientId', width: 10 },
    { header: 'auditId', key: 'auditId', width: 10 },
    { header: 'receivableId', key: 'receivableId', width: 12 },
    { header: 'Enviado em (BRT)', key: 'sentAt', width: 22 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Template', key: 'templateUsed', width: 25 },
    { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    { header: 'messageId', key: 'messageId', width: 30 },
    { header: 'correlationId', key: 'correlationId', width: 40 },
    { header: 'Erro', key: 'errorMessage', width: 30 },
  ];
  wsInter.getRow(1).eachCell(cell => headerStyle(cell, 'FF3E9FD3'));
  for (const i of allInteractions) {
    wsInter.addRow({ ...i, sentAt: toBRT(i.sentAt) });
  }
  wsInter.autoFilter = { from: 'A1', to: 'J1' };

  return workbook;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /candidates ────────────────────────────────────────────────────────

router.get('/candidates', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const filters = parseFilters(req.query);
    const { candidates, allClientsWithDebt, blockSummary } = await buildCandidateData(filters);

    const legalRecommended = candidates.filter(c => c.legalStage === 'LEGAL_RECOMMENDED');
    const preLegal = candidates.filter(c => c.legalStage === 'PRE_LEGAL');

    const response: any = {
      success: true,
      filters,
      summary: {
        totalCandidates: candidates.length,
        legalRecommended: legalRecommended.length,
        preLegal: preLegal.length,
        totalDebt: Math.round(candidates.reduce((s, c) => s + c.totalDebt, 0) * 100) / 100,
        totalTitles: candidates.reduce((s, c) => s + c.titlesCount, 0),
      },
      blockSummary: {
        totalWithDebt: allClientsWithDebt.length,
        totalBlocked: allClientsWithDebt.length - candidates.length,
        reasons: blockSummary,
      },
      candidates: candidates.map(c => ({
        ...c,
        reasonFlags: buildReasons(c, filters),
      })),
    };

    // Debug mode: inclui top 10 bloqueados com motivos
    if (filters.debug) {
      const blocked = allClientsWithDebt
        .filter(c => c.blockReasons.length > 0 && !(c.blockReasons.length === 1 && c.blockReasons[0] === 'RECENT_MESSAGE'))
        .sort((a, b) => b.totalDebt - a.totalDebt)
        .slice(0, 10);

      response.debug = {
        topBlockedClients: blocked.map(c => ({
          clientId: c.clientId,
          name: c.name,
          totalDebt: c.totalDebt,
          maxDaysOverdue: c.maxDaysOverdue,
          sentAttempts: c.sentAttempts,
          daysSinceLastSent: c.daysSinceLastSent,
          blockReasons: c.blockReasons,
        })),
        explanation: {
          NO_DISPATCH: 'Nenhuma cobrança enviada via WhatsApp',
          LOW_DISPATCH: `Menos de ${filters.minSentAttempts} cobranças enviadas`,
          RECENT_MESSAGE: `Última cobrança há menos de ${filters.lastSentOlderThanDays} dias`,
          LOW_DAYS: `Atraso máximo menor que ${filters.minDaysOverdue} dias`,
          LOW_DEBT: `Dívida total menor que R$ ${filters.minTotalDebt.toFixed(2)}`,
        },
      };
    }

    res.json(response);
  } catch (err: any) {
    console.error('[LEGAL] candidates error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

function buildReasons(c: EnrichedCandidate | ClientCandidate, f: LegalFilters): string[] {
  const reasons: string[] = [];
  if (c.maxDaysOverdue >= f.minDaysOverdue) reasons.push(`maxDaysOverdue=${c.maxDaysOverdue} >= ${f.minDaysOverdue}`);
  if (c.sentAttempts >= f.minSentAttempts) reasons.push(`sentAttempts=${c.sentAttempts} >= ${f.minSentAttempts}`);
  if (c.totalDebt >= f.minTotalDebt) reasons.push(`totalDebt=R$${c.totalDebt.toFixed(2)} >= R$${f.minTotalDebt.toFixed(2)}`);
  if (c.lastSentAt) reasons.push(`lastSentAt=${c.lastSentAt}`);
  return reasons;
}

// ─── GET /cases ─────────────────────────────────────────────────────────────

router.get('/cases', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const conn = await getConnection();
    try {
      const statusFilter = req.query.status as string;
      let query = `
        SELECT lc.*, c.name AS clientName, COALESCE(c.document, '') AS document,
               COALESCE(c.whatsappNumber, '') AS whatsapp
        FROM legal_cases lc
        JOIN clients c ON c.id = lc.clientId
      `;
      const params: any[] = [];
      if (statusFilter) {
        query += ' WHERE lc.status = ?';
        params.push(statusFilter);
      }
      query += ' ORDER BY lc.updatedAt DESC';

      const [rows]: any = await conn.execute(query, params);
      res.json({ success: true, cases: rows.map((r: any) => ({
        ...r,
        approvedAt: toBRT(r.approvedAt),
        sentToLegalAt: toBRT(r.sentToLegalAt),
        closedAt: toBRT(r.closedAt),
        createdAt: toBRT(r.createdAt),
        updatedAt: toBRT(r.updatedAt),
      })) });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases list error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

// ─── POST /cases/create ─────────────────────────────────────────────────────

router.post('/cases/create', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { clientIds, notes } = req.body || {};
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'clientIds[] obrigatório' });
    }

    const conn = await getConnection();
    try {
      const created: number[] = [];
      const skipped: { clientId: number; reason: string }[] = [];

      for (const clientId of clientIds) {
        // Verificar se já existe caso ativo
        const [existing]: any = await conn.execute(
          `SELECT id, status FROM legal_cases WHERE clientId = ? AND status IN ('draft', 'approved', 'sent_to_legal')`,
          [clientId]
        );
        if (existing.length > 0) {
          skipped.push({ clientId, reason: `Já existe caso ativo (id=${existing[0].id}, status=${existing[0].status})` });
          continue;
        }

        const [result]: any = await conn.execute(
          `INSERT INTO legal_cases (clientId, status, notes) VALUES (?, 'draft', ?)`,
          [clientId, notes || null]
        );
        created.push(result.insertId);
      }

      res.json({ success: true, created, skipped, totalCreated: created.length, totalSkipped: skipped.length });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases/create error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

// ─── POST /cases/approve ────────────────────────────────────────────────────

router.post('/cases/approve', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { caseIds, approvedBy } = req.body || {};
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'caseIds[] obrigatório' });
    }
    if (!approvedBy) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'approvedBy obrigatório' });
    }

    const conn = await getConnection();
    try {
      const approved: number[] = [];
      const skipped: { caseId: number; reason: string }[] = [];

      for (const caseId of caseIds) {
        const [rows]: any = await conn.execute(
          `SELECT id, status FROM legal_cases WHERE id = ?`, [caseId]
        );
        if (rows.length === 0) {
          skipped.push({ caseId, reason: 'Caso não encontrado' });
          continue;
        }
        if (rows[0].status !== 'draft') {
          skipped.push({ caseId, reason: `Status atual: ${rows[0].status} (só draft pode ser aprovado)` });
          continue;
        }

        await conn.execute(
          `UPDATE legal_cases SET status = 'approved', approvedBy = ?, approvedAt = NOW() WHERE id = ?`,
          [approvedBy, caseId]
        );
        approved.push(caseId);
      }

      res.json({ success: true, approved, skipped, totalApproved: approved.length, totalSkipped: skipped.length });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases/approve error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

// ─── POST /cases/mark-sent ──────────────────────────────────────────────────

router.post('/cases/mark-sent', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { caseIds } = req.body || {};
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'caseIds[] obrigatório' });
    }

    const conn = await getConnection();
    try {
      const marked: number[] = [];
      const skipped: { caseId: number; reason: string }[] = [];

      for (const caseId of caseIds) {
        const [rows]: any = await conn.execute(
          `SELECT id, status FROM legal_cases WHERE id = ?`, [caseId]
        );
        if (rows.length === 0) {
          skipped.push({ caseId, reason: 'Caso não encontrado' });
          continue;
        }
        if (rows[0].status !== 'approved') {
          skipped.push({ caseId, reason: `Status atual: ${rows[0].status} (só approved pode ser marcado)` });
          continue;
        }

        await conn.execute(
          `UPDATE legal_cases SET status = 'sent_to_legal', sentToLegalAt = NOW() WHERE id = ?`,
          [caseId]
        );
        marked.push(caseId);
      }

      res.json({ success: true, marked, skipped, totalMarked: marked.length, totalSkipped: skipped.length });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases/mark-sent error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

// ─── POST /cases/close ──────────────────────────────────────────────────────

router.post('/cases/close', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { caseIds, notes } = req.body || {};
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'caseIds[] obrigatório' });
    }

    const conn = await getConnection();
    try {
      const closed: number[] = [];
      const skipped: { caseId: number; reason: string }[] = [];

      for (const caseId of caseIds) {
        const [rows]: any = await conn.execute(
          `SELECT id, status FROM legal_cases WHERE id = ?`, [caseId]
        );
        if (rows.length === 0) {
          skipped.push({ caseId, reason: 'Caso não encontrado' });
          continue;
        }
        if (rows[0].status === 'closed') {
          skipped.push({ caseId, reason: 'Já está fechado' });
          continue;
        }

        const notesUpdate = notes ? `, notes = CONCAT(COALESCE(notes, ''), '\n[FECHAMENTO] ', ?)` : '';
        const params = notes ? [caseId, notes] : [caseId];
        // Simplified: just update status and closedAt
        await conn.execute(
          `UPDATE legal_cases SET status = 'closed', closedAt = NOW() WHERE id = ?`,
          [caseId]
        );
        if (notes) {
          await conn.execute(
            `UPDATE legal_cases SET notes = CONCAT(COALESCE(notes, ''), '\n[FECHAMENTO] ', ?) WHERE id = ?`,
            [notes, caseId]
          );
        }
        closed.push(caseId);
      }

      res.json({ success: true, closed, skipped, totalClosed: closed.length, totalSkipped: skipped.length });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases/close error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

// ─── GET /cases/export ──────────────────────────────────────────────────────

router.get('/cases/export', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const caseId = parseInt(req.query.caseId as string);
    if (!caseId) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'caseId obrigatório' });
    }

    const conn = await getConnection();
    try {
      const [caseRows]: any = await conn.execute(
        `SELECT lc.*, c.name AS clientName FROM legal_cases lc JOIN clients c ON c.id = lc.clientId WHERE lc.id = ?`,
        [caseId]
      );
      if (caseRows.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Caso não encontrado' });
      }
      const legalCase = caseRows[0];
      if (!['approved', 'sent_to_legal'].includes(legalCase.status)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: `Export só permitido para status approved/sent_to_legal (atual: ${legalCase.status})` });
      }

      const clientId = legalCase.clientId;
      const data = await buildExportData([clientId]);
      const client = data.clients[0];
      const clientTitles = data.titles.filter((t: any) => t.clientId === clientId);
      const clientInteractions = data.auditByClient.get(clientId) || [];
      const summary = data.summaryByClient.get(clientId)!;
      const attempts = data.attemptMap.get(clientId);

      // Gerar ZIP com XLSX + TXT
      const safeName = client.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const filename = `case_${safeName}_${clientId}`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      // TXT
      const txt = generateTXT(client, summary, attempts, clientTitles, clientInteractions, legalCase);
      archive.append(txt, { name: `${filename}.txt` });

      // XLSX
      const legalCasesMap = new Map<number, any>();
      legalCasesMap.set(clientId, legalCase);
      const workbook = buildWorkbook(
        [client], clientTitles, clientInteractions,
        data.summaryByClient, data.attemptMap, legalCasesMap,
      );
      const xlsxBuffer = await workbook.xlsx.writeBuffer();
      archive.append(Buffer.from(xlsxBuffer), { name: `${filename}.xlsx` });

      await archive.finalize();
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases/export error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

// ─── GET /cases/export-batch ────────────────────────────────────────────────

router.get('/cases/export-batch', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const status = (req.query.status as string) || 'approved';
    const limit = parseInt(req.query.limit as string) || 50;

    const conn = await getConnection();
    try {
      const safeLimit = Math.min(Math.max(1, limit), 500);
      const [caseRows]: any = await conn.execute(
        `SELECT lc.*, c.name AS clientName FROM legal_cases lc JOIN clients c ON c.id = lc.clientId WHERE lc.status = ? ORDER BY lc.createdAt DESC LIMIT ${safeLimit}`,
        [status]
      );

      if (caseRows.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Nenhum caso com status '${status}' encontrado` });
      }

      const clientIds = caseRows.map((r: any) => r.clientId);
      const data = await buildExportData(clientIds);

      const legalCasesMap = new Map<number, any>();
      for (const c of caseRows) { legalCasesMap.set(c.clientId, c); }

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `juridico_batch_${dateStr}`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      // XLSX consolidado
      const allInteractions: InteractionRow[] = [];
      for (const [, list] of Array.from(data.auditByClient)) {
        allInteractions.push(...list);
      }
      const workbook = buildWorkbook(
        data.clients, data.titles, allInteractions,
        data.summaryByClient, data.attemptMap, legalCasesMap,
      );
      const xlsxBuffer = await workbook.xlsx.writeBuffer();
      archive.append(Buffer.from(xlsxBuffer), { name: `${filename}.xlsx` });

      // TXT consolidado
      const txtParts: string[] = [];
      for (const legalCase of caseRows) {
        const client = data.clients.find((c: any) => c.clientId === legalCase.clientId);
        if (!client) continue;
        const clientTitles = data.titles.filter((t: any) => t.clientId === legalCase.clientId);
        const clientInteractions = data.auditByClient.get(legalCase.clientId) || [];
        const summary = data.summaryByClient.get(legalCase.clientId)!;
        const attempts = data.attemptMap.get(legalCase.clientId);
        txtParts.push(generateTXT(client, summary, attempts, clientTitles, clientInteractions, legalCase));
        txtParts.push('\n\n');
      }
      archive.append(txtParts.join(''), { name: `${filename}.txt` });

      await archive.finalize();
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[LEGAL] cases/export-batch error:', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
  }
});

export default router;
