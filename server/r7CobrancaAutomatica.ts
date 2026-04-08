/**
 * Função Inteligente de Cobrança Automática R7 Geradores
 * 
 * Funcionalidades:
 * - Busca boletos reais do Conta Azul (status OPEN/OVERDUE)
 * - Filtra apenas cliente R7 Geradores
 * - Envia mensagem WhatsApp personalizada
 * - Registra auditoria de envio
 * - Trata erros e exceções
 * - Retorna relatório de sucesso/falha
 */

import { getDb } from "./db";
import { collectionMessages } from "../drizzle/schema";
import { format, parseISO } from "date-fns";
import { sendCollectionMessage } from "./whatsappIntegration";
import { getValidAccessToken } from "./contaAzulOAuthManager";
import axios from "axios";

interface BoletoContaAzul {
  id: string;
  amount: number;
  due_date: string;
  status: string;
  customer: {
    name: string;
    whatsapp_number?: string;
    phone?: string;
  };
  bank_slip?: {
    url: string;
  };
}

interface CobrancaResult {
  success: boolean;
  totalBoletos: number;
  enviados: number;
  falhas: number;
  detalhes: Array<{
    boletoId: string;
    cliente: string;
    valor: string;
    vencimento: string;
    status: "enviado" | "falha";
    motivo?: string;
  }>;
}

/**
 * Busca boletos reais do Conta Azul para R7 Geradores
 */
async function buscarBoletosR7(): Promise<BoletoContaAzul[]> {
  try {
    const token = await getValidAccessToken();
    
    if (!token) {
      throw new Error("Token OAuth inválido. Reautorize via UI.");
    }

    const response = await axios.get(
      "https://api.contaazul.com/v1/financial/receivables",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        params: {
          status: "OPEN,OVERDUE",
          include: "bank_slip,customer",
          limit: 100,
        },
      }
    );

    // Filter only R7 Geradores
    const boletos = response.data.items || [];
    const r7Boletos = boletos.filter(
      (b: BoletoContaAzul) =>
        b.customer?.name?.toUpperCase().includes("R7") &&
        b.customer?.name?.toUpperCase().includes("GERADORES")
    );

    console.log(`[R7 Cobrança] ✅ Encontrados ${r7Boletos.length} boletos para R7 Geradores`);
    return r7Boletos;
  } catch (error: any) {
    console.error(
      `[R7 Cobrança] ❌ Erro ao buscar boletos: ${error.message}`
    );
    throw error;
  }
}

/**
 * Envia mensagem WhatsApp para um boleto
 */
async function enviarMensagemBoleto(boleto: BoletoContaAzul): Promise<{
  sucesso: boolean;
  motivo?: string;
  messageId?: string;
}> {
  try {
    // Validar dados obrigatórios
    if (!boleto.customer?.whatsapp_number) {
      return {
        sucesso: false,
        motivo: "Número de WhatsApp não cadastrado",
      };
    }

    if (!boleto.bank_slip?.url) {
      return {
        sucesso: false,
        motivo: "Link do boleto não disponível",
      };
    }

    // Formatar dados
    const valor = parseFloat(boleto.amount.toString()).toFixed(2);
    const vencimento = format(parseISO(boleto.due_date), "dd/MM/yyyy");
    const isVencido = boleto.status === "OVERDUE";

    // Preparar mensagem personalizada
    const messageData = {
      phoneNumber: boleto.customer.whatsapp_number,
      customerName: boleto.customer.name,
      amount: parseFloat(boleto.amount.toString()),
      dueDate: vencimento,
      invoiceNumber: boleto.id,
      bankSlipUrl: boleto.bank_slip.url,
    };

    console.log(
      `[R7 Cobrança] 📱 Enviando para ${boleto.customer.name} (${boleto.customer.whatsapp_number})`
    );

    // Enviar via WhatsApp
    const result = await sendCollectionMessage(messageData);

    if (!result.success) {
      return {
        sucesso: false,
        motivo: result.error || "Erro desconhecido ao enviar mensagem",
      };
    }

    return {
      sucesso: true,
      messageId: result.messageId,
    };
  } catch (error: any) {
    return {
      sucesso: false,
      motivo: error.message,
    };
  }
}

/**
 * Registra auditoria do envio
 */
