/**
 * Multi-Contatos por Cliente — Router tRPC
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

export const contactsRouter = router({
  list: publicProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await rawQuery(
        `SELECT id, clientId, name, role, phoneE164, isWhatsapp, isActive,
                canReceiveBilling, priority, notes, source, createdAt, updatedAt
         FROM client_contacts
         WHERE clientId = ?
         ORDER BY priority ASC, createdAt ASC`,
        [input.clientId]
      );
      return {
        contacts: rows.map((r: any) => ({
          id: r.id, clientId: r.clientId, name: r.name, role: r.role,
          phoneE164: r.phoneE164, isWhatsapp: !!r.isWhatsapp, isActive: !!r.isActive,
          canReceiveBilling: !!r.canReceiveBilling, priority: r.priority,
          notes: r.notes, source: r.source, createdAt: r.createdAt, updatedAt: r.updatedAt,
        })),
      };
    }),

  add: protectedProcedure
    .input(z.object({
      clientId: z.number().int().positive(),
      name: z.string().min(1),
      role: z.string().optional(),
      phoneE164: z.string().min(10),
      isWhatsapp: z.boolean().default(true),
      canReceiveBilling: z.boolean().default(true),
      priority: z.number().int().min(1).max(10).default(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await rawQuery(
        `INSERT INTO client_contacts (clientId, name, role, phoneE164, isWhatsapp, canReceiveBilling, priority, notes, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
        [input.clientId, input.name, input.role ?? null, input.phoneE164,
         input.isWhatsapp ? 1 : 0, input.canReceiveBilling ? 1 : 0,
         input.priority, input.notes ?? null]
      );
      const insertId = (result as any).insertId ?? null;
      await rawQuery(
        `INSERT INTO client_change_audit (clientId, contactId, action, afterJson, userId, userName)
         VALUES (?, ?, 'addContact', ?, ?, ?)`,
        [input.clientId, insertId, JSON.stringify(input), ctx.user?.id ?? null, ctx.user?.name ?? "system"]
      );
      return { success: true, contactId: insertId };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).optional(),
      role: z.string().optional(),
      phoneE164: z.string().min(10).optional(),
      isWhatsapp: z.boolean().optional(),
      canReceiveBilling: z.boolean().optional(),
      priority: z.number().int().min(1).max(10).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...fields } = input;
      const sets: string[] = [];
      const params: any[] = [];
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          sets.push(`${key} = ?`);
          params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
        }
      }
      if (sets.length === 0) return { success: false };
      params.push(id);
      await rawQuery(`UPDATE client_contacts SET ${sets.join(", ")} WHERE id = ?`, params);
      const [contact] = await rawQuery("SELECT clientId FROM client_contacts WHERE id = ?", [id]);
      if (contact) {
        await rawQuery(
          `INSERT INTO client_change_audit (clientId, contactId, action, afterJson, userId, userName)
           VALUES (?, ?, 'updateContact', ?, ?, ?)`,
          [contact.clientId, id, JSON.stringify(fields), ctx.user?.id ?? null, ctx.user?.name ?? "system"]
        );
      }
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [contact] = await rawQuery("SELECT clientId, name FROM client_contacts WHERE id = ?", [input.id]);
      if (!contact) throw new Error("Contato não encontrado");
      await rawQuery("UPDATE client_contacts SET isActive = 0 WHERE id = ?", [input.id]);
      await rawQuery(
        `INSERT INTO client_change_audit (clientId, contactId, action, beforeJson, userId, userName)
         VALUES (?, ?, 'removeContact', ?, ?, ?)`,
        [contact.clientId, input.id, JSON.stringify({ name: contact.name }),
         ctx.user?.id ?? null, ctx.user?.name ?? "system"]
      );
      return { success: true };
    }),

  setPrimary: protectedProcedure
    .input(z.object({ clientId: z.number().int().positive(), contactId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await rawQuery("UPDATE clients SET preferredContactId = ? WHERE id = ?", [input.contactId, input.clientId]);
      await rawQuery(
        `INSERT INTO client_change_audit (clientId, contactId, action, afterJson, userId, userName)
         VALUES (?, ?, 'setPrimaryContact', ?, ?, ?)`,
        [input.clientId, input.contactId, JSON.stringify({ preferredContactId: input.contactId }),
         ctx.user?.id ?? null, ctx.user?.name ?? "system"]
      );
      return { success: true };
    }),
});
