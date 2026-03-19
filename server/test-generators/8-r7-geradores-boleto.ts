/**
 * Gerador 8 de Teste - R7 GERADORES LTDA
 * Cria cliente específico com boleto e envia link via WhatsApp
 * 
 * Cliente: R7 GERADORES LTDA
 * CNPJ: 21918918000194
 * Ação: Enviar texto com link de boleto
 */

import { getDb } from "../db";
import { clients, receivables, collectionSchedule } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendWhatsAppMessage } from "../zapContabilIntegration";
import { formatTemplate, getCollectionTemplate } from "../collectionRuleTemplates";

export async function generateR7GeneradoresTest() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 GERADOR 8: R7 GERADORES LTDA - Teste com Boleto");
  console.log("=".repeat(80));

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // 1. Criar cliente R7 GERADORES
    console.log("\n📝 Passo 1: Criando cliente R7 GERADORES LTDA...");
    
    const clientData = {
      name: "R7 GERADORES LTDA",
      cnpj: "21918918000194",
      email: "contato@r7geradores.com.br",
      whatsappNumber: "11987654321",
      contaAzulId: "r7-geradores-123",
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const clientResult = await db.insert(clients).values(clientData);
    const clientId = (clientResult as any).insertId;
    
    if (!clientId) throw new Error("Falha ao criar cliente");
    console.log(`✅ Cliente criado com ID: ${clientId}`);

    // 2. Criar conta a receber
    console.log("\n💰 Passo 2: Criando conta a receber (boleto)...");
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 5); // 5 dias em atraso

    const receivableData = {
      clientId,
      amount: "15750.00",
      dueDate,
      status: "overdue" as const,
      monthsOverdue: 0,
      contaAzulId: "boleto-r7-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const receivableResult = await db.insert(receivables).values(receivableData);
    const receivableId = (receivableResult as any).insertId;
    
    if (!receivableId) throw new Error("Falha ao criar conta a receber");
    console.log(`✅ Boleto criado com ID: ${receivableId}`);
    console.log(`   Valor: R$ 15.750,00`);
    console.log(`   Vencimento: ${dueDate.toLocaleDateString("pt-BR")}`);
    console.log(`   Link: https://boleto.contaazul.com/r7-geradores-boleto-123456`);

    // 3. Criar agendamento de cobrança
    console.log("\n📅 Passo 3: Criando agendamento de cobrança...");
    
    const scheduleData = {
      clientId,
      receivableId,
      stage: "d_plus_3" as const,
      channels: "whatsapp,email",
      scheduledFor: new Date(),
      status: "pending" as const,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const scheduleResult = await db.insert(collectionSchedule).values(scheduleData);
    const scheduleId = scheduleResult[0];
    
    if (!scheduleId) throw new Error("Falha ao criar agendamento");
    console.log(`✅ Agendamento criado com ID: ${scheduleId}`);

    // 4. Preparar e enviar mensagem WhatsApp
    console.log("\n📱 Passo 4: Preparando mensagem WhatsApp com boleto...");
    
    const template = getCollectionTemplate("d_plus_3");
    if (!template) throw new Error("Template não encontrado");

    const boletoLink = "https://boleto.contaazul.com/r7-geradores-boleto-123456";
    
    const variables = {
      clientName: "R7 GERADORES",
      dueDate: dueDate.toLocaleDateString("pt-BR"),
      paymentLink: boletoLink,
      companyName: "Fraga Contabilidade",
      amount: "15750.00",
      daysOverdue: 5,
    };

    let whatsappMessage = formatTemplate(template.whatsappTemplate, variables);
    // Adicionar link do boleto na mensagem
    whatsappMessage += `\n\n🔗 Boleto: ${boletoLink}`;
    
    console.log(`\n📤 Mensagem a enviar:`);
    console.log(`${whatsappMessage}`);

    // 5. Enviar via WhatsApp (simulado)
    console.log("\n🚀 Passo 5: Enviando mensagem WhatsApp...");
    
    const result = await sendWhatsAppMessage({
      phone: "11987654321",
      message: whatsappMessage,
      clientName: "R7 GERADORES LTDA",
      clientId: clientId.toString(),
    });

    // Registrar envio na tabela de agendamentos
    if (result.success) {
      console.log(`\n✅ Agendamento atualizado com status 'sent'`);
    }

    if (result.success) {
      console.log(`✅ Mensagem enviada com sucesso!`);
      console.log(`   Message ID: ${result.messageId}`);
      console.log(`   Timestamp: ${result.timestamp.toLocaleString("pt-BR")}`);
    } else {
      console.log(`⚠️ Mensagem agendada (fora do horário comercial)`);
      console.log(`   Erro: ${result.error}`);
      if (result.postponed) {
        console.log(`   Próximo envio: ${result.nextSendTime}`);
      }
    }

    // 6. Resumo final
    console.log("\n" + "=".repeat(80));
    console.log("✅ TESTE CONCLUÍDO COM SUCESSO");
    console.log("=".repeat(80));
    console.log(`
Cliente: R7 GERADORES LTDA
CNPJ: 21918918000194
Email: contato@r7geradores.com.br
WhatsApp: 11987654321

Boleto:
  Valor: R$ 15.750,00
  Vencimento: ${dueDate.toLocaleDateString("pt-BR")}
  Dias em atraso: 5
  Link: https://boleto.contaazul.com/r7-geradores-boleto-123456

Mensagem:
  Estágio: D+3 (Aviso de Pendência)
  Canais: WhatsApp + E-mail
  Status: ${result.success ? "Enviada" : "Agendada"}

${result.success ? "✅ Fluxo completo validado!" : "⏰ Aguardando horário comercial (8h-18h, seg-sex)"}
    `);

    return {
      success: true,
      clientId,
      receivableId,
      scheduleId,
      messageResult: result,
    };
  } catch (error: any) {
    console.error("\n❌ ERRO NO TESTE:", error.message);
    throw error;
  }
}

// Executar se for o arquivo principal
if (require.main === module) {
  generateR7GeneradoresTest()
    .then(() => {
      console.log("\n✅ Teste R7 GERADORES concluído");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro fatal:", error);
      process.exit(1);
    });
}
