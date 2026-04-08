/**
 * Gerador 8 FORCE - R7 GERADORES LTDA (Força envio imediato)
 * Cria cliente específico com boleto e FORÇA envio de mensagem WhatsApp
 * Ignora validação de horário comercial para teste imediato
 * 
 * Cliente: R7 GERADORES LTDA
 * CNPJ: 21918918000194
 * Ação: Enviar texto com link de boleto AGORA
 */

import { getDb } from "../db";
import { clients, receivables, collectionSchedule } from "../../drizzle/schema";
import axios from "axios";
import { formatTemplate, getCollectionTemplate } from "../collectionRuleTemplates";

export async function generateR7GeneradoresForcedTest() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 GERADOR 8 FORCE: R7 GERADORES LTDA - Envio Forçado de Boleto");
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
      contaAzulId: `r7-geradores-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let clientId: number;
    try {
      const clientResult = await db.insert(clients).values(clientData);
      // Drizzle com MySQL retorna um array [ResultSetHeader, undefined]
      const resultHeader = Array.isArray(clientResult) ? clientResult[0] : clientResult;
      clientId = resultHeader.insertId || (clientResult as any).insertId;
      
      if (!clientId) {
        console.error("[DEBUG] clientResult:", clientResult);
        throw new Error("Falha ao criar cliente - insertId não retornado");
      }
    } catch (error: any) {
      console.error("[DEBUG] Erro ao inserir cliente:", error.message);
      throw error;
    }
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
      contaAzulId: `boleto-r7-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const receivableResult = await db.insert(receivables).values(receivableData);
    const resultHeader = Array.isArray(receivableResult) ? receivableResult[0] : receivableResult;
    const receivableId = resultHeader.insertId || (receivableResult as any).insertId;
    
    if (!receivableId) throw new Error("Falha ao criar conta a receber");
    console.log(`✅ Boleto criado com ID: ${receivableId}`);
    console.log(`   Valor: R$ 15.750,00`);
    console.log(`   Vencimento: ${dueDate.toLocaleDateString("pt-BR")}`);
    console.log(`   Link: https://boleto.contaazul.com/r7-geradores-boleto-123456`);

    // 3. Preparar mensagem WhatsApp
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
    // Adicionar link do boleto na mensagem
    whatsappMessage += `\n\n🔗 Boleto: ${boletoLink}`;
    
    console.log(`\n📤 Mensagem a enviar:`);
    console.log(`${whatsappMessage}`);

    // 4. FORÇAR envio via WhatsApp (ignorando horário comercial)
    console.log("\n🚀 Passo 4: FORÇANDO envio de mensagem WhatsApp (ignorando horário comercial)...");
    
    const result = await sendWhatsAppMessageForced({
      phone: "11987654321",
      message: whatsappMessage,
      clientName: "R7 GERADORES LTDA",
      clientId: clientId.toString(),
    });

    if (result.success) {
      console.log(`✅ Mensagem enviada com sucesso!`);
      console.log(`   Message ID: ${result.messageId}`);
      console.log(`   Timestamp: ${result.timestamp.toLocaleString("pt-BR")}`);
    } else {
      console.log(`❌ Erro ao enviar mensagem:`);
      console.log(`   ${result.error}`);
    }

    // 5. Resumo final
    console.log("\n" + "=".repeat(80));
    console.log("✅ TESTE CONCLUÍDO");
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
  Status: ${result.success ? "✅ Enviada" : "❌ Falha"}

${result.success ? "✅ Boleto enviado com sucesso!" : "❌ Falha ao enviar boleto"}
    `);

    return {
      success: result.success,
      clientId,
      receivableId,
      messageResult: result,
    };
  } catch (error: any) {
    console.error("\n❌ ERRO NO TESTE:", error.message);
    throw error;
  }
}

/**
 * Enviar mensagem WhatsApp FORÇADAMENTE (ignorando horário comercial)
 */
async function sendWhatsAppMessageForced(params: {
  phone: string;
  message: string;
  clientName: string;
  clientId: string;
}): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}> {
  try {
    const ZAP_API_URL = "https://api-fraga.zapcontabil.chat";
    const ZAP_API_KEY = process.env.WHATSAPP_API_KEY || "";

    if (!ZAP_API_KEY) {
      console.warn("[ZapContábil FORCE] API key não configurada");
      return {
        success: false,
        error: "API key do ZapContábil não configurada. Configure WHATSAPP_API_KEY nas variáveis de ambiente.",
        timestamp: new Date(),
      };
    }

    // Formatar número para padrão internacional
    const formattedPhone = formatPhoneNumber(params.phone);

    console.log(`[ZapContábil FORCE] Enviando mensagem para ${formattedPhone}`);
    console.log(`[ZapContábil FORCE] Mensagem: ${params.message}`);

    // Endpoint: POST /api/send/{numeroEnviar}
    const endpoint = `${ZAP_API_URL}/api/send/${formattedPhone}`;

    const response = await axios.post(
      endpoint,
      {
        body: params.message,
        connectionFrom: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        timeout: 10000,
      }
    );

    console.log(
      `[ZapContábil FORCE] Response status: ${response.status}`,
      response.data
    );

    if (response.status === 200 || response.data.success) {
      console.log(
        `[ZapContábil FORCE] Mensagem enviada com sucesso para ${params.clientName}`
      );

      return {
        success: true,
        messageId: response.data.messageId || response.data.id || "sent",
        timestamp: new Date(),
      };
    } else {
      throw new Error(response.data.error || "Erro desconhecido");
    }
  } catch (error: any) {
    console.error(
      "[ZapContábil FORCE] Erro ao enviar mensagem:",
      error.message,
      error.response?.data
    );

    if (error.code === "ENOTFOUND") {
      return {
        success: false,
        error: `Não foi possível conectar ao servidor ZapContábil (${error.hostname})`,
        timestamp: new Date(),
      };
    }

    return {
      success: false,
      error: error.message || "Falha ao enviar mensagem WhatsApp",
      timestamp: new Date(),
    };
  }
}

/**
 * Formatar número de telefone para padrão internacional
 */
function formatPhoneNumber(phone: string): string {
  // Remove caracteres especiais
  const cleaned = phone.replace(/\D/g, "");

  // Se começa com 55 (código do Brasil), retorna como está
  if (cleaned.startsWith("55")) {
    return cleaned;
  }

  // Se começa com 0, remove
  if (cleaned.startsWith("0")) {
    return "55" + cleaned.substring(1);
  }

  // Caso contrário, adiciona 55
  return "55" + cleaned;
}

// Executar se for o arquivo principal
generateR7GeneradoresForcedTest()
  .then(() => {
    console.log("\n✅ Teste R7 GERADORES FORCE concluído");
    process.exit(0);
  })
  .catch((error: any) => {
    console.error("\n❌ Erro fatal:", error);
    process.exit(1);
  });
