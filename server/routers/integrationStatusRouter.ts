/**
 * Integration Status Router — tRPC endpoints para monitoramento SIEG / Domínio
 *
 * Módulo separado: não mistura com cobrança, NFS-e ou honorários.
 * Fase 1: gestão manual + diagnóstico.
 * Fase 2: integração com API do SIEG (quando disponível).
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import mysql from "mysql2/promise";
import { audit } from "../_core/auditHelper";

function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export const integrationStatusRouter = router({
  // ─── Listagem ────────────────────────────────────────────────────────────────

  list: protectedProcedure
    .input(z.object({
      siegStatus: z.enum(["all", "active", "inactive", "error", "unknown"]).optional().default("all"),
      dominioStatus: z.enum(["all", "active", "inactive", "error", "unknown"]).optional().default("all"),
      hasDivergence: z.boolean().optional(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(200).optional().default(50),
    }))
    .query(async ({ input }) => {
      const conn = await getConn();
      try {
        const offset = (input.page - 1) * input.pageSize;
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (input.siegStatus !== "all") {
          conditions.push("sieg_status = ?");
          params.push(input.siegStatus);
        }
        if (input.dominioStatus !== "all") {
          conditions.push("dominio_status = ?");
          params.push(input.dominioStatus);
        }
        if (input.hasDivergence !== undefined) {
          conditions.push("has_divergence = ?");
          params.push(input.hasDivergence ? 1 : 0);
        }
        if (input.search) {
          conditions.push("(cnpj LIKE ? OR company_name LIKE ?)");
          params.push(`%${input.search}%`, `%${input.search}%`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const [rows] = await conn.execute(
          `SELECT 
            i.*,
            c.valid_to as cert_valid_to,
            c.status as cert_status,
            c.file_name as cert_file_name
           FROM integration_status i
           LEFT JOIN certificates c ON c.cnpj = i.cnpj AND c.is_active = 1
           ${where}
           ORDER BY 
             CASE i.sieg_status WHEN 'error' THEN 1 WHEN 'inactive' THEN 2 ELSE 3 END,
             i.company_name ASC
           LIMIT ? OFFSET ?`,
          [...params, input.pageSize, offset]
        ) as [any[], any];

        const [countRows] = await conn.execute(
          `SELECT COUNT(*) as total FROM integration_status ${where}`,
          params
        ) as [any[], any];

        return {
          items: rows,
          total: countRows[0].total as number,
          page: input.page,
          pageSize: input.pageSize,
        };
      } finally {
        await conn.end();
      }
    }),

  // ─── Sumário ─────────────────────────────────────────────────────────────────

  summary: protectedProcedure.query(async () => {
    const conn = await getConn();
    try {
      const [siegRows] = await conn.execute(
        "SELECT sieg_status, COUNT(*) as count FROM integration_status GROUP BY sieg_status"
      ) as [any[], any];
      const [dominioRows] = await conn.execute(
        "SELECT dominio_status, COUNT(*) as count FROM integration_status GROUP BY dominio_status"
      ) as [any[], any];
      const [divRows] = await conn.execute(
        "SELECT COUNT(*) as count FROM integration_status WHERE has_divergence = 1"
      ) as [any[], any];
      const [totalRows] = await conn.execute(
        "SELECT COUNT(*) as total FROM integration_status"
      ) as [any[], any];

      const sieg: Record<string, number> = {};
      for (const r of siegRows) sieg[r.sieg_status] = Number(r.count);
      const dominio: Record<string, number> = {};
      for (const r of dominioRows) dominio[r.dominio_status] = Number(r.count);

      return {
        total: Number(totalRows[0].total),
        sieg,
        dominio,
        withDivergence: Number(divRows[0].count),
      };
    } finally {
      await conn.end();
    }
  }),

  // ─── Upsert (criar ou atualizar) ─────────────────────────────────────────────

  upsert: protectedProcedure
    .input(z.object({
      cnpj: z.string().min(11).max(20),
      companyName: z.string().optional(),
      siegStatus: z.enum(["active", "inactive", "error", "unknown"]).optional(),
      siegNotes: z.string().optional(),
      dominioStatus: z.enum(["active", "inactive", "error", "unknown"]).optional(),
      dominioNotes: z.string().optional(),
      hasDivergence: z.boolean().optional(),
      divergenceDetails: z.string().optional(),
      manualNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getConn();
      try {
        const [existing] = await conn.execute(
          "SELECT id FROM integration_status WHERE cnpj = ?",
          [input.cnpj]
        ) as [any[], any];

        if (existing.length > 0) {
          const sets: string[] = [];
          const vals: unknown[] = [];

          if (input.companyName !== undefined) { sets.push("company_name = ?"); vals.push(input.companyName); }
          if (input.siegStatus !== undefined) { sets.push("sieg_status = ?, sieg_last_check_at = NOW()"); vals.push(input.siegStatus); }
          if (input.siegNotes !== undefined) { sets.push("sieg_notes = ?"); vals.push(input.siegNotes); }
          if (input.dominioStatus !== undefined) { sets.push("dominio_status = ?, dominio_last_check_at = NOW()"); vals.push(input.dominioStatus); }
          if (input.dominioNotes !== undefined) { sets.push("dominio_notes = ?"); vals.push(input.dominioNotes); }
          if (input.hasDivergence !== undefined) { sets.push("has_divergence = ?"); vals.push(input.hasDivergence ? 1 : 0); }
          if (input.divergenceDetails !== undefined) { sets.push("divergence_details = ?"); vals.push(input.divergenceDetails); }
          if (input.manualNotes !== undefined) { sets.push("manual_notes = ?"); vals.push(input.manualNotes); }

          if (sets.length > 0) {
            await conn.execute(
              `UPDATE integration_status SET ${sets.join(", ")} WHERE cnpj = ?`,
              [...vals, input.cnpj]
            );
          }
        } else {
          await conn.execute(
            `INSERT INTO integration_status (cnpj, company_name, sieg_status, sieg_notes, dominio_status, dominio_notes, has_divergence, divergence_details, manual_notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              input.cnpj,
              input.companyName ?? null,
              input.siegStatus ?? "unknown",
              input.siegNotes ?? null,
              input.dominioStatus ?? "unknown",
              input.dominioNotes ?? null,
              input.hasDivergence ? 1 : 0,
              input.divergenceDetails ?? null,
              input.manualNotes ?? null,
            ]
          );
        }

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "integration_status_update",
          resource: "integration_status",
          resourceId: input.cnpj,
          description: `Status de integração atualizado para CNPJ ${input.cnpj}`,
          newValue: input,
          status: "success",
        });

        return { success: true };
      } finally {
        await conn.end();
      }
    }),

  // ─── Marcar como resolvido ────────────────────────────────────────────────────

  resolve: protectedProcedure
    .input(z.object({ cnpj: z.string(), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getConn();
      try {
        await conn.execute(
          `UPDATE integration_status 
           SET has_divergence = 0, resolved_at = NOW(), resolved_by_user_id = ?, manual_notes = COALESCE(?, manual_notes)
           WHERE cnpj = ?`,
          [ctx.user.id, input.notes ?? null, input.cnpj]
        );

        await audit({
          userId: ctx.user.id,
          userName: ctx.user.name ?? ctx.user.email ?? null,
          userRole: ctx.user.role,
          action: "integration_divergence_resolved",
          resource: "integration_status",
          resourceId: input.cnpj,
          description: `Divergência marcada como resolvida para CNPJ ${input.cnpj}`,
          status: "success",
        });

        return { success: true };
      } finally {
        await conn.end();
      }
    }),

  // ─── Diagnóstico SIEG → Domínio ───────────────────────────────────────────────

  diagnose: protectedProcedure.query(async () => {
    const conn = await getConn();
    try {
      // Empresas ativas sem integração cadastrada
      const [noIntegration] = await conn.execute(
        `SELECT c.name, c.document as cnpj
         FROM clients c
         WHERE c.status = 'active'
           AND c.document IS NOT NULL
           AND c.document != ''
           AND NOT EXISTS (
             SELECT 1 FROM integration_status i
             WHERE REPLACE(i.cnpj, '.', '') = REPLACE(REPLACE(REPLACE(c.document, '.', ''), '/', ''), '-', '')
           )
         LIMIT 50`
      ) as [any[], any];

      // Empresas com certificado vencido ou sem certificado
      const [certIssues] = await conn.execute(
        `SELECT i.cnpj, i.company_name, i.sieg_status, i.dominio_status,
                c.status as cert_status, c.valid_to as cert_valid_to
         FROM integration_status i
         LEFT JOIN certificates c ON c.cnpj = i.cnpj AND c.is_active = 1
         WHERE c.id IS NULL OR c.status IN ('expired', 'expiring_7', 'expiring_15')
         ORDER BY c.valid_to ASC
         LIMIT 50`
      ) as [any[], any];

      // Empresas com erro no SIEG
      const [siegErrors] = await conn.execute(
        `SELECT cnpj, company_name, sieg_status, sieg_notes, sieg_last_check_at
         FROM integration_status
         WHERE sieg_status IN ('error', 'inactive')
         ORDER BY updated_at DESC
         LIMIT 50`
      ) as [any[], any];

      // Empresas com erro no Domínio
      const [dominioErrors] = await conn.execute(
        `SELECT cnpj, company_name, dominio_status, dominio_notes, dominio_last_check_at
         FROM integration_status
         WHERE dominio_status IN ('error', 'inactive')
         ORDER BY updated_at DESC
         LIMIT 50`
      ) as [any[], any];

      return {
        noIntegration: noIntegration as any[],
        certIssues: certIssues as any[],
        siegErrors: siegErrors as any[],
        dominioErrors: dominioErrors as any[],
        generatedAt: new Date().toISOString(),
      };
    } finally {
      await conn.end();
    }
  }),

  // ─── Importar empresas do Conta Azul para integration_status ─────────────────

  importFromClients: protectedProcedure.mutation(async ({ ctx }) => {
    const conn = await getConn();
    try {
      // Buscar clientes ativos com CNPJ que ainda não têm integration_status
      const [clients] = await conn.execute(
        `SELECT name, document as cnpj FROM clients
         WHERE status = 'active' AND document IS NOT NULL AND LENGTH(document) >= 11
         AND NOT EXISTS (
           SELECT 1 FROM integration_status i
           WHERE REPLACE(i.cnpj, '.', '') = REPLACE(REPLACE(REPLACE(clients.document, '.', ''), '/', ''), '-', '')
         )
         LIMIT 500`
      ) as [any[], any];

      let imported = 0;
      for (const c of clients) {
        const cnpj = c.cnpj.replace(/\D/g, "");
        if (!cnpj) continue;
        try {
          await conn.execute(
            `INSERT IGNORE INTO integration_status (cnpj, company_name, sieg_status, dominio_status)
             VALUES (?, ?, 'unknown', 'unknown')`,
            [cnpj, c.name]
          );
          imported++;
        } catch { /* ignore duplicates */ }
      }

      await audit({
        userId: ctx.user.id,
        userName: ctx.user.name ?? ctx.user.email ?? null,
        userRole: ctx.user.role,
        action: "integration_import_clients",
        resource: "integration_status",
        description: `${imported} empresas importadas para monitoramento de integração`,
        status: "success",
      });

      return { imported };
    } finally {
      await conn.end();
    }
  }),
});
