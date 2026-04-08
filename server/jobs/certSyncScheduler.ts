import cron from "node-cron";
import { syncCertificatesFromWindows } from "./syncCertificatesFromWindows.js";

let syncInProgress = false;
let lastSyncResult: any = null;

export function initCertSyncScheduler() {
  // Executar a cada 10 minutos
  const task = cron.schedule("*/10 * * * *", async () => {
    if (syncInProgress) {
      console.log("[CertSyncScheduler] Sincronização anterior ainda em andamento, pulando...");
      return;
    }

    syncInProgress = true;
    try {
      console.log("[CertSyncScheduler] Iniciando sincronização agendada...");
      lastSyncResult = await syncCertificatesFromWindows();
      console.log("[CertSyncScheduler] ✅ Sincronização concluída com sucesso");
    } catch (error) {
      console.error("[CertSyncScheduler] ❌ Erro na sincronização:", (error as any).message);
      lastSyncResult = {
        status: "failed",
        error: (error as any).message,
        timestamp: new Date().toISOString(),
      };
    } finally {
      syncInProgress = false;
    }
  });

  console.log("[CertSyncScheduler] ✅ Scheduler de sincronização iniciado (a cada 10 minutos)");
  return task;
}

export function getSyncStatus() {
  return {
    inProgress: syncInProgress,
    lastResult: lastSyncResult,
    nextRun: "próximos 10 minutos",
  };
}

export function isSyncInProgress() {
  return syncInProgress;
}

export function getLastSyncResult() {
  return lastSyncResult;
}
