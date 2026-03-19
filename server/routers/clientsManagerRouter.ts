/**
 * Gestão de Clientes — Router tRPC
 *
 * Endpoints:
 *   clientsManager.list       — lista paginada com busca
 *   clientsManager.stats      — contadores (total, ativos, optOut, inadimplentes)
 *   clientsManager.update     — editar campos do cliente
 *   clientsManager.toggleOptOut — marcar/desmarcar opt-out
 *   clientsManager.pauseBilling — pausar/retomar cobrança
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
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

export const clientsManagerRouter = router({
  // ── Lista paginada ──────────────────────────────────────────────────────
  list: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(100).default(20),
        search: z.string().optional(),
        status: z.enum(["active", "inactive", "suspended"]).optional(),
        onlyOverdue: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.perPage;
      const conditions: string[] = [];
      const params: any[] = [];

      if (input.search) {
        conditions.push("(c.name LIKE ? OR c.document LIKE ? OR c.email LIKE ?)");
        const like = `%${input.search}%`;
        params.push(like, like, like);
      }
      if (input.status) {
        conditions.push("c.status = ?");
        params.push(input.status);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      let joinOverdue = "";
      let selectOverdue = ", NULL AS totalDebt, NULL AS openCount";
      if (input.onlyOverdue) {
        joinOverdue = `INNER JOIN (
          SELECT clientId, SUM(CAST(amount AS DECIMAL(12,2))) AS totalDebt, COUNT(*) AS openCount
          FROM receivables WHERE status IN ('pending','overdue') AND CAST(amount AS DECIMAL) > 0
          GROUP BY clientId
        ) ov ON ov.clientId = c.id`;
        selectOverdue = ", ov.totalDebt, ov.openCount";
      }

      // Count
      const [countRow] = await rawQuery(
        `SELECT COUNT(*) AS total FROM clients c ${joinOverdue} ${where}`,
        params
      );
      const total = Number(countRow?.total ?? 0);

      // Data
      const rows = await rawQuery(
        `SELECT c.id, c.contaAzulId, c.name, c.document, c.email,
                c.phone, c.phoneCellular, c.whatsappNumber, c.whatsappSource,
                c.cnae, c.status, c.optOut, c.billingPausedUntil, c.negotiatedUntil,
                c.sendConsolidatedDebt, c.preferredContactId,
                c.createdAt, c.updatedAt
                ${selectOverdue}
         FROM clients c ${joinOverdue} ${where}
         ORDER BY c.name ASC
         LIMIT ${Number(input.perPage)} OFFSET ${Number(offset)}`,
        params
      );

      return {
        clients: rows.map((r: any) => ({
          id: r.id,
          contaAzulId: r.contaAzulId,
          name: r.name,
          document: r.document,
          email: r.email,
          phone: r.phone,
          phoneCellular: r.phoneCellular,
          whatsappNumber: r.whatsappNumber,
          whatsappSource: r.whatsappSource,
          cnae: r.cnae,
          status: r.status,
          optOut: !!r.optOut,
          billingPausedUntil: r.billingPausedUntil,
          negotiatedUntil: r.negotiatedUntil,
          sendConsolidatedDebt: !!r.sendConsolidatedDebt,
          preferredContactId: r.preferredContactId,
          totalDebt: r.totalDebt != null ? Number(r.totalDebt) : null,
          openCount: r.openCount != null ? Number(r.openCount) : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        total,
        page: input.page,
        perPage: input.perPage,
        totalPages: Math.ceil(total / input.perPage),
      };
    }),

  // ── Estatísticas ────────────────────────────────────────────────────────
  stats: publicProcedure.query(async () => {
    const [row] = await rawQuery(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN optOut = 1 THEN 1 ELSE 0 END) AS optedOut
      FROM clients
    `);

    const [overdueRow] = await rawQuery(`
      SELECT COUNT(DISTINCT clientId) AS overdueClients
      FROM receivables
      WHERE status IN ('pending','overdue') AND CAST(amount AS DECIMAL) > 0
    `);

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      optedOut: Number(row?.optedOut ?? 0),
      overdueClients: Number(overdueRow?.overdueClients ?? 0),
    };
  }),

  // ── Atualizar cliente ───────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        phoneCellular: z.string().optional(),
        whatsappNumber: z.string().optional(),
        status: z.enum(["active", "inactive", "suspended"]).optional(),
        sendConsolidatedDebt: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...fields } = input;
      const sets: string[] = [];
      const params: any[] = [];

      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          sets.push(`${key} = ?`);
          params.push(value);
        }
      }

      if (sets.length === 0) return { success: false, message: "Nenhum campo para atualizar" };

      params.push(id);
      await rawQuery(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`, params);

      // Audit
      await rawQuery(
        `INSERT INTO client_change_audit (clientId, action, afterJson, userId, userName)
         VALUES (?, 'update', ?, ?, ?)`,
        [id, JSON.stringify(fields), ctx.user?.id ?? null, ctx.user?.name ?? "system"]
      );

      return { success: true };
    }),

  // ── Toggle opt-out ──────────────────────────────────────────────────────
  toggleOptOut: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [client] = await rawQuery("SELECT optOut FROM clients WHERE id = ?", [input.id]);
      if (!client) throw new Error("Cliente não encontrado");

      const newVal = client.optOut ? 0 : 1;
      await rawQuery("UPDATE clients SET optOut = ? WHERE id = ?", [newVal, input.id]);

      await rawQuery(
        `INSERT INTO client_change_audit (clientId, action, beforeJson, afterJson, userId, userName)
         VALUES (?, 'toggleOptOut', ?, ?, ?, ?)`,
        [input.id, JSON.stringify({ optOut: !!client.optOut }), JSON.stringify({ optOut: !!newVal }),
         ctx.user?.id ?? null, ctx.user?.name ?? "system"]
      );

      return { success: true, optOut: !!newVal };
    }),

  // ── Pausar cobrança ─────────────────────────────────────────────────────
  pauseBilling: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        until: z.string().datetime().nullable(), // ISO date or null to unpause
      })
    )
    .mutation(async ({ input, ctx }) => {
      await rawQuery(
        "UPDATE clients SET billingPausedUntil = ? WHERE id = ?",
        [input.until, input.id]
      );

      await rawQuery(
        `INSERT INTO client_change_audit (clientId, action, afterJson, userId, userName)
         VALUES (?, 'pauseBilling', ?, ?, ?)`,
        [input.id, JSON.stringify({ billingPausedUntil: input.until }),
         ctx.user?.id ?? null, ctx.user?.name ?? "system"]
      );

      return { success: true };
    }),
});
