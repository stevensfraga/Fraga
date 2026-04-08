/**
 * eKontrol Integration Service
 * Sync empresas do eKontrol, buscar métricas mensais,
 * e motor de precificação de honorários.
 */
import { ENV } from "../_core/env";
import mysql from "mysql2/promise";

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

async function rawExec(sql: string, params: any[] = []): Promise<any> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [result] = await conn.execute(sql, params);
    return result;
  } finally {
    await conn.end();
  }
}

const EKONTROL_BASE = "https://app.e-kontroll.com.br/api/v1/metodo";

// ============================================================
// API Client
// ============================================================

interface EkontrolCompanyRaw {
  codi_emp: number;
  inscricao_federal: string;
  razao_social: string;
  status_empresa: string;
  ead_segmento?: string;
  cnae_principal: string | null;
  cnae_secundario: string | null;
  regime_tributario: string;
  honorarios: string | null;
  competencia_reajuste: string | null;
  array_honorarios: string;
  responsavel: string | null;
  email_responsavel: string | null;
  api_key_cliente: string | null;
  usafolha: number;
  usafiscal: number;
  usacontabil: number;
  data_cadastro: string;
  data_inatividade: string | null;
}

async function callEkontrol(method: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({
    api_key: ENV.ekontrolApiKey,
    ...params,
  });

  const res = await fetch(`${EKONTROL_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`eKontrol API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.status !== 200) {
    throw new Error(`eKontrol API returned status ${json.status}: ${json.message}`);
  }

  return json.dados?.data ?? [];
}

// ============================================================
// Sync Empresas
// ============================================================

export async function syncEkontrolCompanies(): Promise<{
  total: number;
  synced: number;
  matched: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // 1. Buscar empresas do eKontrol
  let companies: EkontrolCompanyRaw[];
  try {
    companies = await callEkontrol("listar_empresas", {
      api_key_empresa: ENV.ekontrolApiKeyEmpresa,
    });
  } catch (e: any) {
    return { total: 0, synced: 0, matched: 0, errors: [e.message] };
  }

  let synced = 0;
  let matched = 0;

  for (const c of companies) {
    try {
      // Limpar CNPJ (remover pontuação)
      const cnpjClean = (c.inscricao_federal || "").replace(/\D/g, "");
      if (!cnpjClean) continue;

      // Upsert na tabela ekontrol_companies
      await rawExec(
        `INSERT INTO ekontrol_companies 
         (codi_emp, inscricao_federal, razao_social, status_empresa, segmento,
          cnae_principal, cnae_secundario, regime_tributario, honorarios_atual,
          competencia_reajuste, array_honorarios, responsavel, email_responsavel,
          api_key_cliente, usafolha, usafiscal, usacontabil, last_sync_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           razao_social = VALUES(razao_social),
           status_empresa = VALUES(status_empresa),
           segmento = VALUES(segmento),
           cnae_principal = VALUES(cnae_principal),
           cnae_secundario = VALUES(cnae_secundario),
           regime_tributario = VALUES(regime_tributario),
           honorarios_atual = VALUES(honorarios_atual),
           competencia_reajuste = VALUES(competencia_reajuste),
           array_honorarios = VALUES(array_honorarios),
           responsavel = VALUES(responsavel),
           email_responsavel = VALUES(email_responsavel),
           api_key_cliente = VALUES(api_key_cliente),
           usafolha = VALUES(usafolha),
           usafiscal = VALUES(usafiscal),
           usacontabil = VALUES(usacontabil),
           last_sync_at = NOW()`,
        [
          c.codi_emp,
          cnpjClean,
          c.razao_social,
          c.status_empresa || "A",
          c.ead_segmento || null,
          c.cnae_principal,
          c.cnae_secundario,
          c.regime_tributario || "SEM INFORMAÇÃO",
          c.honorarios ? parseFloat(c.honorarios) : null,
          c.competencia_reajuste,
          c.array_honorarios || "[]",
          c.responsavel,
          c.email_responsavel,
          c.api_key_cliente,
          c.usafolha === 1,
          c.usafiscal === 1,
          c.usacontabil === 1,
        ]
      );
      synced++;
    } catch (e: any) {
      errors.push(`${c.razao_social}: ${e.message}`);
    }
  }

  // 2. Match com tabela clients (Conta Azul) via CNPJ
  try {
    const result = await rawExec(
      `UPDATE ekontrol_companies ek
       INNER JOIN clients c ON REPLACE(REPLACE(REPLACE(c.document, '.', ''), '/', ''), '-', '') = ek.inscricao_federal
       SET ek.client_id = c.id
       WHERE ek.client_id IS NULL`
    );
    matched = result.affectedRows || 0;
  } catch (e: any) {
    errors.push(`Match CNPJ: ${e.message}`);
  }

  return { total: companies.length, synced, matched, errors };
}

