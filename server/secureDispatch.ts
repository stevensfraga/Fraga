/**
 * 🚀 Serviço de Envio Seguro com Logging Detalhado
 * 
 * Dispara o boleto com:
 * - Validação final antes do envio
 * - Chamada ao sendWhatsAppMessage
 * - Registro detalhado no banco (collectionMessages)
 * - Logs estruturados para auditoria
 * - Tratamento de erros robusto
 */

import { getDb } from "./db";
import { collectionMessages, receivables } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { PreparedMessage } from "./messagePreparation";
import { sendWhatsAppMessageViaZapContabil } from "./zapcontabilWhatsApp";

// Wrapper com retry para compatibilidade
async function sendWhatsAppMessageWithRetry(request: any, maxRetries: number = 3, delayMs: number = 5000) {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendWhatsAppMessageViaZapContabil(request);
      if (result.ok) {
        return result;
      }
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
    
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  
  return {
    ok: false,
    providerMessageId: null,
    error: lastError?.message || lastError || 'Max retries exceeded',
  };
}

export interface DispatchLog {
  timestamp: string;
  boletoId: number;
  clientId: number;
  whatsappNumber: string;
  status: "success" | "failure" | "warning";
  message: string;
  details: Record<string, any>;
  errors?: string[];
}

export interface DispatchResult {
  success: boolean;
  messageId?: string | null;
  log: DispatchLog;
  dbRecordId?: number;
  recommendations?: string[];
}

/**
 * Validar horário comercial
 */
export function isBusinessHours(): { allowed: boolean; reason?: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = domingo, 6 = sábado
  const hour = now.getHours();

  // Não enviar nos fins de semana
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      allowed: false,
      reason: `Fim de semana (${dayOfWeek === 0 ? "domingo" : "sábado"}). Envios apenas de seg-sex.`,
    };
  }

  // Validar horário comercial (8h-18h)
  if (hour < 8 || hour >= 18) {
    return {
      allowed: false,
      reason: `Horário fora do comercial (${hour}h). Envios apenas entre 8h-18h.`,
    };
  }

  return { allowed: true };
}

/**
 * Enviar WhatsApp via ZapContu00e1bil
 */
async function sendWhatsAppMessage(
  whatsappNumber: string,
  message: string,
  boletoId: number
): Promise<{
  ok: boolean;
  messageId?: string | null;
  error?: string;
}> {
  try {
    console.log(`[WhatsApp] Enviando para ${whatsappNumber}`);
    console.log(`[WhatsApp] Boleto ID: ${boletoId}`);
    console.log(`[WhatsApp] Tamanho da mensagem: ${message.length} caracteres`);

    // Enviar via ZapContábil
    const result = await sendWhatsAppMessageWithRetry({
      phone: whatsappNumber,
      message,
    });

    return {
      ok: result.ok,
      messageId: result.ok ? result.providerMessageId : undefined,
      error: result.error,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Registrar envio no banco de dados
 */
async function logDispatchToDatabase(
  clientId: number,
  receivableId: number,
  whatsappNumber: string,
  message: string,
  whatsappMessageId: string,
  status: "sent" | "failed",
  error?: string
): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) {
      console.error("[DB] Banco de dados não disponível");
      return null;
    }

    const result = await db.insert(collectionMessages).values({
      clientId,
      cnpj: "", // Será preenchido depois
      receivableId,
      messageType: "friendly",
      messageTemplate: message,
      messageSent: message,
      whatsappMessageId,
      status: status === "sent" ? "sent" : "failed",
      sentAt: new Date(),
    });

    return result[0]?.insertId || null;
  } catch (error) {
    console.error("[DB] Erro ao registrar envio:", error);
    return null;
  }
}

/**
 * Atualizar status do receivable
 */
async function updateReceivableStatus(
  receivableId: number,
  status: "pending" | "overdue" | "paid" | "cancelled"
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      console.error("[DB] Banco de dados não disponível");
      return false;
    }

    await db
      .update(receivables)
      .set({ status, updatedAt: new Date() })
      .where(eq(receivables.id, receivableId));

    return true;
  } catch (error) {
    console.error("[DB] Erro ao atualizar receivable:", error);
    return false;
  }
}

/**
 * Executar envio seguro
 */
