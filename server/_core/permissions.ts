/**
 * Sistema de Permissões — Fraga Dashboard
 *
 * Hierarquia de roles (do mais alto ao mais baixo):
 *   MASTER > ADMIN > OPERADOR > VISUALIZADOR > USER
 *
 * MASTER      — controle total: criar/excluir usuários, ver auditoria, alterar integrações
 * ADMIN       — gerenciar empresas, certificados, monitorar integrações, ver alertas
 * OPERADOR    — visualizar e atualizar certificados, acompanhar vencimentos
 * VISUALIZADOR — apenas leitura
 * USER        — acesso mínimo (legado, equivale a VISUALIZADOR)
 */

import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./context";

export type AppRole = "master" | "admin" | "operador" | "visualizador" | "user";

/** Hierarquia numérica: quanto maior, mais permissões */
export const ROLE_LEVEL: Record<AppRole, number> = {
  master: 100,
  admin: 80,
  operador: 60,
  visualizador: 40,
  user: 40, // equivalente a visualizador
};

/** Verifica se um role tem nível >= ao mínimo requerido */
export function hasMinRole(userRole: string | undefined, minRole: AppRole): boolean {
  const level = ROLE_LEVEL[(userRole as AppRole) ?? "user"] ?? 0;
  return level >= ROLE_LEVEL[minRole];
}

/** Verifica se o usuário pode gerenciar (criar/editar/excluir) outro usuário */
export function canManageUser(actorRole: string, targetRole: string): boolean {
  const actorLevel = ROLE_LEVEL[(actorRole as AppRole)] ?? 0;
  const targetLevel = ROLE_LEVEL[(targetRole as AppRole)] ?? 0;
  // Só pode gerenciar usuários com nível MENOR que o seu
  return actorLevel > targetLevel;
}

/** Labels legíveis para exibição */
export const ROLE_LABELS: Record<AppRole, string> = {
  master: "Master",
  admin: "Admin",
  operador: "Operador",
  visualizador: "Visualizador",
  user: "Visualizador",
};

/** Descrições das permissões por role */
export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  master: "Controle total do sistema: criar/excluir usuários, auditoria completa, alterar integrações",
  admin: "Gerenciar empresas, certificados, monitorar integrações e ver alertas",
  operador: "Visualizar e atualizar certificados, acompanhar vencimentos",
  visualizador: "Apenas leitura — sem permissão de alteração",
  user: "Apenas leitura — sem permissão de alteração",
};

/** Roles que podem ser atribuídos por cada role (MASTER pode atribuir qualquer um exceto MASTER) */
export const ASSIGNABLE_ROLES: Record<AppRole, AppRole[]> = {
  master: ["admin", "operador", "visualizador"],
  admin: ["operador", "visualizador"],
  operador: [],
  visualizador: [],
  user: [],
};

// ══════════════════════════════════════════════════════════════════════
// Middleware factories para tRPC
// ══════════════════════════════════════════════════════════════════════

const t = initTRPC.context<TrpcContext>().create();

/** Cria um middleware que exige um role mínimo */
export function requireRole(minRole: AppRole) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Faça login para continuar" });
    }
    if (!hasMinRole(ctx.user.role, minRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permissão insuficiente. Requerido: ${ROLE_LABELS[minRole]}. Seu nível: ${ROLE_LABELS[(ctx.user.role as AppRole) ?? "user"]}`,
      });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}