// ============================================================
// Motor de Precificação
// ============================================================

interface PricingConfig {
  base: Record<string, number>;
  perEmployee: Record<string, number>;
  revenueBrackets: Record<string, Array<{ max: number; add: number }>>;
  complexityBrackets: Array<{ maxScore: number; add: number }>;
  pisos: Record<string, number>;
  tetoManual: number;
}

const PRICING_CONFIG: PricingConfig = {
  base: {
    "SIMPLES NACIONAL": 450,
    "LUCRO PRESUMIDO": 900,
    "LUCRO REAL": 1500,
    "LUCRO REAL - SEM LALUR": 1500,
    "MEI": 150,
  },
  perEmployee: {
    "SIMPLES NACIONAL": 35,
    "LUCRO PRESUMIDO": 50,
    "LUCRO REAL": 70,
    "LUCRO REAL - SEM LALUR": 70,
    "MEI": 20,
  },
  revenueBrackets: {
    "SIMPLES NACIONAL": [
      { max: 50000, add: 0 },
      { max: 100000, add: 150 },
      { max: 200000, add: 300 },
      { max: 400000, add: 600 },
      { max: 800000, add: 1000 },
      { max: Infinity, add: 1500 },
    ],
    "LUCRO PRESUMIDO": [
      { max: 100000, add: 0 },
      { max: 300000, add: 400 },
      { max: 600000, add: 800 },
      { max: 1000000, add: 1300 },
      { max: Infinity, add: 2000 },
    ],
    "LUCRO REAL": [
      { max: 300000, add: 0 },
      { max: 800000, add: 1200 },
      { max: 2000000, add: 2500 },
      { max: Infinity, add: 4000 },
    ],
    "LUCRO REAL - SEM LALUR": [
      { max: 300000, add: 0 },
      { max: 800000, add: 1200 },
      { max: 2000000, add: 2500 },
      { max: Infinity, add: 4000 },
    ],
    "MEI": [
      { max: Infinity, add: 0 },
    ],
  },
  complexityBrackets: [
    { maxScore: 1, add: 0 },
    { maxScore: 3, add: 200 },
    { maxScore: 5, add: 400 },
    { maxScore: 7, add: 700 },
    { maxScore: 10, add: 1200 },
  ],
  pisos: {
    "SIMPLES NACIONAL": 450,
    "LUCRO PRESUMIDO": 900,
    "LUCRO REAL": 1500,
    "LUCRO REAL - SEM LALUR": 1500,
    "MEI": 150,
  },
  tetoManual: 15000,
};

function normalizeRegime(regime: string): string {
  const r = (regime || "").toUpperCase().trim();
  if (r.includes("SIMPLES")) return "SIMPLES NACIONAL";
  if (r.includes("PRESUMIDO")) return "LUCRO PRESUMIDO";
  if (r.includes("REAL") && r.includes("LALUR")) return "LUCRO REAL - SEM LALUR";
  if (r.includes("REAL")) return "LUCRO REAL";
  if (r.includes("MEI")) return "MEI";
  return "SIMPLES NACIONAL"; // default fallback
}

function getRevenueBracketAdd(regime: string, revenue: number): number {
  const brackets = PRICING_CONFIG.revenueBrackets[regime] || PRICING_CONFIG.revenueBrackets["SIMPLES NACIONAL"];
  for (const b of brackets) {
    if (revenue <= b.max) return b.add;
  }
  return brackets[brackets.length - 1].add;
}

function getComplexityAdd(score: number): number {
  for (const b of PRICING_CONFIG.complexityBrackets) {
    if (score <= b.maxScore) return b.add;
  }
  return PRICING_CONFIG.complexityBrackets[PRICING_CONFIG.complexityBrackets.length - 1].add;
}

