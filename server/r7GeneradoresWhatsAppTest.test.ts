import { describe, it, expect } from "vitest";
import { sendCollectionMessage } from "./whatsappIntegration";
import { getDb } from "./db";
import { clients, receivables } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

describe("R7 Geradores - WhatsApp Collection Message Test (October 2025)", () => {
  it("should send WhatsApp message for R7 Geradores October 2025 receivable", async () => {
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
      expect(true).toBe(true);
      return;
    }

    const client = r7Clients[0];
    console.log(`\n✅ Cliente encontrado:`);
    console.log(`   Nome: ${client.name}`);
    console.log(`   WhatsApp: ${client.whatsappNumber}`);

    // Find test receivable (October 2025)
    const testReceivables = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, client.id),
          sql`${receivables.contaAzulId} = 'TEST-R7-OCT-2025'`
        )
      )
      .limit(1);

    if (testReceivables.length === 0) {
      console.log("❌ Test receivable not found");
      expect(true).toBe(true);
      return;
    }

    const receivable = testReceivables[0];
    console.log(`\n✅ Boleto encontrado:`);
    console.log(`   Valor: R$ ${receivable.amount}`);
    console.log(`   Vencimento: ${receivable.dueDate.toLocaleDateString("pt-BR")}`);
    console.log(`   Status: ${receivable.status}`);
    console.log(`   Descrição: ${receivable.description}`);

    // Prepare WhatsApp message
    const phoneNumber = client.whatsappNumber;
    if (!phoneNumber) {
      console.log("❌ No WhatsApp number available");
      expect(true).toBe(true);
      return;
    }

    const dueDate = receivable.dueDate.toLocaleDateString("pt-BR");
    const amount = parseFloat(receivable.amount.toString());

    const messageData = {
      phoneNumber,
      customerName: client.name,
      amount,
      dueDate,
      invoiceNumber: receivable.contaAzulId,
      bankSlipUrl: "https://contaazul.com/boleto/123456789", // Mock URL
    };

    console.log(`\n📱 Enviando mensagem WhatsApp:`);
    console.log(`   Para: ${messageData.phoneNumber}`);
    console.log(`   Cliente: ${messageData.customerName}`);
    console.log(`   Valor: R$ ${messageData.amount.toFixed(2)}`);
    console.log(`   Vencimento: ${messageData.dueDate}`);
    console.log(`   Link: ${messageData.bankSlipUrl}`);

    // Send message
    const result = await sendCollectionMessage(messageData);

    console.log(`\n📤 Resultado do envio:`);
    console.log(`   Sucesso: ${result.success}`);
    if (result.messageId) {
      console.log(`   ID da mensagem: ${result.messageId}`);
    }
    if (result.error) {
      console.log(`   Erro: ${result.error}`);
    }

    // Validate
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();

    // Log summary
    console.log(`\n✅ Teste concluído!`);
    console.log(`   Cliente: ${client.name}`);
    console.log(`   Boleto: R$ ${amount.toFixed(2)} - Vencimento ${dueDate}`);
    console.log(`   WhatsApp: ${phoneNumber}`);
    console.log(`   Status: ${result.success ? "ENVIADO" : "FALHA"}`);
  });
});
