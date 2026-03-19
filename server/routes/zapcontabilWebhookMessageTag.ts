import { getNextQuestion,  Router } from "express";
import mysql from "mysql2/promise";
import axios from "axios";
import { getNextQuestion, 

  normalizePhoneNumber,
  identifyClientWithFallback,
} from "../services/clientIdentificationService";

import { getNextQuestion } from "../services/nfseFlowStateMachine";
const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || "";

async function sendWhatsappMessage(phone: string, message: string) {
  if (!ZAP_API_KEY) {
    console.warn(`[MESSAGE-TAG-WEBHOOK] ⚠️ ZAP_CONTABIL_API_KEY não configurada`);
    return false;
  }
  try {
    const phoneDigits = phone.replace(/\D/g, "");
    console.log(`[MESSAGE-TAG-WEBHOOK] 📤 Enviando: ${message.substring(0, 80)}...`);
    const response = await axios.post(
      `${ZAP_API_URL}/api/send/${phoneDigits}`,
      { body: message, connectionFrom: 0 },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
    const messageId = response.data?.message?.id || response.data?.messageId || response.data?.id;
    console.log(`[MESSAGE-TAG-WEBHOOK] ✅ Enviada (ID: ${messageId})`);
    return true;
  } catch (error: any) {
    console.error(`[MESSAGE-TAG-WEBHOOK] ❌ Erro: ${error.message}`);
    return false;
  }
}

const router = Router();

router.post("/webhook-message-tag", async (req, res) => {
  console.log("[MESSAGE-TAG-WEBHOOK-DEBUG] 🔔 WEBHOOK CHAMADO - webhook-message-tag");
  let connection: mysql.Connection | null = null;
  const requestId = `msg-tag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    const { ticketId, phoneE164, clientName, clientDocument, message, tags, status } = req.body;
    console.log(`[MESSAGE-TAG-WEBHOOK] ✅ WEBHOOK RECEBIDO`);
    console.log(`[MESSAGE-TAG-WEBHOOK] ticketId: ${ticketId}, message: ${message?.substring(0, 50)}`);
    console.log(`[MESSAGE-TAG-WEBHOOK] tags: ${JSON.stringify(tags)}`);

    // Verificar se tem a tag "nota fiscal"
    const hasNotaFiscalTag = tags && Array.isArray(tags) && tags.some((t: any) => t?.toLowerCase?.() === "nota fiscal" || t?.name?.toLowerCase?.() === "nota fiscal");
    
    if (!hasNotaFiscalTag) {
      console.log(`[MESSAGE-TAG-WEBHOOK] ℹ️ Tag nota fiscal não encontrada`);
      return res.status(200).json({ success: false, reason: "Tag nota fiscal não encontrada" });
    }

    console.log(`[MESSAGE-TAG-WEBHOOK] ✅ Tag nota fiscal encontrada!`);

    // Verificar se a mensagem é "SIM"
    const isConfirmation = message?.toUpperCase?.()?.includes("SIM") || message?.toUpperCase?.()?.includes("YES");
    
    if (!isConfirmation) {
      console.log(`[MESSAGE-TAG-WEBHOOK] ℹ️ Mensagem não é confirmação (SIM)`);
      return res.status(200).json({ success: false, reason: "Mensagem não é confirmação" });
    }

    console.log(`[MESSAGE-TAG-WEBHOOK] ✅ Confirmação recebida (SIM)!`);

    const DATABASE_URL = process.env.DATABASE_URL || "";
    connection = await mysql.createConnection(DATABASE_URL);
    console.log(`[MESSAGE-TAG-WEBHOOK] ✅ Banco conectado`);

    const phoneNormalized = normalizePhoneNumber(phoneE164);
    const clientIdentification = await identifyClientWithFallback(phoneNormalized || phoneE164, clientDocument, clientName);

    const [existingTickets] = await connection.execute(
      "SELECT id FROM zapcontabil_tickets WHERE ticket_id = ? LIMIT 1",
      [ticketId]
    );

    let ticketId_db: number;
    if ((existingTickets as any).length === 0) {
      const [insertResult] = await connection.execute(
        `INSERT INTO zapcontabil_tickets (
          ticket_id, phone_e164, client_name, client_document, 
          status, webhook_payload, created_at, updated_at, flow_state
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
        [ticketId || null, phoneE164 || null, clientName || null, clientDocument || null, 
         "flow_started", JSON.stringify(req.body), "waiting_document"]
      );
      ticketId_db = (insertResult as any).insertId;
      console.log(`[MESSAGE-TAG-WEBHOOK] ✅ Ticket criado: ${ticketId_db}`);

      if (clientIdentification.success && clientIdentification.companyId) {
        await connection.execute(
          `UPDATE zapcontabil_tickets SET
            emitter_company_id = ?,
            emitter_cnpj = ?,
            identification_method = ?,
            identification_confidence = ?
          WHERE id = ?`,
          [clientIdentification.companyId, clientIdentification.cnpj, 
           clientIdentification.identificationMethod, clientIdentification.confidence, ticketId_db]
        );
      }
    } else {
      ticketId_db = (existingTickets as any)[0].id;
      console.log(`[MESSAGE-TAG-WEBHOOK] 🔄 Ticket atualizado: ${ticketId_db}`);

      await connection.execute(
        `UPDATE zapcontabil_tickets SET
          status = ?,
          flow_state = ?,
          webhook_payload = ?,
          last_webhook_at = NOW(),
          updated_at = NOW()
        WHERE id = ?`,
        ["flow_started", "waiting_document", JSON.stringify(req.body), ticketId_db]
      );
    }

    console.log(`[MESSAGE-TAG-WEBHOOK] 💬 Iniciando fluxo guiado`);
    const firstQuestion = getNextQuestion("waiting_document");
    console.log(`[MESSAGE-TAG-WEBHOOK] ❓ Pergunta: ${firstQuestion.substring(0, 80)}...`);

    await sendWhatsappMessage(phoneE164, firstQuestion);

    await connection.end();

    console.log(`[MESSAGE-TAG-WEBHOOK] ✅ SUCESSO - requestId: ${requestId}`);
    return res.status(200).json({
      success: true,
      message: "Fluxo de NFS-e iniciado",
      ticketId: ticketId_db,
      state: "waiting_document",
      requestId,
    });
  } catch (error: any) {
    console.error(`[MESSAGE-TAG-WEBHOOK] ❌ ERRO: ${error.message}`);
    if (connection) await connection.end().catch(() => {});
    return res.status(500).json({ success: false, error: error.message, requestId });
  }
});

export const zapcontabilWebhookMessageTagRouter = router;
export default router;
