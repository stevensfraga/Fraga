/**
 * Job agendado para sincronização de dados com Conta Azul
 * Executa a cada 6 horas
 */

import * as cron from "node-cron";
import { getDb } from "./db";
import { clients, receivables } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// Armazenar referência do job para poder cancelar se necessário
let syncJob: ReturnType<typeof cron.schedule> | null = null;

/**
 * Inicializar job de sincronização
 * Executa a cada 6 horas (0:00, 6:00, 12:00, 18:00)
 */
export function initializeSyncDataJob() {
  // Cancelar job anterior se existir
  if (syncJob) {
    syncJob.stop();
    console.log("[Sync] Job anterior cancelado");
  }

  // Agendar novo job: a cada 6 horas
  syncJob = cron.schedule("0 */6 * * *", async () => {
    console.log("[Sync] ⏰ Iniciando sincronização de dados...");
    try {
      await syncDataWithContaAzul();
    } catch (error: any) {
      console.error("[Sync] ❌ Erro na sincronização:", error.message);
    }
  });

  console.log("[Sync] ✅ Job de sincronização inicializado (a cada 6 horas)");
  return syncJob;
}

/**
 * Sincronizar dados com Conta Azul
 */
export async function syncDataWithContaAzul(): Promise<{
  success: boolean;
  clientsUpdated: number;
  receivablesUpdated: number;
  error?: string;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log("[Sync] 🔄 Sincronizando dados com Conta Azul...");

    // Aqui você integraria com a API do Conta Azul
    // Por enquanto, apenas registramos a execução

    let clientsUpdated = 0;
    let receivablesUpdated = 0;

    // TODO: Implementar chamadas reais à API do Conta Azul
    // const contaAzulClients = await fetchClientsFromContaAzul();
    // const contaAzulReceivables = await fetchReceivablesFromContaAzul();

    // Exemplo de como seria:
    // for (const contaAzulClient of contaAzulClients) {
    //   const existingClient = await db
    //     .select()
    //     .from(clients)
    //     .where(eq(clients.contaAzulId, contaAzulClient.id))
    //     .limit(1);
    //
    //   if (existingClient.length > 0) {
    //     // Atualizar cliente existente
    //     await db
    //       .update(clients)
    //       .set({
    //         name: contaAzulClient.name,
    //         email: contaAzulClient.email,
    //         phone: contaAzulClient.phone,
    //         updatedAt: new Date(),
    //       })
    //       .where(eq(clients.id, existingClient[0].id));
    //     clientsUpdated++;
    //   } else {
    //     // Criar novo cliente
    //     await db.insert(clients).values({
    //       contaAzulId: contaAzulClient.id,
    //       name: contaAzulClient.name,
    //       email: contaAzulClient.email,
    //       phone: contaAzulClient.phone,
    //     });
    //     clientsUpdated++;
    //   }
    // }

    console.log(
      `[Sync] ✅ Sincronização concluída: ${clientsUpdated} clientes, ${receivablesUpdated} contas a receber`
    );

    return {
      success: true,
      clientsUpdated,
      receivablesUpdated,
    };
  } catch (error: any) {
    console.error("[Sync] ❌ Erro ao sincronizar dados:", error.message);
    return {
      success: false,
      clientsUpdated: 0,
      receivablesUpdated: 0,
      error: error.message,
    };
  }
}

/**
 * Parar job de sincronização
 */
export function stopSyncDataJob() {
  if (syncJob) {
    syncJob.stop();
    syncJob = null;
    console.log("[Sync] ⏹️ Job de sincronização parado");
  }
}

/**
 * Obter status do job
 */
export function getSyncJobStatus() {
  return {
    isRunning: syncJob !== null,
    nextExecution: syncJob ? "A cada 6 horas" : "Não agendado",
  };
}

/**
 * Executar sincronização manual
 */
export async function triggerManualSync(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.log("[Sync] 🔄 Sincronização manual acionada");
    const result = await syncDataWithContaAzul();

    return {
      success: result.success,
      message: `Sincronização concluída: ${result.clientsUpdated} clientes, ${result.receivablesUpdated} contas a receber`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Erro na sincronização: ${error.message}`,
    };
  }
}
