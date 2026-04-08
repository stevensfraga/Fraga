/**
 * Pricing Scheduler
 * Roda diariamente às 06:40 (America/Sao_Paulo):
 * 1. Sync empresas do eKontrol
 * 2. Recalcula precificação para todas as empresas ativas
 */
import cron from "node-cron";
import { syncEkontrolCompanies, recalculateAllPricing, detectHonorarioBaseFromReceivables } from "./services/ekontrolService";

let schedulerTask: ReturnType<typeof cron.schedule> | null = null;
let lastRunResult: {
  timestamp: string;
  syncResult: { total: number; synced: number; matched: number; errors: string[] };
  pricingResult: { processed: number; defasados: number; suggestions: number; errors: string[] };
  durationMs: number;
  status: "success" | "error";
  error?: string;
} | null = null;

const CRON_EXPR = "0 40 6 * * 1-5"; // 06:40 seg-sex
const TIMEZONE = "America/Sao_Paulo";

async function runPricingJob(): Promise<typeof lastRunResult> {
  const start = Date.now();
  console.log(`[PricingScheduler] Starting pricing job at ${new Date().toISOString()}`);

  try {
    // Step 1: Sync empresas do eKontrol
    console.log("[PricingScheduler] Step 1: Syncing eKontrol companies...");
    const syncResult = await syncEkontrolCompanies();
    console.log(`[PricingScheduler] Sync complete: ${syncResult.synced}/${syncResult.total} synced, ${syncResult.matched} matched`);

    // Step 1.5: Detectar honorário base via receivables recorrentes
    console.log("[PricingScheduler] Step 1.5: Detecting honorário base from receivables...");
    const honorarioResult = await detectHonorarioBaseFromReceivables();
    console.log(`[PricingScheduler] Honorário base: ${honorarioResult.detected} detected, ${honorarioResult.updated} updated`);

    // Step 2: Recalcular precificação
    console.log("[PricingScheduler] Step 2: Recalculating pricing...");
    const pricingResult = await recalculateAllPricing();
    console.log(`[PricingScheduler] Pricing complete: ${pricingResult.processed} processed, ${pricingResult.defasados} defasados, ${pricingResult.suggestions} suggestions`);

    const durationMs = Date.now() - start;
    lastRunResult = {
      timestamp: new Date().toISOString(),
      syncResult,
      pricingResult,
      durationMs,
      status: "success",
    };

    console.log(`[PricingScheduler] Job completed in ${durationMs}ms`);
    return lastRunResult;
  } catch (e: any) {
    const durationMs = Date.now() - start;
    lastRunResult = {
      timestamp: new Date().toISOString(),
      syncResult: { total: 0, synced: 0, matched: 0, errors: [e.message] },
      pricingResult: { processed: 0, defasados: 0, suggestions: 0, errors: [e.message] },
      durationMs,
      status: "error",
      error: e.message,
    };
    console.error(`[PricingScheduler] Job failed after ${durationMs}ms:`, e.message);
    return lastRunResult;
  }
}

export function startPricingScheduler() {
  if (schedulerTask) {
    console.log("[PricingScheduler] Already running, skipping start");
    return;
  }

  schedulerTask = cron.schedule(CRON_EXPR, () => {
    runPricingJob().catch(console.error);
  }, { timezone: TIMEZONE });

  console.log(`[PricingScheduler] Scheduled: ${CRON_EXPR} (${TIMEZONE})`);
}

export function getPricingSchedulerStatus() {
  return {
    cron: CRON_EXPR,
    timezone: TIMEZONE,
    isRunning: schedulerTask !== null,
    lastRun: lastRunResult,
  };
}

export { runPricingJob };
