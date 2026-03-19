/**
 * Handler para envio automático de boletos via PLANO B
 * Integra webhook inbound com endpoint E2E existente
 */

import axios from "axios";
import { getDb } from "./db";
import { clients, receivables } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateAndUploadPdf, sendViaPlanoBE2E } from "./boletoFluxo2";

interface ZapWebhookPayload {
  message: {
    id: string;
    body: string;
    ticketId: number;
    contactId: number;
    contact?: {
      id: number;
      name: string;
      number: string;
    };
  };
}

/**
 * Processar pedido de boleto via PLANO B
 * 
 * Pipeline:
 * 1. Extrair ticketId do webhook
 * 2. Buscar clientId pelo número de telefone
 * 3. Buscar receivableId mais recente (em atraso)
 * 4. Buscar filename do PDF no storage Zap (se existir)
 * 5. Chamar endpoint PLANO B E2E
 */
export async function processBoletoViaPlanB(payload: ZapWebhookPayload): Promise<any> {
  const { message } = payload;
  const ticketId = message.ticketId;
  const clientPhone = message.contact?.number || "";
  const clientName = message.contact?.name || "Cliente";
  
  const correlationId = `[#FRAGA:${ticketId}:AUTO:${Date.now()}]`;
  
  console.log(`[BoletoHandlerPlanB] Iniciando processamento ${correlationId}`, {
    ticketId,
    clientPhone,
    clientName,
  });
  
  try {
    // PASSO 1: Buscar cliente pelo telefone
    const db = await getDb();
    if (!db) {
      throw new Error("Database não disponível");
    }
    
    // Normalizar telefone (remover +55, espaços, parênteses)
    const normalizedPhone = clientPhone.replace(/[\s\(\)\-\+]/g, "");
    
    console.log(`[BoletoHandlerPlanB] Buscando cliente com telefone: ${normalizedPhone}`);
    
    const client = await db
      .select()
      .from(clients)
      .where(eq(clients.phone, normalizedPhone))
      .limit(1);
    
    if (!client || client.length === 0) {
      console.log(`[BoletoHandlerPlanB] Cliente não encontrado para telefone ${normalizedPhone}`);
      
      // Enviar mensagem de erro amigável
      await sendErrorMessage(ticketId, clientName, "cliente_nao_encontrado");
      
      return {
        ok: false,
        decision: "CLIENT_NOT_FOUND",
        correlationId,
      };
    }
    
    const clientId = client[0].id;
    console.log(`[BoletoHandlerPlanB] Cliente encontrado: ${clientId} (${client[0].name})`);
    
    // PASSO 2: Buscar receivable mais recente em atraso
    const receivable = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, clientId),
          eq(receivables.status, "overdue")
        )
      )
      .orderBy(desc(receivables.dueDate))
      .limit(1);
    
    if (!receivable || receivable.length === 0) {
      console.log(`[BoletoHandlerPlanB] Nenhum receivable em atraso para cliente ${clientId}`);
      
      // Enviar mensagem de erro amigável
      await sendErrorMessage(ticketId, clientName, "sem_boletos_pendentes");
      
      return {
        ok: false,
        decision: "NO_OVERDUE_RECEIVABLES",
        correlationId,
      };
    }
    
    const receivableId = receivable[0].id;
    const zapStorageFilename = receivable[0].zapStorageFilename;
    
    console.log(`[BoletoHandlerPlanB] Receivable encontrado: ${receivableId}`, {
      dueDate: receivable[0].dueDate,
      amount: receivable[0].amount,
      zapStorageFilename: zapStorageFilename,
    });
    
    // PASSO 3: Verificar se temos filename do storage Zap
    if (!zapStorageFilename) {
      console.log(`[BoletoHandlerPlanB] Filename não encontrado, iniciando Fluxo 2...`);
      
      // Fluxo 2: Gerar/obter PDF e fazer upload
      try {
        const fluxo2Result = await generateAndUploadPdf({
          receivableId,
          clientId,
          ticketId,
          receivable: receivable[0],
        });
        
        if (!fluxo2Result.ok) {
          await sendErrorMessage(ticketId, clientName, "pdf_nao_disponivel");
          return {
            ok: false,
            decision: "FLUXO2_FAILED",
            error: fluxo2Result.error,
            correlationId,
          };
        }
        
        // Atualizar zapStorageFilename com o resultado do Fluxo 2
        const zapStorageFilenameFromFluxo2 = fluxo2Result.zapStorageFilename;
        
        if (!zapStorageFilenameFromFluxo2) {
          return {
            ok: false,
            decision: "FLUXO2_NO_FILENAME",
            error: "Fluxo 2 não retornou filename",
            correlationId,
          };
        }
        
        console.log(`[BoletoHandlerPlanB] Fluxo 2 completado, filename: ${zapStorageFilenameFromFluxo2}`);
        
        // Continuar com PASSO 4 usando o novo filename
        return await sendViaPlanoBE2E({
          ticketId,
          clientId,
          receivableId,
          filename: zapStorageFilenameFromFluxo2,
          correlationId,
        });
        
      } catch (fluxo2Error: any) {
        console.error("[BoletoHandlerPlanB] Erro no Fluxo 2:", fluxo2Error);
        await sendErrorMessage(ticketId, clientName, "erro_sistema");
        return {
          ok: false,
          decision: "FLUXO2_ERROR",
          error: fluxo2Error.message,
          correlationId,
        };
      }
    }
    
    // PASSO 4: Chamar endpoint PLANO B E2E
    console.log(`[BoletoHandlerPlanB] Chamando endpoint PLANO B E2E...`);
    
    const planBResponse = await axios.post(
      "http://localhost:3000/api/test/r7/send-from-existing-zap-file",
      {
        ticketId,
        clientId,
        receivableId,
        filename: zapStorageFilename,
        correlationId,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    
    console.log(`[BoletoHandlerPlanB] Endpoint PLANO B retornou:`, {
      status: planBResponse.status,
      decision: planBResponse.data?.decision,
      ok: planBResponse.data?.ok,
    });
    
    return {
      ok: true,
      decision: "PLANO_B_SUCCESS",
      correlationId,
      planBResponse: planBResponse.data,
    };
    
  } catch (error: any) {
    console.error("[BoletoHandlerPlanB] Erro fatal:", error);
    
    // Enviar mensagem de erro genérica
    await sendErrorMessage(ticketId, clientName, "erro_sistema");
    
    return {
      ok: false,
      decision: "FATAL_ERROR",
      error: error.message,
      correlationId,
    };
  }
}

