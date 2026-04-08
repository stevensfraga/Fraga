/**
 * Gestão de Clientes — Router tRPC
 *
 * Endpoints:
 *   clientsManager.list           — lista paginada com busca (nome, CNPJ, email, telefone)
 *   clientsManager.stats          — contadores
 *   clientsManager.update         — editar campos
 *   clientsManager.toggleOptOut   — opt-out
 *   clientsManager.pauseBilling   — pausar cobrança
 *   clientsManager.findDuplicates — duplicatas de um cliente específico
 *   clientsManager.listDuplicates — todos os pares duplicados (mesmo CNPJ ou nome similar)
 *   clientsManager.merge          — mesclar dois clientes (deleta o secundário)
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
        // Busca por nome, CNPJ, email ou qualquer campo de telefone
        conditions.push(
          "(c.name LIKE ? OR c.document LIKE ? OR c.email LIKE ? OR c.whatsappNumber LIKE ? OR c.phone LIKE ? OR c.phoneCellular LIKE ?)"
        );
        const like = `%${input.search}%`;
        params.push(like, like, like, like, like, like);
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

      const [countRow] = await rawQuery(
        `SELECT COUNT(*) AS total FROM clients c ${joinOverdue} ${where}`,
        params
      );
      const total = Number(countRow?.total ?? 0);

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
        email: z.string().email().optional().or(z.literal("")).transform(v => v === "" ? undefined : v),
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
          params.push(value === "" ? null : value);
        }
      }

      if (sets.length === 0) return { success: false, message: "Nenhum campo para atualizar" };

      params.push(id);
      await rawQuery(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`, params);

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
        until: z.string().datetime().nullable(),
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

  // ── Duplicatas de um cliente específico ─────────────────────────────────
  findDuplicates: publicProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [client] = await rawQuery(
        "SELECT id, name, document, whatsappNumber FROM clients WHERE id = ?",
        [input.clientId]
      );
      if (!client) return { duplicates: [] };

      const nameParts = (client.name as string).split(/\s+/).slice(0, 3).join(" ");

      const candidates = await rawQuery(
        `SELECT c.id, c.name, c.document, c.email, c.whatsappNumber, c.status,
                COUNT(r.id) AS receivableCount
         FROM clients c
         LEFT JOIN receivables r ON r.clientId = c.id
         WHERE c.id != ?
           AND c.status != 'inactive'
           AND (
             c.name LIKE ?
             OR (c.document IS NOT NULL AND c.document != '' AND c.document = ?)
             OR (c.whatsappNumber IS NOT NULL AND c.whatsappNumber = ?)
           )
         GROUP BY c.id
         LIMIT 5`,
        [
          input.clientId,
          `%${nameParts.substring(0, 12)}%`,
          client.document ?? "__no_match__",
          client.whatsappNumber ?? "__no_match__",
        ]
      );

      return {
        duplicates: candidates.map((r: any) => ({
          id: r.id,
          name: r.name,
          document: r.document,
          email: r.email,
          whatsappNumber: r.whatsappNumber,
          status: r.status,
          receivableCount: Number(r.receivableCount),
        })),
      };
    }),

  // ── Listar todos os pares duplicados ─────────────────────────────────────
  listDuplicates: publicProcedure.query(async () => {
    const pairs = await rawQuery<any>(
      `SELECT
        a.id          AS a_id,
        a.name        AS a_name,
        a.document    AS a_doc,
        a.email       AS a_email,
        a.whatsappNumber AS a_wn,
        a.phone       AS a_phone,
        b.id          AS b_id,
        b.name        AS b_name,
        b.document    AS b_doc,
        b.email       AS b_email,
        b.whatsappNumber AS b_wn,
        b.phone       AS b_phone,
        CASE
          WHEN a.document IS NOT NULL AND a.document != '' AND a.document = b.document
            THEN 'cnpj'
          ELSE 'nome'
        END AS reason,
        (SELECT COUNT(*) FROM receivables WHERE clientId = a.id) AS a_recCount,
        (SELECT COUNT(*) FROM receivables WHERE clientId = b.id) AS b_recCount
       FROM clients a
       JOIN clients b ON a.id < b.id
       WHERE a.status != 'inactive' AND b.status != 'inactive'
         AND (
           (a.document IS NOT NULL AND a.document != '' AND a.document = b.document)
           OR SUBSTRING_INDEX(LOWER(TRIM(a.name)), ' ', 2) = SUBSTRING_INDEX(LOWER(TRIM(b.name)), ' ', 2)
         )
       ORDER BY reason ASC, a.document, a.name
       LIMIT 100`
    );

    return {
      pairs: pairs.map((r: any) => ({
        reason: r.reason as "cnpj" | "nome",
        a: {
          id: r.a_id, name: r.a_name, document: r.a_doc, email: r.a_email,
          whatsappNumber: r.a_wn, phone: r.a_phone, receivableCount: Number(r.a_recCount),
        },
        b: {
          id: r.b_id, name: r.b_name, document: r.b_doc, email: r.b_email,
          whatsappNumber: r.b_wn, phone: r.b_phone, receivableCount: Number(r.b_recCount),
        },
      })),
    };
  }),

  // ── Mesclar dois clientes ────────────────────────────────────────────────
  merge: protectedProcedure
    .input(
      z.object({
        primaryId: z.number().int().positive(),
        secondaryId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { primaryId, secondaryId } = input;
      if (primaryId === secondaryId) throw new Error("IDs devem ser diferentes");

      const [primary] = await rawQuery("SELECT * FROM clients WHERE id = ?", [primaryId]);
      const [secondary] = await rawQuery("SELECT * FROM clients WHERE id = ?", [secondaryId]);
      if (!primary || !secondary) throw new Error("Cliente não encontrado");

      // 1. Mover dados para o principal
      await rawQuery("UPDATE receivables SET clientId = ? WHERE clientId = ?", [primaryId, secondaryId]);
      await rawQuery("UPDATE collectionSchedule SET clientId = ? WHERE clientId = ?", [primaryId, secondaryId]);
      await rawQuery("UPDATE client_contacts SET clientId = ? WHERE clientId = ?", [primaryId, secondaryId]);
      await rawQuery("UPDATE collectionMessages SET clientId = ? WHERE clientId = ?", [primaryId, secondaryId]).catch(() => {});
      await rawQuery("UPDATE regua_audit SET clientId = ? WHERE clientId = ?", [primaryId, secondaryId]).catch(() => {});
      await rawQuery("UPDATE legalCases SET clientId = ? WHERE clientId = ?", [primaryId, secondaryId]).catch(() => {});

      // 2. Preencher campos nulos do principal com dados do secundário
      const fieldsToMerge = ["document", "email", "phone", "phoneCellular", "whatsappNumber", "cnae"] as const;
      for (const field of fieldsToMerge) {
        if (!primary[field] && secondary[field]) {
          await rawQuery(`UPDATE clients SET \`${field}\` = ? WHERE id = ?`, [secondary[field], primaryId]);
        }
      }

      // 3. Audit antes de deletar
      await rawQuery(
        `INSERT INTO client_change_audit (clientId, action, beforeJson, afterJson, userId, userName)
         VALUES (?, 'merge', ?, ?, ?, ?)`,
        [
          primaryId,
          JSON.stringify({ secondaryId, secondaryName: secondary.name }),
          JSON.stringify({ merged: true, primaryId }),
          ctx.user?.id ?? null,
          ctx.user?.name ?? "system",
        ]
      );

      // 4. Deletar o secundário (ou marcar inativo se FK impedir)
      try {
        await rawQuery("DELETE FROM client_change_audit WHERE clientId = ?", [secondaryId]);
        await rawQuery("DELETE FROM clients WHERE id = ?", [secondaryId]);
      } catch {
        await rawQuery(
          "UPDATE clients SET status = 'inactive', name = CONCAT('[MESCLADO] ', name) WHERE id = ?",
          [secondaryId]
        );
      }

      return { success: true };
    }),
});
