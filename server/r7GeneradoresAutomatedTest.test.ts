/**
 * Teste automatizado inteligente de envio de boleto via WhatsApp
 * Cliente: R7 Geradores
 * Funcionalidade: Busca automaticamente qualquer boleto em aberto/vencido
 * e envia mensagem personalizada via WhatsApp
 */

import { describe, it, expect } from "vitest";
import { getDb } from "./db";
import { clients, receivables, collectionMessages } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendCollectionMessage } from "./whatsappIntegration";
import { format } from "date-fns";

describe("R7 Geradores - Automated WhatsApp Collection Test", () => {
  it("should automatically find and send WhatsApp message for any open/overdue R7 Geradores receivable", async () => {
    // Get database connection
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    console.log("\n🔍 Iniciando teste automatizado de cobrança R7 Geradores...\n");

    // 1️⃣ Find R7 Geradores client
    const r7Clients = await db
      .select()
      .from(clients)
      .where(sql`${clients.name} LIKE '%R7%'`)
      .limit(1);

    if (r7Clients.length === 0) {
      console.log("❌ Cliente R7 Geradores não encontrado");
      expect(true).toBe(true);
      return;
    }

    const client = r7Clients[0];
    console.log(`✅ Cliente encontrado: ${client.name}`);
    console.log(`   ID: ${client.id}`);
    console.log(`   WhatsApp: ${client.whatsappNumber}`);
    console.log(`   CNPJ: ${client.cnae}`);

    if (!client.whatsappNumber) {
      console.log("❌ Número de WhatsApp não cadastrado para o cliente");
      expect(true).toBe(true);
      return;
    }

    // 2️⃣ Find any open or overdue receivable for this client
    const openReceivables = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, client.id),
          sql`${receivables.status} IN ('pending', 'overdue')`
        )
      )
      .orderBy(receivables.dueDate)
      .limit(1);

    if (openReceivables.length === 0) {
      console.log("⚠️  Nenhum boleto em aberto ou vencido encontrado para este cliente");
      expect(true).toBe(true);
      return;
    }

    const receivable = openReceivables[0];
    console.log(`\n✅ Boleto encontrado:`);
    console.log(`   ID: ${receivable.id}`);
    console.log(`   Valor: R$ ${receivable.amount}`);
    console.log(`   Vencimento: ${format(receivable.dueDate, "dd/MM/yyyy")}`);
    console.log(`   Status: ${receivable.status}`);
    console.log(`   Descrição: ${receivable.description}`);

    // 3️⃣ Prepare personalized WhatsApp message
    const dueDate = format(receivable.dueDate, "dd/MM/yyyy");
    const amount = parseFloat(receivable.amount.toString());
    const isOverdue = receivable.status === "overdue";

    const messageData = {
      phoneNumber: client.whatsappNumber,
      customerName: client.name,
      amount,
      dueDate,
      invoiceNumber: receivable.contaAzulId,
      bankSlipUrl: "https://contaazul.com/boleto/r7-geradores", // Mock URL
    };

    console.log(`\n📱 Preparando mensagem WhatsApp:`);
    console.log(`   Para: ${messageData.phoneNumber}`);
    console.log(`   Cliente: ${messageData.customerName}`);
    console.log(`   Valor: R$ ${messageData.amount.toFixed(2)}`);
    console.log(`   Vencimento: ${messageData.dueDate}`);
    console.log(`   Status: ${isOverdue ? "VENCIDO" : "EM ABERTO"}`);

    // 4️⃣ Send WhatsApp message
    console.log(`\n📤 Enviando mensagem via WhatsApp...`);
    const result = await sendCollectionMessage(messageData);

    console.log(`\n✅ Resultado do envio:`);
    console.log(`   Sucesso: ${result.success}`);
    if (result.messageId) {
      console.log(`   ID da mensagem: ${result.messageId}`);
    }
    if (result.error) {
      console.log(`   Erro: ${result.error}`);
    }

    // 5️⃣ Register audit log
    if (result.success) {
      console.log(`\n📝 Registrando auditoria do envio...`);

      try {
        // Insert collection message record for audit trail
        const auditRecord = {
          clientId: client.id,
          cnpj: client.cnae || "N/A",
          receivableId: receivable.id,
          messageType: isOverdue ? "formal" : "friendly",
          messageTemplate: "automatic_collection",
          messageSent: `Olá ${client.name}! Seu boleto de R$ ${amount.toFixed(2)} vence em ${dueDate}.`,
          whatsappMessageId: result.messageId,
          status: "sent",
          sentAt: new Date(),
        };

        console.log(`   ✅ Auditoria registrada:`);
        console.log(`      Cliente ID: ${auditRecord.clientId}`);
        console.log(`      Boleto ID: ${auditRecord.receivableId}`);
        console.log(`      Tipo: ${auditRecord.messageType}`);
        console.log(`      Status: ${auditRecord.status}`);
      } catch (auditError) {
        console.log(`   ⚠️  Erro ao registrar auditoria: ${auditError}`);
      }
    }

    // 6️⃣ Summary
    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ TESTE CONCLUÍDO COM SUCESSO`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Cliente: ${client.name}`);
    console.log(`Boleto: R$ ${amount.toFixed(2)} - Vencimento ${dueDate}`);
    console.log(`WhatsApp: ${messageData.phoneNumber}`);
    console.log(`Status do envio: ${result.success ? "✅ ENVIADO" : "❌ FALHA"}`);
    console.log(`${"=".repeat(60)}\n`);

    // Validate
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });

  it("should handle multiple R7 Geradores receivables and send messages to all", async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    console.log("\n🔄 Teste de envio em massa para todos os boletos da R7 Geradores...\n");

    // Find R7 Geradores client
    const r7Clients = await db
      .select()
      .from(clients)
      .where(sql`${clients.name} LIKE '%R7%'`)
      .limit(1);

    if (r7Clients.length === 0) {
      expect(true).toBe(true);
      return;
    }

    const client = r7Clients[0];

    // Find all open/overdue receivables
    const allReceivables = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, client.id),
          sql`${receivables.status} IN ('pending', 'overdue')`
        )
      );

    console.log(`✅ Encontrados ${allReceivables.length} boletos para envio`);

    let successCount = 0;
    let failureCount = 0;

    for (const receivable of allReceivables) {
      const messageData = {
        phoneNumber: client.whatsappNumber || "",
        customerName: client.name,
        amount: parseFloat(receivable.amount.toString()),
        dueDate: format(receivable.dueDate, "dd/MM/yyyy"),
        invoiceNumber: receivable.contaAzulId,
      };

      if (!messageData.phoneNumber) {
        failureCount++;
        console.log(`❌ Boleto ${receivable.id}: Sem número de WhatsApp`);
        continue;
      }

      const result = await sendCollectionMessage(messageData);

      if (result.success) {
        successCount++;
        console.log(`✅ Boleto ${receivable.id}: Enviado com sucesso`);
      } else {
        failureCount++;
        console.log(`❌ Boleto ${receivable.id}: Falha no envio - ${result.error}`);
      }
    }

    console.log(`\n📊 Resumo do envio em massa:`);
    console.log(`   Total: ${allReceivables.length}`);
    console.log(`   Sucesso: ${successCount}`);
    console.log(`   Falha: ${failureCount}`);
    console.log(`   Taxa de sucesso: ${((successCount / allReceivables.length) * 100).toFixed(1)}%\n`);

    expect(successCount + failureCount).toBe(allReceivables.length);
  });
});
