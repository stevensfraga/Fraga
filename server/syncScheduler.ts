/**
 * 🔄 Sync Scheduler — Sincronização Diária do Conta Azul
 *
 * Responsabilidades:
 * 1. Agendar sync diário (06:50 seg-sex, America/Sao_Paulo)
 * 2. Chamar executeFullSync() do contaAzulDataSync
 * 3. Gravar tentativa + resultado na sync_cursor SEMPRE (sucesso ou falha)
 * 4. Expor startSyncScheduler / stopSyncScheduler / runSyncNow
 */

import * as cron from "node-cron";
import { getDb } from "./db";
import { syncCursor } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Constantes ──────────────────────────────────────────────────────────────

const SYNC_TYPE = "receivables_full" as const;
const CRON_EXPR = "0 50 6 * * 1-5"; // 06:50 seg-sex
const TIMEZONE = "America/Sao_Paulo";

// ─── Estado em memória ───────────────────────────────────────────────────────

let cronTask: ReturnType<typeof cron.schedule> | null = null;
let isRunning = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calcula a próxima execução do cron a partir de agora (America/Sao_Paulo)
 * Cron: 06:50 seg-sex
 */
export function calcNextRunAt(): Date {
  const now = new Date();
  // Converter para SP
  const spNow = new Date(
    now.toLocaleString("en-US", { timeZone: TIMEZONE })
  );

  const candidate = new Date(spNow);
  candidate.setHours(6, 50, 0, 0);

  // Se já passou das 06:50 hoje, avançar para o próximo dia útil
  if (spNow >= candidate) {
    candidate.setDate(candidate.getDate() + 1);
  }

  // Pular fins de semana
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }

  // Converter de volta para UTC
  const spOffset = -3 * 60; // UTC-3 (sem DST — Brasil aboliu DST)
  const utcMs = candidate.getTime() - spOffset * 60 * 1000;
  return new Date(utcMs);
}

/**
 * Grava tentativa na sync_cursor (upsert por syncType)
 */
async function persistSyncResult(
  status: "success" | "partial" | "failed",
  result: Record<string, unknown>
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    const nextRunAt = calcNextRunAt();

    // Verificar se já existe registro
    const [existing] = await db
      .select({ id: syncCursor.id })
      .from(syncCursor)
      .where(eq(syncCursor.syncType, SYNC_TYPE))
      .limit(1);

    if (existing) {
      await db
        .update(syncCursor)
        .set({
          lastSyncAt: now,
          nextSyncAt: nextRunAt,
          lastStatus: status,
          lastResult: JSON.stringify(result),
          updatedAt: now,
        })
        .where(eq(syncCursor.syncType, SYNC_TYPE));
    } else {
      await db.insert(syncCursor).values({
        syncType: SYNC_TYPE,
        lastSyncAt: now,
        nextSyncAt: nextRunAt,
        lastStatus: status,
        lastResult: JSON.stringify(result),
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err: any) {
    console.error("[SyncScheduler] Erro ao persistir resultado:", err?.message);
  }
}

// ─── Execução principal ───────────────────────────────────────────────────────

/**
 * Executa o sync completo e persiste o resultado na sync_cursor
 */
export async function runSyncNow(): Promise<{
  success: boolean;
  clientsSynced: number;
  receivablesSynced: number;
  durationMs: number;
  error?: string;
}> {
  if (isRunning) {
    console.log("[SyncScheduler] ⚠️ Sync já em andamento, pulando");
    return { success: false, clientsSynced: 0, receivablesSynced: 0, durationMs: 0, error: "already_running" };
  }

  isRunning = true;
  const startedAt = Date.now();
  console.log("[SyncScheduler] 🔄 Iniciando sync completo do Conta Azul...");

  try {
    const { executeFullSync } = await import("./contaAzulDataSync");
    const result = await executeFullSync();

    const durationMs = Date.now() - startedAt;
    const status = result.success ? "success" : "failed";

    await persistSyncResult(status, {
      clientsSynced: result.clientsSynced,
      receivablesSynced: result.receivablesSynced,
      errors: result.errors,
      durationMs,
    });

    console.log(
      `[SyncScheduler] ✅ Sync concluído em ${durationMs}ms — ` +
      `clientes: ${result.clientsSynced}, recebíveis: ${result.receivablesSynced}, ` +
      `erros: ${result.errors.length}`
    );

    return {
      success: result.success,
      clientsSynced: result.clientsSynced,
      receivablesSynced: result.receivablesSynced,
      durationMs,
      error: result.errors.length > 0 ? result.errors[0] : undefined,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const errorMsg = err?.message || "Unknown error";

    console.error("[SyncScheduler] ❌ Erro no sync:", errorMsg);

    // Gravar falha na sync_cursor SEMPRE
    await persistSyncResult("failed", {
      error: errorMsg,
      durationMs,
    });

    return { success: false, clientsSynced: 0, receivablesSynced: 0, durationMs, error: errorMsg };
  } finally {
    isRunning = false;
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Iniciar cron scheduler de sync (06:50 seg-sex, America/Sao_Paulo)
 */
export function startSyncScheduler(): void {
  if (cronTask) {
    console.log("[SyncScheduler] ⚠️ Scheduler já está rodando");
    return;
  }

  cronTask = cron.schedule(
    CRON_EXPR,
    async () => {
      console.log("[SyncScheduler] ⏰ Trigger: 06:50 seg-sex — iniciando sync");
      await runSyncNow();
    },
    { timezone: TIMEZONE }
  );

  console.log(`[SyncScheduler] ✅ Iniciado (${CRON_EXPR} = 06:50 seg-sex, ${TIMEZONE})`);
}

/**
 * Parar cron scheduler
 */
export function stopSyncScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[SyncScheduler] ⏹️ Scheduler parado");
  }
}

/**
 * Retorna metadados do scheduler para o endpoint de status
 */
export function getSyncSchedulerMeta() {
  return {
    cronExpr: CRON_EXPR,
    timezone: TIMEZONE,
    isRunning,
    schedulerActive: cronTask !== null,
    nextRunAt: calcNextRunAt(),
  };
}