function calculateComplexityScore(metrics: {
  notasEmitidas?: number;
  lancamentos?: number;
  usafolha?: boolean;
  usafiscal?: boolean;
  segmento?: string;
  cnaeSecundario?: string;
}): { score: number; details: Record<string, number> } {
  let score = 0;
  const details: Record<string, number> = {};

  // A) Volume de notas emitidas
  const notas = metrics.notasEmitidas || 0;
  if (notas > 400) { score += 4; details.notas = 4; }
  else if (notas > 150) { score += 3; details.notas = 3; }
  else if (notas > 50) { score += 2; details.notas = 2; }
  else if (notas > 10) { score += 1; details.notas = 1; }
  else { details.notas = 0; }

  // B) Movimentações/lançamentos
  const lanc = metrics.lancamentos || 0;
  if (lanc > 2000) { score += 3; details.lancamentos = 3; }
  else if (lanc > 800) { score += 2; details.lancamentos = 2; }
  else if (lanc > 300) { score += 1; details.lancamentos = 1; }
  else if (lanc > 100) { score += 1; details.lancamentos = 1; }
  else { details.lancamentos = 0; }

  // C) Módulos ativos (proxy para complexidade)
  let modScore = 0;
  if (metrics.usafolha) modScore++;
  if (metrics.usafiscal) modScore++;
  if (modScore >= 2) { score += 1; details.modulos = 1; }
  else { details.modulos = 0; }

  // D) CNAEs secundários (proxy para diversificação)
  const cnaes = (metrics.cnaeSecundario || "").split(",").filter(Boolean).length;
  if (cnaes > 3) { score += 1; details.cnaes = 1; }
  else { details.cnaes = 0; }

  return { score: Math.min(score, 10), details };
}

export interface PricingResult {
  feeSugerido: number;
  feeBase: number;
  feeFuncionarios: number;
  feeFaturamento: number;
  feeComplexidade: number;
  complexityScore: number;
  complexityDetails: Record<string, number>;
  isPrecificacaoManual: boolean;
  regime: string;
}

export function calculateFee(params: {
  regime: string;
  funcionarios: number;
  faturamentoMensal: number;
  notasEmitidas?: number;
  lancamentos?: number;
  usafolha?: boolean;
  usafiscal?: boolean;
  segmento?: string;
  cnaeSecundario?: string;
}): PricingResult {
  const regime = normalizeRegime(params.regime);

  // Base
  const feeBase = PRICING_CONFIG.base[regime] || 450;

  // Funcionários
  const perEmp = PRICING_CONFIG.perEmployee[regime] || 35;
  const feeFuncionarios = params.funcionarios * perEmp;

  // Faturamento
  const feeFaturamento = getRevenueBracketAdd(regime, params.faturamentoMensal);

  // Complexidade
  const { score, details } = calculateComplexityScore({
    notasEmitidas: params.notasEmitidas,
    lancamentos: params.lancamentos,
    usafolha: params.usafolha,
    usafiscal: params.usafiscal,
    segmento: params.segmento,
    cnaeSecundario: params.cnaeSecundario,
  });
  const feeComplexidade = getComplexityAdd(score);

  let feeSugerido = feeBase + feeFuncionarios + feeFaturamento + feeComplexidade;

  // Piso
  const piso = PRICING_CONFIG.pisos[regime] || 450;
  if (feeSugerido < piso) feeSugerido = piso;

  // Teto manual
  const isPrecificacaoManual = feeSugerido > PRICING_CONFIG.tetoManual;

  return {
    feeSugerido,
    feeBase,
    feeFuncionarios,
    feeFaturamento,
    feeComplexidade,
    complexityScore: score,
    complexityDetails: details,
    isPrecificacaoManual,
    regime,
  };
}

// ============================================================
// Detecção de Defasagem
// ============================================================

interface DefasagemCheck {
  isDefasado: boolean;
  reasons: string[];
}