export async function executeSecureDispatch(
  clientId: number,
  receivableId: number,
  preparedMessage: PreparedMessage
): Promise<DispatchResult> {
  const startTime = Date.now();
  const log: DispatchLog = {
    timestamp: new Date().toISOString(),
    boletoId: receivableId,
    clientId,
    whatsappNumber: preparedMessage.whatsappNumber,
    status: "failure",
    message: "",
    details: {},
    errors: [],
  };

  try {
    // Etapa 1: Validar horário comercial
    const businessHours = isBusinessHours();
    if (!businessHours.allowed) {
      log.status = "warning";
      log.message = `⚠️ Fora do horário comercial: ${businessHours.reason}`;
      log.details.businessHours = businessHours;

      return {
        success: false,
        log,
        recommendations: ["Agende o envio para horário comercial (8h-18h, seg-sex)"],
      };
    }

    // Etapa 2: Validar mensagem preparada
    if (!preparedMessage.validation.isValid) {
      log.status = "failure";
      log.message = "❌ Mensagem com problemas de validação";
      log.errors = preparedMessage.validation.errors;
      log.details.validation = preparedMessage.validation;

      return {
        success: false,
        log,
      };
    }

    // Etapa 3: Enviar via WhatsApp
    console.log(`[Dispatch] Iniciando envio para ${preparedMessage.whatsappNumber}`);

    const whatsappResult = await sendWhatsAppMessage(
      preparedMessage.whatsappNumber,
      preparedMessage.message,
      receivableId
    );

    if (!whatsappResult.ok) {
      log.status = "failure";
      log.message = `❌ Falha ao enviar via WhatsApp: ${whatsappResult.error}`;
      log.errors = [whatsappResult.error || "Erro desconhecido"];
      log.details.whatsappError = whatsappResult.error;

      // Registrar falha no banco
      const dbRecordId = await logDispatchToDatabase(
        clientId,
        receivableId,
        preparedMessage.whatsappNumber,
        preparedMessage.message,
        "",
        "failed",
        whatsappResult.error
      );

      return {
        success: false,
        log,
        dbRecordId: dbRecordId || undefined,
        recommendations: [
          "Verifique a conexão com WhatsApp",
          "Valide o número do cliente",
          "Tente novamente em alguns minutos",
        ],
      };
    }

    // Etapa 4: Registrar sucesso no banco
    const dbRecordId = await logDispatchToDatabase(
      clientId,
      receivableId,
      preparedMessage.whatsappNumber,
      preparedMessage.message,
      whatsappResult.messageId || "",
      "sent"
    );

    // Etapa 5: Atualizar status do receivable
    const updated = await updateReceivableStatus(receivableId, "pending");

    const duration = Date.now() - startTime;

    log.status = "success";
    log.message = `✅ Boleto enviado com sucesso`;
    log.details = {
      whatsappMessageId: whatsappResult.messageId,
      dbRecordId,
      durationMs: duration,
      amount: preparedMessage.formattedAmount,
      dueDate: preparedMessage.formattedDueDate,
      receivableUpdated: updated,
    };

    return {
      success: true,
      messageId: whatsappResult.messageId,
      log,
      dbRecordId: dbRecordId || undefined,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    log.status = "failure";
    log.message = `❌ Erro inesperado: ${error instanceof Error ? error.message : String(error)}`;
    log.errors = [error instanceof Error ? error.message : String(error)];
    log.details.durationMs = duration;
    log.details.stack = error instanceof Error ? error.stack : undefined;

    return {
      success: false,
      log,
    };
  }
}

/**
 * Formatar log para exibição
 */
export function formatDispatchLogForDisplay(result: DispatchResult): string {
  const lines: string[] = [];
  const log = result.log;

  lines.push("\n📤 LOG DE ENVIO DO BOLETO\n");
  lines.push("=".repeat(60));

  const statusEmoji = log.status === "success" ? "✅" : log.status === "warning" ? "🟡" : "🔴";
  lines.push(`\n${statusEmoji} Status: ${log.status.toUpperCase()}`);
  lines.push(`Timestamp: ${new Date(log.timestamp).toLocaleString("pt-BR")}`);
  lines.push(`Boleto ID: ${log.boletoId}`);
  lines.push(`Cliente ID: ${log.clientId}`);
  lines.push(`WhatsApp: ${log.whatsappNumber}`);

  lines.push("\n📝 MENSAGEM:");
  lines.push("-".repeat(60));
  lines.push(log.message);

  if (log.errors && log.errors.length > 0) {
    lines.push("\n🔴 ERROS:");
    log.errors.forEach((err) => {
      lines.push(`  - ${err}`);
    });
  }

  if (log.details && Object.keys(log.details).length > 0) {
    lines.push("\n📊 DETALHES:");
    lines.push(JSON.stringify(log.details, null, 2));
  }

  if (result.recommendations && result.recommendations.length > 0) {
    lines.push("\n💡 RECOMENDAÇÕES:");
    result.recommendations.forEach((rec) => {
      lines.push(`  - ${rec}`);
    });
  }

  lines.push("\n" + "=".repeat(60));

  if (result.success) {
    lines.push("✅ ENVIO CONCLUÍDO COM SUCESSO");
  } else {
    lines.push("🔴 ENVIO FALHOU - REVISE OS ERROS ACIMA");
  }

  lines.push("=".repeat(60) + "\n");

  return lines.join("\n");
}
