/**
 * Gerenciador de webhooks de pagamento do Conta Azul
 * Processa notificações de pagamento e cancela a régua de cobrança
 */

import { getDb } from "./db";
import {
  contaAzulWebhooks,
  paymentHistory,
  collectionSchedule,
  clients,
  receivables,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { sendPaymentConfirmationEmail } from "./emailService";
import { sendWhatsAppMessage } from "./zapContabilIntegration";

interface WebhookPayload {
  id: string; // Webhook ID do Conta Azul
  event: string; // "payment.received", etc
  data: {
    receivable_id?: string;
    amount?: number;
    payment_date?: string;
    payment_method?: string;
  };
}

/**
 * Validar assinatura HMAC-SHA256 do webhook
 */
export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return signature === expectedSignature;
  } catch (error) {
    console.error("[Webhook] Erro ao validar assinatura:", error);
    return false;
  }
}

/**
 * Processar webhook de pagamento
 */
export async function processPaymentWebhook(
  webhookPayload: WebhookPayload
): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) {
    return {
      success: false,
      message: "Database not available",
      error: "Database connection failed",
    };
  }

  try {
    console.log("[Webhook] Processando webhook de pagamento:", webhookPayload.id);

    // 1. Verificar se webhook já foi processado
    const existingWebhook = await db
      .select()
      .from(contaAzulWebhooks)
      .where(eq(contaAzulWebhooks.webhookId, webhookPayload.id))
      .limit(1);

    if (existingWebhook.length > 0) {
      console.log("[Webhook] ⚠️ Webhook duplicado:", webhookPayload.id);
      return {
        success: true,
        message: "Webhook já processado (duplicado)",
      };
    }

    // 2. Buscar a conta a receber
    const receivableId = webhookPayload.data.receivable_id;
    if (!receivableId) {
      throw new Error("receivable_id não fornecido no webhook");
    }

    const receivable = await db
      .select()
      .from(receivables)
      .where(eq(receivables.contaAzulId, receivableId))
      .limit(1);

    if (!receivable.length) {
      console.warn("[Webhook] ⚠️ Conta a receber não encontrada:", receivableId);
      return {
        success: false,
        message: "Conta a receber não encontrada",
        error: `receivable_id ${receivableId} não existe no sistema`,
      };
    }

    const rec = receivable[0];

    // 3. Buscar o cliente
    const client = await db
      .select()
      .from(clients)
      .where(eq(clients.id, rec.clientId))
      .limit(1);

    if (!client.length) {
      throw new Error("Cliente não encontrado");
    }

    const clientData = client[0];

    // 4. Registrar webhook
    const webhookRecord = await db.insert(contaAzulWebhooks).values({
      webhookId: webhookPayload.id,
      eventType: webhookPayload.event,
      payload: JSON.stringify(webhookPayload),
      receivableId: rec.id,
      clientId: rec.clientId,
      amountPaid: webhookPayload.data.amount
        ? webhookPayload.data.amount.toString()
        : undefined,
      paymentDate: webhookPayload.data.payment_date
        ? new Date(webhookPayload.data.payment_date)
        : new Date(),
      status: "received",
    });

    console.log("[Webhook] ✅ Webhook registrado:", webhookPayload.id);

    // 5. Buscar agendamentos pendentes da régua de cobrança
    const pendingSchedules = await db
      .select()
      .from(collectionSchedule)
      .where(
        and(
          eq(collectionSchedule.receivableId, rec.id),
          eq(collectionSchedule.status, "pending")
        )
      );

    console.log(
      `[Webhook] Encontrados ${pendingSchedules.length} agendamentos pendentes`
    );

    // 6. Cancelar agendamentos pendentes
    let cancelledCount = 0;
    for (const schedule of pendingSchedules) {
      await db
        .update(collectionSchedule)
        .set({
          status: "cancelled",
          cancelledReason: "Pagamento recebido",
          cancelledAt: new Date(),
        })
        .where(eq(collectionSchedule.id, schedule.id));

      cancelledCount++;
    }

    console.log(`[Webhook] ✅ ${cancelledCount} agendamentos cancelados`);

    // 7. Registrar histórico de pagamento
    // Nota: webhookRecord retorna um array com insertId, mas Drizzle retorna o ID diferente
    // Vamos buscar o webhook que acabamos de criar
    const createdWebhook = await db
      .select()
      .from(contaAzulWebhooks)
      .where(eq(contaAzulWebhooks.webhookId, webhookPayload.id))
      .limit(1);

    await db.insert(paymentHistory).values({
      receivableId: rec.id,
      clientId: rec.clientId,
      webhookId: createdWebhook.length > 0 ? createdWebhook[0].id : undefined,
      amountPaid: webhookPayload.data.amount
        ? webhookPayload.data.amount.toString()
        : "0",
      paymentDate: webhookPayload.data.payment_date
        ? new Date(webhookPayload.data.payment_date)
        : new Date(),
      paymentMethod: webhookPayload.data.payment_method || "unknown",
      collectionScheduleCancelled: cancelledCount > 0,
      cancelledSchedules: cancelledCount,
      notificationSent: false,
    });

    // 8. Atualizar status do webhook como processado
    await db
      .update(contaAzulWebhooks)
      .set({
        status: "processed",
        processedAt: new Date(),
      })
      .where(eq(contaAzulWebhooks.webhookId, webhookPayload.id));

    // 9. Enviar notificacao ao cliente sobre cancelamento
    if (cancelledCount > 0 && clientData.email) {
      try {
        const paymentDateStr = webhookPayload.data.payment_date
          ? new Date(webhookPayload.data.payment_date).toLocaleDateString("pt-BR")
          : new Date().toLocaleDateString("pt-BR");

        // Enviar e-mail
        await sendPaymentConfirmationEmail(
          clientData.email,
          clientData.name,
          webhookPayload.data.amount || 0,
          paymentDateStr
        );

        // Enviar WhatsApp se houver numero
        if (clientData.whatsappNumber) {
          const whatsappMessage = `Ola ${clientData.name}! Confirmamos o recebimento do seu pagamento no valor de R$ ${(webhookPayload.data.amount || 0).toFixed(2)}. Sua conta foi regularizada. Obrigado!`;
          await sendWhatsAppMessage({
            phone: clientData.whatsappNumber,
            message: whatsappMessage,
            clientName: clientData.name,
            clientId: clientData.id.toString(),
          });
        }

        console.log(
          `[Webhook] ✅ Notificacoes enviadas ao cliente ${clientData.name}`
        );
      } catch (notificationError: any) {
        console.warn(
          `[Webhook] ⚠️ Erro ao enviar notificacoes:`,
          notificationError.message
        );
      }
    }

    console.log(
      `[Webhook] ✅ Webhook processado com sucesso para cliente: ${clientData.name}`
    );

    return {
      success: true,
      message: `Pagamento processado. ${cancelledCount} mensagens de cobranca canceladas. Notificacao enviada ao cliente.`,
    };
  } catch (error: any) {
    console.error("[Webhook] ❌ Erro ao processar webhook:", error.message);

    // Registrar erro no webhook
    try {
      await db
        .update(contaAzulWebhooks)
        .set({
          status: "failed",
          error: error.message,
          processedAt: new Date(),
        })
        .where(eq(contaAzulWebhooks.webhookId, webhookPayload.id));
    } catch {
      // Ignorar erro ao registrar erro
    }

    return {
      success: false,
      message: "Erro ao processar webhook",
      error: error.message,
    };
  }
}

