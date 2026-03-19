/**
 * Gerenciador de reset para clientes com atraso > 60 dias
 * Envia mensagem especial de renegociação
 */

import { getDb } from "./db";
import { collectionSchedule, clients, receivables } from "../drizzle/schema";
import { eq, and, gt } from "drizzle-orm";
import { sendResetEmail } from "./emailService";
import { sendWhatsAppMessage } from "./zapContabilIntegration";

/**
 * Buscar clientes com atraso > 60 dias
 */
export async function getClientsOver60DaysOverdue() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Buscar contas a receber com atraso > 60 dias (2+ meses)
    const overdueReceivables = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.status, "pending"),
          gt(receivables.monthsOverdue, 1)
        )
      );

    // Buscar clientes correspondentes
    const clientsOver60Days = [];
    for (const receivable of overdueReceivables) {
      const client = await db
        .select()
        .from(clients)
        .where(eq(clients.id, receivable.clientId))
        .limit(1);

      if (client.length > 0) {
        clientsOver60Days.push({
          client: client[0],
          receivable: receivable,
        });
      }
    }

    return clientsOver60Days;
  } catch (error: any) {
    console.error("[Reset] Erro ao buscar clientes > 60 dias:", error.message);
    throw error;
  }
}

/**
 * Enviar mensagem de reset para cliente
 */
export async function sendResetMessageToClient(
  clientId: number,
  totalDebt: number
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Buscar cliente
    const clientResult = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!clientResult.length) {
      return {
        success: false,
        message: "Cliente não encontrado",
        error: "Client ID inválido",
      };
    }

    const client = clientResult[0];

    // Enviar e-mail
    if (client.email) {
      await sendResetEmail(client.email, client.name, totalDebt);
      console.log(`[Reset] ✅ E-mail de reset enviado para ${client.name}`);
    }

    // Enviar WhatsApp
    if (client.whatsappNumber) {
      const resetMessage = `Olá ${client.name}! 📢\n\nSua conta está em atraso crítico (mais de 60 dias).\n\nDébito Total: R$ ${totalDebt.toFixed(2)}\n\nPara evitar ações legais, oferecemos a oportunidade de renegociar sua dívida.\n\nPor favor, entre em contato conosco imediatamente.\n\nFraga Contabilidade`;

      await sendWhatsAppMessage({
        phone: client.whatsappNumber,
        message: resetMessage,
        clientName: client.name,
        clientId: client.id.toString(),
      });

      console.log(`[Reset] ✅ WhatsApp de reset enviado para ${client.name}`);
    }

    return {
      success: true,
      message: `Mensagem de reset enviada para ${client.name}`,
    };
  } catch (error: any) {
    console.error("[Reset] ❌ Erro ao enviar mensagem de reset:", error.message);
    return {
      success: false,
      message: "Erro ao enviar mensagem de reset",
      error: error.message,
    };
  }
}

/**
 * Processar todos os clientes > 60 dias
 */
export async function processAllClientsOver60Days(): Promise<{
  processed: number;
  failed: number;
  total: number;
}> {
  try {
    console.log("[Reset] Iniciando processamento de clientes > 60 dias...");

    const clientsOver60 = await getClientsOver60DaysOverdue();

    let processed = 0;
    let failed = 0;

    for (const { client, receivable } of clientsOver60) {
      try {
        const result = await sendResetMessageToClient(
          client.id,
          parseFloat(receivable.amount.toString())
        );

        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`[Reset] Erro ao processar cliente ${client.name}:`, error);
        failed++;
      }
    }

    console.log(
      `[Reset] ✅ Processamento concluído: ${processed} enviados, ${failed} falhados`
    );

    return {
      processed,
      failed,
      total: clientsOver60.length,
    };
  } catch (error: any) {
    console.error("[Reset] ❌ Erro geral ao processar clientes:", error.message);
    return {
      processed: 0,
      failed: 0,
      total: 0,
    };
  }
}

/**
 * Verificar se cliente deve receber mensagem de reset
 */
export function shouldSendResetMessage(monthsOverdue: number): boolean {
  return monthsOverdue > 2;
}

/**
 * Calcular status de reset
 */
export function getResetStatus(monthsOverdue: number): {
  isOverdue: boolean;
  monthsUntilReset: number;
  status: "ok" | "warning" | "critical" | "reset";
} {
  if (monthsOverdue <= 1) {
    return {
      isOverdue: true,
      monthsUntilReset: 1 - monthsOverdue,
      status: "warning",
    };
  } else if (monthsOverdue <= 2) {
    return {
      isOverdue: true,
      monthsUntilReset: 2 - monthsOverdue,
      status: "critical",
    };
  } else {
    return {
      isOverdue: true,
      monthsUntilReset: 0,
      status: "reset",
    };
  }
}
