/**
 * Pricing Router — endpoints tRPC para precificação de honorários
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getPricingSchedulerStatus, runPricingJob } from "../pricingScheduler";
import { calculateFee, syncEkontrolCompanies, recalculateAllPricing } from "../services/ekontrolService";
import { runFullCnpjAndFeePipeline, fillHonorariosFromReceivables } from "../services/syncCnpjAndFeeService";
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

export const pricingRouter = router({
  // ── Dashboard Summary ──────────────────────────────────────────────────
  summary: publicProcedure.query(async () => {
    const [stats] = await rawQuery(`
      SELECT 
        COUNT(*) as totalCompanies,
        SUM(CASE WHEN ek.status_empresa = 'A' THEN 1 ELSE 0 END) as activeCompanies,
        SUM(CASE WHEN ek.honorarios_atual IS NOT NULL AND ek.honorarios_atual > 0 THEN 1 ELSE 0 END) as withFee,
        SUM(CASE WHEN pc.is_defasado = TRUE AND (pc.snoozed_until IS NULL OR pc.snoozed_until < NOW()) THEN 1 ELSE 0 END) as defasados,
        SUM(CASE WHEN pc.is_precificacao_manual = TRUE THEN 1 ELSE 0 END) as precificacaoManual,
        SUM(CASE WHEN ps.id IS NOT NULL AND ps.status = 'pending' THEN 1 ELSE 0 END) as pendingSuggestions,
        COALESCE(SUM(ek.honorarios_atual), 0) as totalFeeAtual,
        COALESCE(SUM(pc.fee_sugerido), 0) as totalFeeSugerido
      FROM ekontrol_companies ek
      LEFT JOIN pricing_current pc ON pc.ek_company_id = ek.id
      LEFT JOIN pricing_suggestions ps ON ps.ek_company_id = ek.id AND ps.status = 'pending'
      WHERE ek.status_empresa = 'A'
    `);

    return {
      totalCompanies: Number(stats.totalCompanies || 0),
      activeCompanies: Number(stats.activeCompanies || 0),
      withFee: Number(stats.withFee || 0),
      defasados: Number(stats.defasados || 0),
      precificacaoManual: Number(stats.precificacaoManual || 0),
      pendingSuggestions: Number(stats.pendingSuggestions || 0),
      totalFeeAtual: Number(stats.totalFeeAtual || 0),
      totalFeeSugerido: Number(stats.totalFeeSugerido || 0),
    };
  }),

  // ── Lista de empresas com precificação ──────────────────────────────────
  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      perPage: z.number().default(20),
      search: z.string().optional(),
      filter: z.enum(["all", "defasado", "manual", "pending", "withFee", "noFee"]).default("all"),
      sortBy: z.enum(["razaoSocial", "feeAtual", "feeSugerido", "defasagem"]).default("razaoSocial"),
      sortDir: z.enum(["asc", "desc"]).default("asc"),
    }))
    .query(async ({ input }) => {
      const { page, perPage, search, filter, sortBy, sortDir } = input;
      const offset = (page - 1) * perPage;

      let where = "WHERE ek.status_empresa = 'A'";
      const params: any[] = [];

      if (search) {
        where += " AND (ek.razao_social LIKE ? OR ek.inscricao_federal LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      if (filter === "defasado") {
        where += " AND pc.is_defasado = TRUE AND (pc.snoozed_until IS NULL OR pc.snoozed_until < NOW())";
      } else if (filter === "manual") {
        where += " AND pc.is_precificacao_manual = TRUE";
      } else if (filter === "pending") {
        where += " AND ps.status = 'pending'";
      } else if (filter === "withFee") {
        where += " AND ek.honorarios_atual IS NOT NULL AND ek.honorarios_atual > 0";
      } else if (filter === "noFee") {
        where += " AND (ek.honorarios_atual IS NULL OR ek.honorarios_atual = 0)";
      }

      let orderBy = "ek.razao_social ASC";
      if (sortBy === "feeAtual") orderBy = `ek.honorarios_atual ${sortDir}`;
      else if (sortBy === "feeSugerido") orderBy = `pc.fee_sugerido ${sortDir}`;
      else if (sortBy === "defasagem") orderBy = `pc.is_defasado DESC, ek.razao_social ASC`;
      else orderBy = `ek.razao_social ${sortDir}`;

      // Count
      const [countRow] = await rawQuery(
        `SELECT COUNT(DISTINCT ek.id) as total
         FROM ekontrol_companies ek
         LEFT JOIN pricing_current pc ON pc.ek_company_id = ek.id
         LEFT JOIN pricing_suggestions ps ON ps.ek_company_id = ek.id AND ps.status = 'pending'
         ${where}`,
        params
      );

      // Data
      const rows = await rawQuery(
        `SELECT 
          ek.id, ek.codi_emp, ek.inscricao_federal, ek.razao_social, 
          ek.regime_tributario, ek.honorarios_atual, ek.honorarios_fonte, ek.status_empresa,
          ek.segmento, ek.cnae_principal, ek.usafolha, ek.usafiscal, ek.usacontabil,
          ek.responsavel, ek.competencia_reajuste, ek.client_id,
          pc.fee_sugerido, pc.fee_base, pc.fee_funcionarios, pc.fee_faturamento, pc.fee_complexidade,
          pc.complexity_score, pc.is_defasado, pc.defasagem_reason, pc.snoozed_until,
          pc.is_precificacao_manual, pc.last_calculated_at,
          ps.id as suggestion_id, ps.status as suggestion_status,
          ps.fee_anterior as suggestion_fee_anterior, ps.fee_sugerido as suggestion_fee_sugerido
         FROM ekontrol_companies ek
         LEFT JOIN pricing_current pc ON pc.ek_company_id = ek.id
         LEFT JOIN pricing_suggestions ps ON ps.ek_company_id = ek.id AND ps.status = 'pending'
         ${where}
         ORDER BY ${orderBy}
         LIMIT ${Number(perPage)} OFFSET ${Number(offset)}`,
        params
      );

      return {
        items: rows,
        total: Number(countRow?.total || 0),
        page,
        perPage,
        totalPages: Math.ceil(Number(countRow?.total || 0) / perPage),
      };
    }),

  // ── Detalhe de uma empresa ──────────────────────────────────────────────
  detail: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [company] = await rawQuery(
        `SELECT ek.*, ek.honorarios_fonte,
                pc.fee_sugerido, pc.fee_base, pc.fee_funcionarios, pc.fee_faturamento, 
                pc.fee_complexidade, pc.complexity_score, pc.complexity_details,
                pc.is_defasado, pc.defasagem_reason, pc.snoozed_until,
                pc.is_precificacao_manual, pc.last_calculated_at, pc.last_reajuste_at
         FROM ekontrol_companies ek
         LEFT JOIN pricing_current pc ON pc.ek_company_id = ek.id
         WHERE ek.id = ?`,
        [input.id]
      );

      // Métricas mensais (últimos 6 meses)
      const metrics = await rawQuery(
        `SELECT * FROM ekontrol_metrics_monthly 
         WHERE ek_company_id = ? ORDER BY competencia DESC LIMIT 6`,
        [input.id]
      );

      // Sugestões
      const suggestions = await rawQuery(
        `SELECT * FROM pricing_suggestions 
         WHERE ek_company_id = ? ORDER BY created_at DESC LIMIT 10`,
        [input.id]
      );

      // Auditoria
      const audit = await rawQuery(
        `SELECT * FROM pricing_audit 
         WHERE ek_company_id = ? ORDER BY created_at DESC LIMIT 20`,
        [input.id]
      );

      return { company, metrics, suggestions, audit };
    }),

  // ── Calculadora de fee (simulação) ──────────────────────────────────────
  simulate: publicProcedure
    .input(z.object({
      regime: z.string(),
      funcionarios: z.number().default(0),
      faturamentoMensal: z.number().default(0),
      notasEmitidas: z.number().optional(),
      lancamentos: z.number().optional(),
      usafolha: z.boolean().optional(),
      usafiscal: z.boolean().optional(),
    }))
    .query(({ input }) => {
      return calculateFee(input);
    }),

  // ── Scheduler Status ──────────────────────────────────────────────────
  schedulerStatus: publicProcedure.query(() => {
    return getPricingSchedulerStatus();
  }),

  // ── Ações (protegidas) ──────────────────────────────────────────────────

  // Sync manual do eKontrol
  syncNow: publicProcedure.mutation(async () => {
    const syncResult = await syncEkontrolCompanies();
    // After syncing eKontrol, also fill fees from receivables
    const feesResult = await fillHonorariosFromReceivables();
    const pricingResult = await recalculateAllPricing();
    return { syncResult, feesResult, pricingResult };
  }),

  // Sync CNPJ from Conta Azul + match + fill fees (full pipeline)
  syncCnpjAndFees: publicProcedure.mutation(async () => {
    return await runFullCnpjAndFeePipeline();
  }),

  // Recalcular precificação
  recalculate: publicProcedure.mutation(async () => {
    return await recalculateAllPricing();
  }),

  // Aplicar sugestão de reajuste
  applySuggestion: publicProcedure
    .input(z.object({
      suggestionId: z.number(),
      feeAplicado: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [suggestion] = await rawQuery(
        "SELECT * FROM pricing_suggestions WHERE id = ? AND status = 'pending'",
        [input.suggestionId]
      );
      if (!suggestion) throw new Error("Sugestão não encontrada ou já processada");

      await rawExec(
        `UPDATE pricing_suggestions 
         SET status = 'applied', applied_at = NOW(), applied_by = ?, fee_aplicado = ?
         WHERE id = ?`,
        [ctx.user?.name || "admin", input.feeAplicado, input.suggestionId]
      );

      // Atualizar pricing_current
      await rawExec(
        `UPDATE pricing_current 
         SET fee_atual = ?, is_defasado = FALSE, defasagem_reason = NULL, last_reajuste_at = NOW()
         WHERE ek_company_id = ?`,
        [input.feeAplicado, suggestion.ek_company_id]
      );

      // Audit
      await rawExec(
        `INSERT INTO pricing_audit (ek_company_id, action, details, performed_by)
         VALUES (?, 'reajuste_applied', ?, ?)`,
        [
          suggestion.ek_company_id,
          JSON.stringify({
            suggestionId: input.suggestionId,
            feeAnterior: suggestion.fee_anterior,
            feeSugerido: suggestion.fee_sugerido,
            feeAplicado: input.feeAplicado,
          }),
          ctx.user?.name || "admin",
        ]
      );

      return { success: true };
    }),

  // Dispensar sugestão
  dismissSuggestion: publicProcedure
    .input(z.object({
      suggestionId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await rawExec(
        `UPDATE pricing_suggestions 
         SET status = 'dismissed', dismissed_reason = ?
         WHERE id = ?`,
        [input.reason || "Dispensado manualmente", input.suggestionId]
      );

      const [suggestion] = await rawQuery(
        "SELECT ek_company_id FROM pricing_suggestions WHERE id = ?",
        [input.suggestionId]
      );

      if (suggestion) {
        await rawExec(
          `INSERT INTO pricing_audit (ek_company_id, action, details, performed_by)
           VALUES (?, 'reajuste_dismissed', ?, ?)`,
          [
            suggestion.ek_company_id,
            JSON.stringify({ suggestionId: input.suggestionId, reason: input.reason }),
            ctx.user?.name || "admin",
          ]
        );
      }

      return { success: true };
    }),

  // Snooze
  snooze: publicProcedure
    .input(z.object({
      ekCompanyId: z.number(),
      days: z.number().default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const snoozedUntil = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);

      await rawExec(
        `UPDATE pricing_current SET snoozed_until = ? WHERE ek_company_id = ?`,
        [snoozedUntil.toISOString().slice(0, 19).replace("T", " "), input.ekCompanyId]
      );

      await rawExec(
        `UPDATE pricing_suggestions SET status = 'snoozed', snoozed_until = ?
         WHERE ek_company_id = ? AND status = 'pending'`,
        [snoozedUntil.toISOString().slice(0, 19).replace("T", " "), input.ekCompanyId]
      );

      await rawExec(
        `INSERT INTO pricing_audit (ek_company_id, action, details, performed_by)
         VALUES (?, 'snooze_set', ?, ?)`,
        [
          input.ekCompanyId,
          JSON.stringify({ days: input.days, snoozedUntil: snoozedUntil.toISOString() }),
          ctx.user?.name || "admin",
        ]
      );

      return { success: true, snoozedUntil };
    }),
});