/**
 * Buscar histórico de pagamentos de um cliente
 */
export async function getClientPaymentHistory(clientId: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const payments = await db
      .select()
      .from(paymentHistory)
      .where(eq(paymentHistory.clientId, clientId));

    return payments;
  } catch (error: any) {
    console.error("[Webhook] Erro ao buscar histórico de pagamentos:", error.message);
    throw error;
  }
}

/**
 * Buscar webhooks não processados
 */
export async function getFailedWebhooks() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const webhooks = await db
      .select()
      .from(contaAzulWebhooks)
      .where(eq(contaAzulWebhooks.status, "failed"));

    return webhooks;
  } catch (error: any) {
    console.error("[Webhook] Erro ao buscar webhooks falhados:", error.message);
    throw error;
  }
}

/**
 * Buscar estatísticas de webhooks
 */
export async function getWebhookStats() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const allWebhooks = await db.select().from(contaAzulWebhooks);
    const processedWebhooks = allWebhooks.filter((w) => w.status === "processed");
    const failedWebhooks = allWebhooks.filter((w) => w.status === "failed");
    const duplicateWebhooks = allWebhooks.filter((w) => w.status === "duplicate");

    return {
      total: allWebhooks.length,
      processed: processedWebhooks.length,
      failed: failedWebhooks.length,
      duplicate: duplicateWebhooks.length,
      successRate: allWebhooks.length > 0
        ? ((processedWebhooks.length / allWebhooks.length) * 100).toFixed(2) + "%"
        : "0%",
    };
  } catch (error: any) {
    console.error("[Webhook] Erro ao buscar estatísticas:", error.message);
    throw error;
  }
}
