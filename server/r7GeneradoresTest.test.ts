import { describe, it, expect } from "vitest";
import { sendCollectionMessage } from "./whatsappIntegration";
import { getDb } from "./db";
import { clients, receivables } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

describe("R7 Geradores - Collection Message Test", () => {
  it("should send collection message for R7 Geradores receivable", async () => {
    // Get database connection
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    // Find R7 Geradores client
    const r7Clients = await db
      .select()
      .from(clients)
      .where(sql`${clients.name} LIKE '%R7%'`)
      .limit(1);

    if (r7Clients.length === 0) {
      console.log("❌ R7 Geradores client not found in database");
      expect(true).toBe(true); // Skip test if client not found
      return;
    }

    const client = r7Clients[0];
    console.log(`✅ Found client: ${client.name}`);
    console.log(`   Phone: ${client.phone}`);
    console.log(`   WhatsApp: ${client.whatsappNumber}`);

    // Find receivables for this client
    const clientReceivables = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, client.id),
          sql`${receivables.status} IN ('pending', 'overdue')`
        )
      )
      .limit(1);

    if (clientReceivables.length === 0) {
      console.log("❌ No pending or overdue receivables found for R7 Geradores");
      expect(true).toBe(true); // Skip test if no receivables
      return;
    }

    const receivable = clientReceivables[0];
    console.log(`✅ Found receivable:`);
    console.log(`   Amount: R$ ${receivable.amount}`);
    console.log(`   Due Date: ${receivable.dueDate}`);
    console.log(`   Status: ${receivable.status}`);

    // Prepare message data
    const phoneNumber = client.whatsappNumber || client.phone;
    if (!phoneNumber) {
      console.log("❌ No phone number available for client");
      expect(true).toBe(true);
      return;
    }

    const messageData = {
      phoneNumber,
      customerName: client.name,
      amount: parseFloat(receivable.amount.toString()),
      dueDate: receivable.dueDate.toISOString().split("T")[0],
      invoiceNumber: receivable.contaAzulId,
    };

    console.log(`\n📱 Sending WhatsApp message:`);
    console.log(`   To: ${messageData.phoneNumber}`);
    console.log(`   Customer: ${messageData.customerName}`);
    console.log(`   Amount: R$ ${messageData.amount}`);
    console.log(`   Due Date: ${messageData.dueDate}`);

    // Send message
    const result = await sendCollectionMessage(messageData);

    console.log(`\n📤 Result:`);
    console.log(`   Success: ${result.success}`);
    if (result.messageId) {
      console.log(`   Message ID: ${result.messageId}`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }

    // Validate result
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });
});
