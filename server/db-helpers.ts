import { getDb } from "./db";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";

// ============================================================================
// HELPERS DE USUÁRIOS
// ============================================================================

export async function getUserByEmail(email: string) {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Database] Cannot get user: database not available");
      return null;
    }
    
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Error getting user by email:", error);
    return null;
  }
}

export async function getUserById(userId: number) {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Database] Cannot get user: database not available");
      return null;
    }
    
    const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Error getting user by ID:", error);
    return null;
  }
}

// ============================================================================
// HELPERS DE SESSÃO
// ============================================================================

export async function createSession(
  userId: number,
  token: string,
  expiresAt: Date,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    console.log(`[Auth] Creating session for user ${userId}`);
    console.log(`[Auth] Token: ${token.substring(0, 16)}...`);
    console.log(`[Auth] Expires: ${expiresAt}`);
    
    // Aqui você implementará a inserção na tabela sessions
    // Por enquanto, apenas retornar o objeto de sessão
    return {
      userId,
      token,
      expiresAt,
      ipAddress: ipAddress || "",
      userAgent: userAgent || "",
      createdAt: new Date(),
    };
  } catch (error) {
    console.error("[Database] Error creating session:", error);
    return null;
  }
}

export async function getSession(token: string) {
  try {
    console.log(`[Auth] Getting session for token: ${token.substring(0, 16)}...`);
    
    // Aqui você implementará a busca na tabela sessions
    // Por enquanto, apenas retornar null
    return null;
  } catch (error) {
    console.error("[Database] Error getting session:", error);
    return null;
  }
}

export async function revokeSession(token: string) {
  try {
    console.log(`[Auth] Revoking session for token: ${token.substring(0, 16)}...`);
    
    // Aqui você implementará a revogação na tabela sessions
    // Por enquanto, apenas retornar true
    return true;
  } catch (error) {
    console.error("[Database] Error revoking session:", error);
    return false;
  }
}

// ============================================================================
// HELPERS DE AUDITORIA
// ============================================================================

export async function logAudit(
  userId: number | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  status: "sucesso" | "falha",
  details?: object,
  errorMessage?: string,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    console.log(`[Audit] Logging: action=${action}, status=${status}, userId=${userId}`);
    
    // Aqui você implementará a inserção na tabela audit_logs
    // Por enquanto, apenas logar no console
    if (details) {
      console.log(`[Audit] Details: ${JSON.stringify(details)}`);
    }
    if (errorMessage) {
      console.log(`[Audit] Error: ${errorMessage}`);
    }
    
    return true;
  } catch (error) {
    console.error(`[Audit] Error logging audit: ${(error as Error).message}`);
    // Não falhar o login se a auditoria falhar
    return false;
  }
}