/**
 * Enviar mensagem de erro amigável para o cliente
 */
async function sendErrorMessage(
  ticketId: number,
  clientName: string,
  errorType: string
): Promise<void> {
  try {
    const errorMessages: Record<string, string> = {
      cliente_nao_encontrado: `Olá ${clientName}! Não consegui localizar seu cadastro. Por favor, entre em contato com nosso suporte.`,
      sem_boletos_pendentes: `Olá ${clientName}! Não encontrei boletos pendentes no momento. Se precisar de ajuda, entre em contato com nosso suporte.`,
      pdf_nao_disponivel: `Olá ${clientName}! Estou gerando seu boleto. Em alguns instantes enviarei para você.`,
      erro_sistema: `Olá ${clientName}! Ocorreu um erro ao processar sua solicitação. Nossa equipe já foi notificada. Por favor, tente novamente em alguns minutos.`,
    };
    
    const message = errorMessages[errorType] || errorMessages.erro_sistema;
    
    // Enviar mensagem via endpoint Zap
    await axios.post(
      `http://localhost:3000/api/test/r7/send-real`,
      {
        ticketId,
        message,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    
    console.log(`[BoletoHandlerPlanB] Mensagem de erro enviada: ${errorType}`);
  } catch (error) {
    console.error("[BoletoHandlerPlanB] Erro ao enviar mensagem de erro:", error);
  }
}
