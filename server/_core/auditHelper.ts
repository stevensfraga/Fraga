/**
 * Helper de Auditoria — registra ações críticas na tabela audit_logs
 *
 * Ações auditadas:
 * - create_user, update_user, delete_user, update_user_role, toggle_user_active
 * - upload_certificate, update_certificate
 * - change_integration
 * - collection_run, collection_manual_send
 */

import mysql from "mysql2/promise";

export interface AuditEntry {
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  description?: string | null;
  oldValue?: object | string | null;
  newValue?: object | string | null;
  ipAddress?: string | null;
  status?: "success" | "failure";
  errorMessage?: string | null;
}

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/**
 * Registra uma entrada de auditoria no banco.
 * Nunca lança exceção — falha silenciosa para não interromper o fluxo principal.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const conn = await getConn();
    try {
      await conn.execute(
        `INSERT INTO audit_logs
         (userId, userName, userRole, action, resource, resourceId, description, oldValue, newValue, ipAddress, status, errorMessage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.userId ?? null,
          entry.userName ?? null,
          entry.userRole ?? null,
          entry.action,
          entry.resource ?? null,
          entry.resourceId ?? null,
          entry.description ?? null,
          entry.oldValue ? JSON.stringify(entry.oldValue) : null,
          entry.newValue ? JSON.stringify(entry.newValue) : null,
          entry.ipAddress ?? null,
          entry.status ?? "success",
          entry.errorMessage ?? null,
        ]
      );
    } finally {
      await conn.end();
    }
  } catch (err) {
    // Falha silenciosa — auditoria nunca deve travar o sistema
    console.error("[Audit] Falha ao registrar auditoria:", err);
  }
}

/** Helper para extrair IP do contexto tRPC */
export function getIpFromCtx(ctx: any): string | null {
  try {
    return ctx?.req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
      || ctx?.req?.socket?.remoteAddress
      || null;
  } catch {
    return null;
  }
}
