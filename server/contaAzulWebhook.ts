import { Router } from "express";
import { getDb } from "./db";
import { contaAzulWebhooks } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendCollectionMessage } from "./whatsappIntegration";

const router = Router();

/**
 * Webhook endpoint for Conta Azul events
 * Receives notifications when invoices, charges, or other financial events occur
 */
router.post("/webhook/conta-azul", async (req, res) => {
  try {
    const { event, data, timestamp } = req.body;

    // Log incoming webhook
    console.log(`[Webhook] Conta Azul event received: ${event} at ${timestamp}`);

    // Validate webhook signature (implement Conta Azul signature verification)
    // const signature = req.headers['x-conta-azul-signature'];
    // if (!verifySignature(signature, req.body)) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    // Store webhook event in database
    const db = await getDb();
    if (db) {
      await db.insert(contaAzulWebhooks).values({
        webhookId: `${event}-${Date.now()}`,
        eventType: event,
        payload: JSON.stringify(data),
        status: "received",
        createdAt: new Date(),
      });
    }

    // Handle specific event types
    switch (event) {
      case "invoice.created":
      case "invoice.updated":
        await handleInvoiceEvent(data);
        break;

      case "charge.created":
      case "charge.updated":
        await handleChargeEvent(data);
        break;

      case "financial.receivable.created":
      case "financial.receivable.updated":
        await handleReceivableEvent(data);
        break;

      default:
        console.log(`[Webhook] Unknown event type: ${event}`);
    }

    // Mark webhook as processed
    const db2 = await getDb();
    if (db2) {
      await db2
        .update(contaAzulWebhooks)
        .set({ status: "processed" })
        .where(eq(contaAzulWebhooks.eventType, event));
    }

    res.json({ success: true, message: "Webhook processed" });
  } catch (error) {
    console.error("[Webhook] Error processing webhook:", error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

/**
 * Handle invoice events
 * Triggered when invoices are created or updated
 */
async function handleInvoiceEvent(data: any) {
  console.log(`[Webhook] Processing invoice event:`, data.id);

  // TODO: Extract invoice data and trigger WhatsApp message
  // - Get customer phone number
  // - Format invoice details
  // - Send WhatsApp message via API
}

/**
 * Handle charge events
 * Triggered when charges/payments are created or updated
 */
async function handleChargeEvent(data: any) {
  console.log(`[Webhook] Processing charge event:`, data.id);

  try {
    // Extract charge data
    const phoneNumber = data.customer?.phone || data.phoneNumber;
    const customerName = data.customer?.name || data.customerName || "Cliente";
    const amount = data.amount || data.value || 0;
    const dueDate = data.dueDate || data.vencimento || new Date();
    const invoiceNumber = data.chargeId || data.id;

    if (!phoneNumber) {
      console.warn(`[Webhook] ⚠️ Telefone não encontrado para cobrança ${data.id}`);
      return;
    }

    // Send WhatsApp message
    const result = await sendCollectionMessage({
      phoneNumber,
      customerName,
      amount,
      dueDate: dueDate.toString(),
      invoiceNumber: invoiceNumber.toString(),
    });

    if (result.success) {
      console.log(`[Webhook] ✅ Mensagem WhatsApp enviada para ${phoneNumber}`);
    } else {
      console.error(`[Webhook] ❌ Erro ao enviar WhatsApp: ${result.error}`);
    }
  } catch (error) {
    console.error(`[Webhook] ❌ Erro ao processar charge:`, error);
  }
}

/**
 * Handle receivable events
 * Triggered when financial receivables are created or updated
 */
async function handleReceivableEvent(data: any) {
  console.log(`[Webhook] Processing receivable event:`, data.id);

  try {
    // Extract receivable data
    const phoneNumber = data.customer?.phone || data.phoneNumber;
    const customerName = data.customer?.name || data.customerName || "Cliente";
    const amount = data.amount || data.value || 0;
    const dueDate = data.dueDate || data.vencimento || new Date();
    const bankSlipUrl = data.bank_slip?.url || data.bankSlipUrl;
    const invoiceNumber = data.invoice?.number || data.invoiceNumber || data.id;

    if (!phoneNumber) {
      console.warn(`[Webhook] ⚠️ Telefone não encontrado para boleto ${data.id}`);
      return;
    }

    // Send WhatsApp message
    const result = await sendCollectionMessage({
      phoneNumber,
      customerName,
      amount,
      dueDate: dueDate.toString(),
      bankSlipUrl,
      invoiceNumber: invoiceNumber.toString(),
    });

    if (result.success) {
      console.log(`[Webhook] ✅ Mensagem WhatsApp enviada para ${phoneNumber}`);
    } else {
      console.error(`[Webhook] ❌ Erro ao enviar WhatsApp: ${result.error}`);
    }
  } catch (error) {
    console.error(`[Webhook] ❌ Erro ao processar receivable:`, error);
  }
}

export default router;