export function checkDefasagem(params: {
  feeAtual: number;
  feeSugerido: number;
  lastReajusteAt?: Date | null;
}): DefasagemCheck {
  const reasons: string[] = [];

  // Regra 1: Fee sugerido >= fee atual + 20%
  if (params.feeSugerido >= params.feeAtual * 1.2) {
    const diff = ((params.feeSugerido - params.feeAtual) / params.feeAtual * 100).toFixed(0);
    reasons.push(`Fee sugerido ${diff}% acima do atual`);
  }

  // Regra 2: Último reajuste > 90 dias (se aplicável)
  if (params.lastReajusteAt) {
    const daysSinceReajuste = Math.floor(
      (Date.now() - params.lastReajusteAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceReajuste > 90 && reasons.length > 0) {
      reasons.push(`Último reajuste há ${daysSinceReajuste} dias`);
    }
  }

  return {
    isDefasado: reasons.length > 0,
    reasons,
  };
}

// ============================================================
// Recalcular Precificação para todas as empresas
// ============================================================

export async function recalculateAllPricing(): Promise<{
  processed: number;
  defasados: number;
  suggestions: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;
  let defasados = 0;
  let suggestions = 0;

  // Buscar todas as empresas ativas do eKontrol
  const companies = await rawQuery(
    `SELECT ek.*, 
            (SELECT m.funcionarios FROM ekontrol_metrics_monthly m 
             WHERE m.ek_company_id = ek.id ORDER BY m.competencia DESC LIMIT 1) as last_funcionarios,
            (SELECT m.faturamento_total FROM ekontrol_metrics_monthly m 
             WHERE m.ek_company_id = ek.id ORDER BY m.competencia DESC LIMIT 1) as last_faturamento,
            (SELECT m.notas_emitidas FROM ekontrol_metrics_monthly m 
             WHERE m.ek_company_id = ek.id ORDER BY m.competencia DESC LIMIT 1) as last_notas,
            (SELECT m.lancamentos FROM ekontrol_metrics_monthly m 
             WHERE m.ek_company_id = ek.id ORDER BY m.competencia DESC LIMIT 1) as last_lancamentos
     FROM ekontrol_companies ek
     WHERE ek.status_empresa = 'A'`
  );

  for (const company of companies as any[]) {
    try {
      const result = calculateFee({
        regime: company.regime_tributario,
        funcionarios: company.last_funcionarios || 0,
        faturamentoMensal: parseFloat(company.last_faturamento || "0"),
        notasEmitidas: company.last_notas || 0,
        lancamentos: company.last_lancamentos || 0,
        usafolha: company.usafolha,
        usafiscal: company.usafiscal,
        segmento: company.segmento,
        cnaeSecundario: company.cnae_secundario,
      });

      const feeAtual = parseFloat(company.honorarios_atual || "0");

      // Upsert pricing_current
      await rawExec(
        `INSERT INTO pricing_current 
         (ek_company_id, fee_atual, fee_sugerido, fee_base, fee_funcionarios,
          fee_faturamento, fee_complexidade, complexity_score, complexity_details,
          is_precificacao_manual, last_calculated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           fee_atual = VALUES(fee_atual),
           fee_sugerido = VALUES(fee_sugerido),
           fee_base = VALUES(fee_base),
           fee_funcionarios = VALUES(fee_funcionarios),
           fee_faturamento = VALUES(fee_faturamento),
           fee_complexidade = VALUES(fee_complexidade),
           complexity_score = VALUES(complexity_score),
           complexity_details = VALUES(complexity_details),
           is_precificacao_manual = VALUES(is_precificacao_manual),
           last_calculated_at = NOW()`,
        [
          company.id,
          feeAtual || null,
          result.feeSugerido,
          result.feeBase,
          result.feeFuncionarios,
          result.feeFaturamento,
          result.feeComplexidade,
          result.complexityScore,
          JSON.stringify(result.complexityDetails),
          result.isPrecificacaoManual,
        ]
      );

      // Check defasagem
      if (feeAtual > 0) {
        const defCheck = checkDefasagem({
          feeAtual,
          feeSugerido: result.feeSugerido,
        });

        if (defCheck.isDefasado) {
          defasados++;

          // Update pricing_current com defasagem
          await rawExec(
            `UPDATE pricing_current 
             SET is_defasado = TRUE, 
                 defasagem_reason = ?,
                 defasagem_detected_at = COALESCE(defasagem_detected_at, NOW())
             WHERE ek_company_id = ?
               AND (snoozed_until IS NULL OR snoozed_until < NOW())`,
            [JSON.stringify(defCheck.reasons), company.id]
          );

          // Criar sugestão se não existe uma pending
          const existing = await rawQuery(
            `SELECT id FROM pricing_suggestions 
             WHERE ek_company_id = ? AND status = 'pending' LIMIT 1`,
            [company.id]
          );
          if (existing.length === 0) {
            await rawExec(             `INSERT INTO pricing_suggestions 
               (ek_company_id, fee_anterior, fee_sugerido, reason, status)
               VALUES (?, ?, ?, ?, 'pending')`,
              [
                company.id,
                feeAtual,
                result.feeSugerido,
                JSON.stringify({
                  reasons: defCheck.reasons,
                  breakdown: {
                    base: result.feeBase,
                    funcionarios: result.feeFuncionarios,
                    faturamento: result.feeFaturamento,
                    complexidade: result.feeComplexidade,
                  },
                }),
              ]
            );
            suggestions++;
          }
        } else {
          // Limpar defasagem se não está mais defasado
          await rawExec(
            `UPDATE pricing_current 
             SET is_defasado = FALSE, defasagem_reason = NULL
             WHERE ek_company_id = ?`,
            [company.id]
          );
        }
      }

      // Audit
      await rawExec(
        `INSERT INTO pricing_audit (ek_company_id, action, details)
         VALUES (?, 'fee_calculated', ?)`,
        [
          company.id,
          JSON.stringify({
            feeAtual,
            feeSugerido: result.feeSugerido,
            regime: result.regime,
            breakdown: {
              base: result.feeBase,
              funcionarios: result.feeFuncionarios,
              faturamento: result.feeFaturamento,
              complexidade: result.feeComplexidade,
            },
          }),
        ]
      );

      processed++;
    } catch (e: any) {
      errors.push(`${company.razao_social}: ${e.message}`);
    }
  }

  return { processed, defasados, suggestions, errors };
}

// ============================================================
// Detecção de Honorário Base via Receivables Recorrentes
// ============================================================

/**
 * Para cada cliente, busca os últimos 6 meses de receivables,
 * agrupa por valor, e se o mesmo valor aparece 3+ vezes → honorário base.
 * Retorna o valor mais recorrente (maior ocorrência).
 */
export async function detectHonorarioBaseFromReceivables(): Promise<{
  detected: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let detected = 0;
  let updated = 0;

  try {
    // Buscar clientes com receivables recorrentes (mesmo valor 3+ vezes nos últimos 6 meses)
    const recurrents = await rawQuery<{
      clientId: number;
      amount: string;
      occurrences: number;
    }>(
      `SELECT r.clientId, r.amount, COUNT(*) as occurrences
       FROM receivables r
       WHERE r.dueDate >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       AND r.status IN ('paid', 'overdue', 'pending')
       GROUP BY r.clientId, r.amount
       HAVING COUNT(*) >= 3
       ORDER BY r.clientId, occurrences DESC`
    );

    // Agrupar por clientId e pegar o valor mais recorrente
    const clientMap = new Map<number, { amount: number; occurrences: number }>();
    for (const row of recurrents) {
      const existing = clientMap.get(row.clientId);
      if (!existing || row.occurrences > existing.occurrences) {
        clientMap.set(row.clientId, {
          amount: parseFloat(row.amount),
          occurrences: row.occurrences,
        });
      }
    }

    detected = clientMap.size;

    // Atualizar ekontrol_companies com o honorário detectado via receivables
    const entries = Array.from(clientMap.entries());
    for (const [clientId, data] of entries) {
      try {
        // Atualizar ekontrol_companies se o client_id está linkado
        const result = await rawExec(
          `UPDATE ekontrol_companies 
           SET honorarios_atual = ?,
               honorarios_fonte = 'receivables_recorrentes'
           WHERE client_id = ?
             AND (honorarios_atual IS NULL OR honorarios_atual = 0)`,
          [data.amount, clientId]
        );
        if (result.affectedRows > 0) updated++;
      } catch (e: any) {
        errors.push(`Client ${clientId}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`detectHonorarioBase: ${e.message}`);
  }

  return { detected, updated, errors };
}

// ============================================================
// Exportar configuração para uso no frontend
// ============================================================

export { PRICING_CONFIG, normalizeRegime };
