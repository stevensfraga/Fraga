/**
 * Router de Administração de Usuários
 *
 * Permissões:
 * - listUsers: MASTER + ADMIN
 * - getUser: MASTER + ADMIN
 * - updateUserRole: MASTER only
 * - toggleUserActive: MASTER + ADMIN
 * - deleteUser: MASTER only
 * - listAuditLogs: MASTER only
 * - getMyPermissions: qualquer usuário autenticado
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import mysql from "mysql2/promise";
import { hasMinRole, canManageUser, ROLE_LABELS, ASSIGNABLE_ROLES, type AppRole } from "../_core/permissions";
import { audit, getIpFromCtx } from "../_core/auditHelper";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

async function rawExec(sql: string, params: any[] = []): Promise<any> {
  const conn = await getConn();
  try {
    const [result] = await conn.execute(sql, params);
    return result;
  } finally {
    await conn.end();
  }
}

export const usersAdminRouter = router({
  /** Retorna as permissões do usuário logado */
  myPermissions: protectedProcedure.query(async ({ ctx }) => {
    const role = ctx.user.role as AppRole;
    return {
      role,
      label: ROLE_LABELS[role] ?? role,
      canManageUsers: hasMinRole(role, "admin"),
      canDeleteUsers: hasMinRole(role, "master"),
      canChangeRoles: hasMinRole(role, "master"),
      canViewAudit: hasMinRole(role, "master"),
      canChangeIntegrations: hasMinRole(role, "master"),
      canUploadCertificates: hasMinRole(role, "admin"),
      canViewCertificates: hasMinRole(role, "operador"),
      assignableRoles: ASSIGNABLE_ROLES[role] ?? [],
    };
  }),

  /** Lista todos os usuários (MASTER + ADMIN) */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!hasMinRole(ctx.user.role, "admin")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a Admin ou superior" });
    }
    const users = await rawQuery(
      `SELECT id, openId, name, email, loginMethod, role, isActive, invitedBy, notes, createdAt, updatedAt, lastSignedIn
       FROM users ORDER BY createdAt DESC`
    );
    return users.map(u => ({
      ...u,
      roleLabel: ROLE_LABELS[(u.role as AppRole)] ?? u.role,
    }));
  }),

  /** Busca um usuário pelo ID (MASTER + ADMIN) */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!hasMinRole(ctx.user.role, "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a Admin ou superior" });
      }
      const [user] = await rawQuery("SELECT * FROM users WHERE id = ?", [input.id]);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      return { ...user, roleLabel: ROLE_LABELS[(user.role as AppRole)] ?? user.role };
    }),

  /** Atualiza o role de um usuário (MASTER only) */
  updateRole: protectedProcedure
    .input(z.object({
      userId: z.number(),
      newRole: z.enum(["admin", "operador", "visualizador", "user"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!hasMinRole(ctx.user.role, "master")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas o Master pode alterar roles" });
      }
      const [target] = await rawQuery("SELECT * FROM users WHERE id = ?", [input.userId]);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      if (target.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode alterar seu próprio role" });
      }
      if (!canManageUser(ctx.user.role, target.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode gerenciar este usuário" });
      }

      const oldRole = target.role;
      await rawExec(
        "UPDATE users SET role = ?, notes = COALESCE(?, notes), updatedAt = NOW() WHERE id = ?",
        [input.newRole, input.notes ?? null, input.userId]
      );

      await audit({
        userId: ctx.user.id,
        userName: ctx.user.name,
        userRole: ctx.user.role,
        action: "update_user_role",
        resource: "user",
        resourceId: String(input.userId),
        description: `Role de ${target.name} alterado de ${ROLE_LABELS[oldRole as AppRole] ?? oldRole} para ${ROLE_LABELS[input.newRole]}`,
        oldValue: { role: oldRole },
        newValue: { role: input.newRole },
        ipAddress: getIpFromCtx(ctx),
      });

      return { success: true };
    }),

  /** Ativa ou desativa um usuário (MASTER + ADMIN) */
  toggleActive: protectedProcedure
    .input(z.object({ userId: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!hasMinRole(ctx.user.role, "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a Admin ou superior" });
      }
      const [target] = await rawQuery("SELECT * FROM users WHERE id = ?", [input.userId]);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      if (target.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode desativar sua própria conta" });
      }
      if (!canManageUser(ctx.user.role, target.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode gerenciar este usuário" });
      }

      await rawExec("UPDATE users SET isActive = ?, updatedAt = NOW() WHERE id = ?", [input.isActive, input.userId]);

      await audit({
        userId: ctx.user.id,
        userName: ctx.user.name,
        userRole: ctx.user.role,
        action: input.isActive ? "activate_user" : "deactivate_user",
        resource: "user",
        resourceId: String(input.userId),
        description: `Usuário ${target.name} ${input.isActive ? "ativado" : "desativado"}`,
        oldValue: { isActive: !input.isActive },
        newValue: { isActive: input.isActive },
        ipAddress: getIpFromCtx(ctx),
      });

      return { success: true };
    }),

  /** Atualiza observações de um usuário (MASTER + ADMIN) */
  updateNotes: protectedProcedure
    .input(z.object({ userId: z.number(), notes: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!hasMinRole(ctx.user.role, "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a Admin ou superior" });
      }
      await rawExec("UPDATE users SET notes = ?, updatedAt = NOW() WHERE id = ?", [input.notes, input.userId]);
      return { success: true };
    }),

  /** Remove um usuário (MASTER only) */
  delete: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!hasMinRole(ctx.user.role, "master")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas o Master pode excluir usuários" });
      }
      const [target] = await rawQuery("SELECT * FROM users WHERE id = ?", [input.userId]);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      if (target.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode excluir sua própria conta" });
      }
      if (target.role === "master") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Não é possível excluir outro usuário Master" });
      }

      await rawExec("DELETE FROM users WHERE id = ?", [input.userId]);

      await audit({
        userId: ctx.user.id,
        userName: ctx.user.name,
        userRole: ctx.user.role,
        action: "delete_user",
        resource: "user",
        resourceId: String(input.userId),
        description: `Usuário ${target.name} (${target.email}) excluído`,
        oldValue: { name: target.name, email: target.email, role: target.role },
        ipAddress: getIpFromCtx(ctx),
      });

      return { success: true };
    }),

  /** Lista logs de auditoria (MASTER only) */
  auditLogs: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().default(50),
      action: z.string().optional(),
      resource: z.string().optional(),
      userId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (!hasMinRole(ctx.user.role, "master")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas o Master pode ver a auditoria" });
      }

      const offset = (input.page - 1) * input.pageSize;
      const conditions: string[] = [];
      const params: any[] = [];

      if (input.action) { conditions.push("action = ?"); params.push(input.action); }
      if (input.resource) { conditions.push("resource = ?"); params.push(input.resource); }
      if (input.userId) { conditions.push("userId = ?"); params.push(input.userId); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const [countResult] = await rawQuery(`SELECT COUNT(*) as total FROM audit_logs ${where}`, params);
      const total = (countResult as any).total;

      const logs = await rawQuery(
        `SELECT * FROM audit_logs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
        [...params, input.pageSize, offset]
      );

      return { logs, total, page: input.page, pageSize: input.pageSize };
    }),

  /** Retorna estatísticas de auditoria para o painel (MASTER only) */
  auditStats: protectedProcedure.query(async ({ ctx }) => {
    if (!hasMinRole(ctx.user.role, "master")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Apenas o Master pode ver estatísticas de auditoria" });
    }
    const stats = await rawQuery(
      `SELECT action, COUNT(*) as count FROM audit_logs
       WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY action ORDER BY count DESC LIMIT 10`
    );
    const recentFailures = await rawQuery(
      `SELECT * FROM audit_logs WHERE status = 'failure' ORDER BY createdAt DESC LIMIT 5`
    );
    return { topActions: stats, recentFailures };
  }),
});
