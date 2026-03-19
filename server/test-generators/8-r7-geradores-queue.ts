/**
 * Gerador 8 QUEUE - R7 GERADORES LTDA (Usa Fila de Mensagens)
 * Cria cliente e boleto, e enfileira mensagem para visualizar no dashboard
 * 
 * Cliente: R7 GERADORES LTDA
 * CNPJ: 21918918000194
 * Ação: Enfileirar mensagem com link de boleto
 */

import { getDb } from "../db";
import { clients, receivables, messageQueue } from "../../drizzle/schema";
import { formatTemplate, getCollectionTemplate } from "../collectionRuleTemplates";

export async function generateR7GeneradoresQueueTest() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 GERADOR 8 QUEUE: R7 GERADORES LTDA - Fila de Mensagens");
  console.log("=".repeat(80));

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // 1. Criar cliente R7 GERADORES
    console.log("\n📝 Passo 1: Criando cliente R7 GERADORES LTDA...");
    
    const clientData = {
      name: "R7 GERADORES LTDA",
      contaAzulId: "r7-geradores-queue-123",
      email: "contato@r7geradores.com.br",
      phone: "1133334444",
      whatsappNumber: "11987654321",
      cnae: "2821100",
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
      contaAzulId: "boleto-r7-queue-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const receivableResult = await db.insert(receivables).values(receivableData);
    const receivableId = (receivableResult as any).insertId;
    
    if (!receivableId) throw new Error("Falha ao criar conta a receber");
    console.log(`✅ Boleto criado com ID: ${receivableId}`);
    console.log(`   Valor: R$ 15.750,00`);
    console.log(`   Vencimento: ${dueDate.toLocaleDateString("pt-BR")}`);

    // 3. Preparar mensagem
    console.log("\n📱 Passo 3: Preparando mensagem WhatsApp com boleto...");
    
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
    whatsappMessage += `\n\n🔗 Boleto: ${boletoLink}`;
    
    console.log(`\n📤 Mensagem a enfileirar:`);
    console.log(`${whatsappMessage}`);

    // 4. Enfileirar mensagem
    console.log("\n📋 Passo 4: Enfileirando mensagem na fila...");
    
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + 5 * 60 * 1000); // Agendar para 5 minutos depois

    const queueData = {
      clientId,
      receivableId,
      messageType: "whatsapp" as const,
      status: "pending" as const,
      stage: "d_plus_3",
      phone: "11987654321",
      body: whatsappMessage,
      scheduledFor,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const queueResult = await db.insert(messageQueue).values(queueData);
    const messageId = (queueResult as any).insertId;

    if (!messageId) throw new Error("Falha ao enfileirar mensagem");
    console.log(`✅ Mensagem enfileirada com ID: ${messageId}`);
    console.log(`   Status: Pendente`);
    console.log(`   Agendado para: ${scheduledFor.toLocaleString("pt-BR")}`);
    console.log(`   Tentativas: 0/${queueData.maxRetries}`);

    // 5. Resumo
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

Mensagem Enfileirada:
  ID: ${messageId}
  Tipo: WhatsApp
  Estágio: D+3 (Aviso de Pendência)
  Status: Pendente
  Agendado para: ${scheduledFor.toLocaleString("pt-BR")}

📊 Próximas ações:
1. Abra o dashboard de cobrança para visualizar a mensagem enfileirada
2. Clique em "Enviar Agora" para simular o envio
3. Visualize o histórico de mensagens no dashboard

✅ Mensagem pronta para envio!
    `);

    return {
      success: true,
      clientId,
      receivableId,
      messageId,
    };
  } catch (error: any) {
    console.error("\n❌ ERRO NO TESTE:", error.message);
    throw error;
  }
}

// Executar se for o arquivo principal
if (require.main === module) {
  generateR7GeneradoresQueueTest()
    .then(() => {
      console.log("\n✅ Teste R7 GERADORES QUEUE concluído");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro fatal:", error);
      process.exit(1);
    });
}
