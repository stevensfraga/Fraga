/**
 * Scheduler de Cobrança Automática
 * 
 * Executa runR7CobrancaAutomatica() em horários específicos:
 * - 09:00 (início do expediente)
 * - 15:00 (meio da tarde)
 * 
 * Apenas em dias úteis (segunda a sexta)
 * Apenas em horário comercial (8h-18h)
 */

import * as cron from "node-cron";
import { runR7CobrancaAutomatica } from "./r7CobrancaAutomatica";

let collectionScheduler: ReturnType<typeof cron.schedule> | null = null;

/**
 * Inicializa o scheduler de cobrança automática
 */
export function initCollectionScheduler() {
  if (collectionScheduler) {
    console.log("[Scheduler] ⚠️  Scheduler já está ativo");
    return;
  }

  // Cron: 0 9,15 * * 1-5
  // Significa: 09:00 e 15:00, todos os dias, segunda a sexta
  collectionScheduler = cron.schedule("0 9,15 * * 1-5", async () => {
    console.log("\n" + "=".repeat(70));
    console.log("[Scheduler] 🚀 Iniciando cobrança automática agendada");
    console.log("=".repeat(70) + "\n");

    try {
      const resultado = await runR7CobrancaAutomatica();

      console.log("\n" + "=".repeat(70));
      console.log("[Scheduler] ✅ Cobrança agendada concluída");
      console.log("=".repeat(70));
      console.log(`Total de boletos: ${resultado.totalBoletos}`);
      console.log(`Enviados: ${resultado.enviados}`);
      console.log(`Falhas: ${resultado.falhas}`);
      console.log(
        `Taxa de sucesso: ${((resultado.enviados / resultado.totalBoletos) * 100).toFixed(1)}%`
      );
      console.log("=".repeat(70) + "\n");
    } catch (error: any) {
      console.error("[Scheduler] ❌ Erro na execução agendada:", error.message);
    }
  });

  console.log("[Scheduler] ✅ Scheduler de cobrança iniciado");
  console.log("[Scheduler] 📅 Horários: 09:00 e 15:00 (seg-sex)");
}

/**
 * Para o scheduler de cobrança automática
 */
export function stopCollectionScheduler() {
  if (collectionScheduler) {
    collectionScheduler.stop();
    collectionScheduler = null;
    console.log("[Scheduler] ⏹️  Scheduler de cobrança parado");
  }
}

/**
 * Retorna status do scheduler
 */
export function getSchedulerStatus() {
  return {
    ativo: collectionScheduler !== null,
    horarios: ["09:00", "15:00"],
    diasSemana: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"],
  };
}

/**
 * Executa cobrança manualmente (para testes)
 */
export async function executeCollectionNow() {
  console.log("\n[Scheduler] 🧪 Executando cobrança manual...\n");
  try {
    const resultado = await runR7CobrancaAutomatica();
    return resultado;
  } catch (error: any) {
    console.error("[Scheduler] ❌ Erro na execução manual:", error.message);
    throw error;
  }
}
