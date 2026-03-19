import { TRPCError } from "@trpc/server";
import { getDb } from "./db";

// ============================================================================
// TIPOS
// ============================================================================

export interface AuthContext {
  user: {
    id: number;
    email: string;
    name: string | null;
    role: "user" | "admin" | "master" | "operador" | "visualizador";
    isActive: boolean;
  } | null;
  sessionToken: string | null;
  req?: any;
  res?: any;
}

// ============================================================================
// HELPERS
// ============================================================================

async function getSessionByToken(token: string) {
  try {
    const [rows] = await (await getDb()).execute(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked, u.id, u.email, u.name, u.role, u.isActive
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.revoked = FALSE AND s.expires_at > NOW()`,
      [token]
    );

    return rows?.[0] || null;
  } catch (error) {
    console.error("Erro ao buscar sessão:", error);
    return null;
  }
}

// ============================================================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ============================================================================

export async function createAuthContext(req?: any, res?: any): Promise<AuthContext> {
  const context: AuthContext = {
    user: null,
    sessionToken: null,
    req,
    res,
  };

  try {
    // Extrair token do cookie
    const cookies = req?.headers?.cookie || "";
    const sessionMatch = cookies.match(/session=([^;]+)/);
    const sessionToken = sessionMatch?.[1];

    if (!sessionToken) {
      return context;
    }

    // Buscar sessão no banco
    const session = await getSessionByToken(sessionToken);

    if (!session) {
      return context;
    }

    // Atualizar last_activity_at
    await (await getDb()).execute(
      `UPDATE sessions SET last_activity_at = NOW() WHERE token = ?`,
      [sessionToken]
    );

    // Preparar contexto autenticado
    context.user = {
      id: session.user_id,
      email: session.email,
      name: session.name,
      role: session.role,
      isActive: session.isActive,
    };
    context.sessionToken = sessionToken;
  } catch (error) {
    console.error("Erro ao criar contexto de autenticação:", error);
  }

  return context;
}

// ============================================================================
// MIDDLEWARE DE PROTEÇÃO
// ============================================================================

export function requireAuth(ctx: AuthContext) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Autenticação necessária",
    });
  }

  return ctx.user;
}

export function requireRole(
  ctx: AuthContext,
  ...allowedRoles: Array<"user" | "admin" | "master" | "operador" | "visualizador">
) {
  const user = requireAuth(ctx);

  if (!allowedRoles.includes(user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Permissão insuficiente",
    });
  }

  return user;
}

export function requireMaster(ctx: AuthContext) {
  return requireRole(ctx, "master");
}

export function requireAdmin(ctx: AuthContext) {
  return requireRole(ctx, "master", "admin");
}

export function requireOperador(ctx: AuthContext) {
  return requireRole(ctx, "master", "admin", "operador");
}

// ============================================================================
// PROTEÇÃO DE ROTAS
// ============================================================================

export function protectRoute(requiredRole?: string) {
  return (ctx: AuthContext) => {
    const user = requireAuth(ctx);

    if (requiredRole) {
      const roleHierarchy: Record<string, number> = {
        master: 4,
        admin: 3,
        operador: 2,
        visualizador: 1,
        user: 0,
      };

      const userLevel = roleHierarchy[user.role] || 0;
      const requiredLevel = roleHierarchy[requiredRole] || 0;

      if (userLevel < requiredLevel) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Permissão insuficiente",
        });
      }
    }

    return user;
  };
}
