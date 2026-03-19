/**
 * Fluxo 2: Gerar/obter PDF quando não existe no storage Zap
 * 
 * Pipeline:
 * 1. Resolver PDF (R2 primeiro, depois Conta Azul API pública)
 * 2. Upload para storage Zap
 * 3. Salvar zapStorageFilename no receivable
 * 4. Retornar filename para uso no PLANO B
 */

import axios from "axios";
import { getDb } from "./db";
import { receivables } from "../drizzle/schema";
import { eq } from "drizzle-orm";

interface Fluxo2Input {
  receivableId: number;
  clientId: number;
  ticketId: number;
  receivable: any; // Receivable completo do DB
}

interface Fluxo2Result {
  ok: boolean;
  zapStorageFilename?: string;
  error?: string;
}

/**
 * Gerar/obter PDF e fazer upload no storage Zap
 */
export async function generateAndUploadPdf(input: Fluxo2Input): Promise<Fluxo2Result> {
  const { receivableId, receivable } = input;
  
  console.log(`[Fluxo2] Iniciando para receivable ${receivableId}`);
  
  try {
    // PASSO 1: Resolver PDF (R2 primeiro, depois Conta Azul)
    let pdfBuffer: Buffer | null = null;
    let pdfSource: string = "";
    
    // Tentar R2 primeiro
    if (receivable.pdfStorageUrl) {
      console.log(`[Fluxo2] Tentando baixar PDF do R2: ${receivable.pdfStorageUrl}`);
      
      try {
        const r2Response = await axios.get(receivable.pdfStorageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
          validateStatus: (status) => status === 200,
        });
        
        if (r2Response.data && r2Response.data.byteLength > 1000) {
          pdfBuffer = Buffer.from(r2Response.data);
          pdfSource = "r2";
          console.log(`[Fluxo2] PDF obtido do R2: ${pdfBuffer.length} bytes`);
        }
      } catch (r2Error) {
        console.log(`[Fluxo2] R2 falhou, tentando Conta Azul...`);
      }
    }
    
    // Se R2 falhou, tentar Conta Azul API pública
    if (!pdfBuffer && receivable.link) {
      console.log(`[Fluxo2] Tentando baixar PDF do Conta Azul: ${receivable.link}`);
      
      try {
        const contaAzulResponse = await axios.get(receivable.link, {
          responseType: "arraybuffer",
          timeout: 15000,
          validateStatus: (status) => status === 200,
        });
        
        if (contaAzulResponse.data && contaAzulResponse.data.byteLength > 1000) {
          pdfBuffer = Buffer.from(contaAzulResponse.data);
          pdfSource = "contaazul";
          console.log(`[Fluxo2] PDF obtido do Conta Azul: ${pdfBuffer.length} bytes`);
        }
      } catch (contaAzulError) {
        console.error(`[Fluxo2] Conta Azul falhou:`, contaAzulError);
      }
    }
    
    // Se nenhum PDF foi obtido, retornar erro
    if (!pdfBuffer) {
      return {
        ok: false,
        error: "PDF não disponível em R2 nem Conta Azul",
      };
    }
    
    // PASSO 2: Upload para storage Zap
    console.log(`[Fluxo2] Fazendo upload do PDF para storage Zap...`);
    
    const uploadResult = await uploadPdfToZapStorage({
      pdfBuffer,
      receivableId,
      filename: `boleto-r7-${receivableId}.pdf`,
    });
    
    if (!uploadResult.ok || !uploadResult.filename) {
      return {
        ok: false,
        error: uploadResult.error || "Upload falhou",
      };
    }
    
    const zapStorageFilename = uploadResult.filename;
    
    console.log(`[Fluxo2] Upload completado: ${zapStorageFilename}`);
    
    // PASSO 3: Salvar zapStorageFilename no receivable
    const db = await getDb();
    if (db) {
      await db
        .update(receivables)
        .set({
          zapStorageFilename,
          zapStorageFileSize: pdfBuffer.length,
          zapStorageUploadedAt: new Date(),
          paymentInfoSource: "zap_storage" as any,
          paymentInfoUpdatedAt: new Date(),
        })
        .where(eq(receivables.id, receivableId));
      
      console.log(`[Fluxo2] Receivable ${receivableId} atualizado no DB`);
    }
    
    return {
      ok: true,
      zapStorageFilename,
    };
    
  } catch (error: any) {
    console.error("[Fluxo2] Erro fatal:", error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Upload de PDF para storage Zap
 * 
 * TODO: Descobrir endpoint real de upload do Zap
 * Por enquanto, retorna erro para forçar implementação
 */
async function uploadPdfToZapStorage(input: {
  pdfBuffer: Buffer;
  receivableId: number;
  filename: string;
}): Promise<{ ok: boolean; filename?: string; error?: string }> {
  console.log(`[Fluxo2Upload] Iniciando upload: ${input.filename}`);
  
  // TODO: Implementar upload real para storage Zap
  // Endpoint ainda não descoberto - precisa de scanner ou DevTools
  
  return {
    ok: false,
    error: "Endpoint de upload do Zap ainda não implementado",
  };
}

/**
 * Helper: Enviar via endpoint PLANO B E2E
 */
export async function sendViaPlanoBE2E(input: {
  ticketId: number;
  clientId: number;
  receivableId: number;
  filename: string;
  correlationId: string;
}): Promise<any> {
  console.log(`[SendViaPlanoBE2E] Enviando via PLANO B...`);
  
  const planBResponse = await axios.post(
    "http://localhost:3000/api/test/r7/send-from-existing-zap-file",
    {
      ticketId: input.ticketId,
      clientId: input.clientId,
      receivableId: input.receivableId,
      filename: input.filename,
      correlationId: input.correlationId,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );
  
  console.log(`[SendViaPlanoBE2E] Resposta:`, {
    status: planBResponse.status,
    decision: planBResponse.data?.decision,
  });
  
  return {
    ok: true,
    decision: "PLANO_B_SUCCESS",
    correlationId: input.correlationId,
    planBResponse: planBResponse.data,
  };
}
