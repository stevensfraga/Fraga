/**
 * Gerador: Enviar Boleto de R$ 240,00 - R7 GERADORES LTDA
 * Busca o boleto de R$ 240,00 em aberto e envia via WhatsApp
 */

import { getDb } from "../db";
import axios from "axios";
import { formatTemplate, getCollectionTemplate } from "../collectionRuleTemplates";

export async function sendR7Boleto240() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 GERADOR: R7 GERADORES LTDA - Envio de Boleto R$ 240,00");
  console.log("=".repeat(80));

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // 1. Buscar cliente R7 GERADORES
    console.log("\n📝 Passo 1: Buscando cliente R7 GERADORES LTDA...");
    
    // Usar SQL direto para buscar cliente
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

    // 2. Buscar qualquer boleto em aberto
    console.log("\n💰 Passo 2: Buscando boleto em aberto...");
    
    const receivableResult = await (db as any).execute(
      `SELECT id, amount, status, dueDate, contaAzulId FROM receivables 
       WHERE clientId = ${client.id} AND status != 'paid' 
       ORDER BY amount ASC
       LIMIT 1`
    );
    
    const receivableRows = Array.isArray(receivableResult) ? receivableResult[0] : receivableResult;
    if (!receivableRows || !Array.isArray(receivableRows) || receivableRows.length === 0) {
      throw new Error("Nenhum boleto em aberto encontrado para R7 GERADORES");
    }

    const receivable = receivableRows[0];
    const dueDate = new Date(receivable.dueDate);
    
    console.log(`✅ Boleto encontrado:`);
    console.log(`   ID: ${receivable.id}`);
    console.log(`   Valor: R$ ${receivable.amount}`);
    console.log(`   Status: ${receivable.status}`);
    console.log(`   Vencimento: ${dueDate.toLocaleDateString("pt-BR")}`);
    
    // Se for R$ 240,00, ótimo! Se não, avisa
    if (receivable.amount !== '240.00') {
      console.log(`\n⚠️  Nota: O boleto encontrado é de R$ ${receivable.amount}, não R$ 240,00`);
    }

    // 3. Preparar mensagem WhatsApp
    console.log("\n📱 Passo 3: Preparando mensagem WhatsApp com boleto...");
    
    const template = getCollectionTemplate("d_plus_3");
    if (!template) throw new Error("Template não encontrado");

    const boletoLink = `https://boleto.contaazul.com/r7-geradores-${receivable.contaAzulId}`;
    
    const variables = {
      clientName: "R7 GERADORES",
      dueDate: dueDate.toLocaleDateString("pt-BR"),
      paymentLink: boletoLink,
      companyName: "Fraga Contabilidade",
      amount: receivable.amount,
      daysOverdue: Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24)),
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
  ID: ${receivable.id}
  Valor: R$ ${receivable.amount}
  Status: ${receivable.status}
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
      receivableId: receivable.id,
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
sendR7Boleto240()
  .then(() => {
    console.log("\n✅ Teste concluído");
    process.exit(0);
  })
  .catch((error: any) => {
    console.error("\n❌ Erro fatal:", error);
    process.exit(1);
  });