async function registrarAuditoria(
  db: any,
  boleto: BoletoContaAzul,
  resultado: { sucesso: boolean; messageId?: string; motivo?: string }
): Promise<void> {
  try {
    const valor = parseFloat(boleto.amount.toString()).toFixed(2);
    const vencimento = format(parseISO(boleto.due_date), "dd/MM/yyyy");

    console.log(
      `[R7 Cobrança] 📝 Registrando auditoria: ${boleto.customer.name} - R$ ${valor}`
    );

    // Inserir na tabela collectionMessages
    await db.insert(collectionMessages).values({
      cnpj: "21.918.918/0001-94", // R7 Geradores CNPJ
      messageType: "friendly",
      messageTemplate: `Olá ${boleto.customer.name}! Seu boleto de R$ ${valor} venceu em ${vencimento}. Clique aqui para pagar: ${boleto.bank_slip?.url || "N/A"}`,
      messageSent: `Olá ${boleto.customer.name}! Seu boleto de R$ ${valor} venceu em ${vencimento}. Clique aqui para pagar: ${boleto.bank_slip?.url || "N/A"}`,
      status: resultado.sucesso ? "sent" : "failed",
      sentAt: new Date(),
    });

    console.log(`[R7 Cobrança] ✅ Auditoria registrada com sucesso`);
  } catch (error: any) {
    console.error(`[R7 Cobrança] ⚠️  Erro ao registrar auditoria: ${error.message}`);
  }
}

/**
 * Função principal: Executa cobrança automática para R7 Geradores
 */
export async function runR7CobrancaAutomatica(): Promise<CobrancaResult> {
  const db = await getDb();
  const resultado: CobrancaResult = {
    success: false,
    totalBoletos: 0,
    enviados: 0,
    falhas: 0,
    detalhes: [],
  };

  try {
    console.log("\n[R7 Cobrança] 🚀 Iniciando cobrança automática para R7 Geradores...\n");

    // 1️⃣ Buscar boletos
    const boletos = await buscarBoletosR7();
    resultado.totalBoletos = boletos.length;

    if (boletos.length === 0) {
      console.log("[R7 Cobrança] ℹ️  Nenhum boleto encontrado para R7 Geradores");
      resultado.success = true;
      return resultado;
    }

    // 2️⃣ Processar cada boleto
    for (const boleto of boletos) {
      const valor = parseFloat(boleto.amount.toString()).toFixed(2);
      const vencimento = format(parseISO(boleto.due_date), "dd/MM/yyyy");

      console.log(
        `\n[R7 Cobrança] 📋 Processando boleto: R$ ${valor} - Vencimento ${vencimento}`
      );

      // Enviar mensagem
      const envioResult = await enviarMensagemBoleto(boleto);

      if (envioResult.sucesso) {
        resultado.enviados++;
        console.log(`[R7 Cobrança] ✅ Mensagem enviada com sucesso`);

        resultado.detalhes.push({
          boletoId: boleto.id,
          cliente: boleto.customer.name,
          valor: `R$ ${valor}`,
          vencimento,
          status: "enviado",
        });
      } else {
        resultado.falhas++;
        console.log(`[R7 Cobrança] ❌ Falha no envio: ${envioResult.motivo}`);

        resultado.detalhes.push({
          boletoId: boleto.id,
          cliente: boleto.customer.name,
          valor: `R$ ${valor}`,
          vencimento,
          status: "falha",
          motivo: envioResult.motivo,
        });
      }

      // Registrar auditoria
      await registrarAuditoria(db, boleto, envioResult);
    }

    resultado.success = true;

    // 3️⃣ Relatório final
    console.log(`\n${"=".repeat(70)}`);
    console.log(`[R7 Cobrança] 📊 RELATÓRIO FINAL`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Total de boletos processados: ${resultado.totalBoletos}`);
    console.log(`✅ Enviados com sucesso: ${resultado.enviados}`);
    console.log(`❌ Falhas: ${resultado.falhas}`);
    console.log(
      `Taxa de sucesso: ${((resultado.enviados / resultado.totalBoletos) * 100).toFixed(1)}%`
    );
    console.log(`${"=".repeat(70)}\n`);

    return resultado;
  } catch (error: any) {
    console.error(`[R7 Cobrança] 💥 Erro crítico: ${error.message}`);
    resultado.success = false;
    return resultado;
  }
}

/**
 * Função auxiliar para executar manualmente (para testes)
 */
export async function testR7Cobranca() {
  try {
    const resultado = await runR7CobrancaAutomatica();
    console.log("\n[R7 Cobrança] 🎉 Teste concluído!");
    console.log(JSON.stringify(resultado, null, 2));
    return resultado;
  } catch (error: any) {
    console.error("[R7 Cobrança] Erro no teste:", error);
    throw error;
  }
}
