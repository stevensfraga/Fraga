/**
 * Gerador: Criar e Enviar Boleto de R$ 240,00 - R7 GERADORES LTDA
 * Cria um boleto de R$ 240,00 em atraso e envia via WhatsApp
 */

import { getDb } from "../db";
import { clients, receivables } from "../../drizzle/schema";
import axios from "axios";
import { formatTemplate, getCollectionTemplate } from "../collectionRuleTemplates";

export async function createAndSendR7Boleto240() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 GERADOR: R7 GERADORES LTDA - Criar e Enviar Boleto R$ 240,00");
  console.log("=".repeat(80));

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // 1. Buscar cliente R7 GERADORES
    console.log("\n📝 Passo 1: Buscando cliente R7 GERADORES LTDA...");
    
    const clientResult = await (db as any).execute(
      `SELECT id, name, whatsappNumber FROM clients WHERE name LIKE '%R7%' LIMIT 1`
    );
    
    const clientRows = Array.isArray(clientResult) ? clientResult[0] : clientResult;
    if (!clientRows || !Array.isArray(clientRows) || clientRows.length === 0) {
      throw new Error("Cliente R7 GERADORES não encontrado");
    }

    const client = clientRows[0];
    console.log(`✅ Cliente encontrado: ${client.name} (ID: ${client.id})`);
    console.log(`   WhatsApp: ${client.whatsappNumber}`);

    // 2. Criar boleto de R$ 240,00
    console.log("\n💰 Passo 2: Criando boleto de R$ 240,00...");
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 3); // 3 dias em atraso

    const receivableData = {
      clientId: client.id,
      amount: "240.00",
      dueDate,
      status: "overdue" as const,
      monthsOverdue: 0,
      contaAzulId: `boleto-r7-240-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let receivableId: number;
    try {
      const receivableResult = await db.insert(receivables).values(receivableData);
      const resultHeader = Array.isArray(receivableResult) ? receivableResult[0] : receivableResult;
      receivableId = resultHeader.insertId || (receivableResult as any).insertId;
      
      if (!receivableId) {
        throw new Error("Falha ao criar boleto - insertId não retornado");
      }
    } catch (error: any) {
      console.error("[DEBUG] Erro ao inserir boleto:", error.message);
      throw error;
    }

    console.log(`✅ Boleto criado:`);
    console.log(`   ID: ${receivableId}`);
    console.log(`   Valor: R$ 240,00`);
    console.log(`   Status: overdue`);
    console.log(`   Vencimento: ${dueDate.toLocaleDateString("pt-BR")}`);

    // 3. Preparar mensagem WhatsApp
    console.log("\n📱 Passo 3: Preparando mensagem WhatsApp com boleto...");
    
    const template = getCollectionTemplate("d_plus_3");
    if (!template) throw new Error("Template não encontrado");

    const boletoLink = `https://boleto.contaazul.com/r7-geradores-${receivableData.contaAzulId}`;
    
    const variables = {
      clientName: "R7 GERADORES",
      dueDate: dueDate.toLocaleDateString("pt-BR"),
      paymentLink: boletoLink,
      companyName: "Fraga Contabilidade",
      amount: "240.00",
      daysOverdue: 3,
    };

    let whatsappMessage = formatTemplate(template.whatsappTemplate, variables);
    whatsappMessage += `\n\n🔗 Boleto: ${boletoLink}`;
    
    console.log(`\n📤 Mensagem a enviar:`);
    console.log(`${whatsappMessage}`);

    // 4. Enviar via WhatsApp
    console.log("\n🚀 Passo 4: Enviando mensagem WhatsApp...");
    
    const result = await sendWhatsAppMessage({
      phone: client.whatsappNumber,
      message: whatsappMessage,
      clientName: client.name,
      clientId: client.id.toString(),
    });

    if (result.success) {
      console.log(`✅ Mensagem enviada com sucesso!`);
      console.log(`   Message ID: ${result.messageId}`);
      console.log(`   Timestamp: ${result.timestamp.toLocaleString("pt-BR")}`);
    } else {
      console.log(`⚠️ Erro ao enviar mensagem:`);
      console.log(`   ${result.error}`);
    }

    // 5. Resumo final
    console.log("\n" + "=".repeat(80));
    console.log("✅ TESTE CONCLUÍDO");
    console.log("=".repeat(80));
    console.log(`
Cliente: ${client.name}
WhatsApp: ${client.whatsappNumber}

Boleto:
  ID: ${receivableId}
  Valor: R$ 240,00
  Status: overdue
  Vencimento: ${dueDate.toLocaleDateString("pt-BR")}
  Link: ${boletoLink}

Mensagem:
  Estágio: D+3 (Aviso de Pendência)
  Status: ${result.success ? "✅ Enviada" : "❌ Falha"}
  Message ID: ${result.messageId || "N/A"}

${result.success ? "✅ Boleto enviado com sucesso!" : "❌ Falha ao enviar boleto"}
    `);

    return {
      success: result.success,
      clientId: client.id,
      receivableId,
      messageResult: result,
    };
  } catch (error: any) {
    console.error("\n❌ ERRO NO TESTE:", error.message);
    throw error;
  }
}

/**
 * Enviar mensagem WhatsApp
 */
async function sendWhatsAppMessage(params: {
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
      console.warn("[ZapContábil] API key não configurada");
      return {
        success: false,
        error: "API key do ZapContábil não configurada. Configure WHATSAPP_API_KEY nas variáveis de ambiente.",
        timestamp: new Date(),
      };
    }

    // Formatar número para padrão internacional
    const formattedPhone = formatPhoneNumber(params.phone);

    console.log(`[ZapContábil] Enviando mensagem para ${formattedPhone}`);

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

    console.log(`[ZapContábil] Response status: ${response.status}`);

    if (response.status === 200 || response.data.success) {
      console.log(`[ZapContábil] Mensagem enviada com sucesso para ${params.clientName}`);

      return {
        success: true,
        messageId: response.data.messageId || response.data.id || response.data.message?.id || "sent",
        timestamp: new Date(),
      };
    } else {
      throw new Error(response.data.error || "Erro desconhecido");
    }
  } catch (error: any) {
    console.error("[ZapContábil] Erro ao enviar mensagem:", error.message);

    if (error.code === "ENOTFOUND") {
      return {
        success: false,
        error: `Não foi possível conectar ao servidor ZapContábil`,
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
createAndSendR7Boleto240()
  .then(() => {
    console.log("\n✅ Teste concluído");
    process.exit(0);
  })
  .catch((error: any) => {
    console.error("\n❌ Erro fatal:", error);
    process.exit(1);
  });
