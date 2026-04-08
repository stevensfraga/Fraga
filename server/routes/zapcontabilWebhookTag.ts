import { Router } from "express";
import mysql from "mysql2/promise";
import axios from "axios";
import {
  normalizePhoneNumber,
  identifyClientWithFallback,
} from "../services/clientIdentificationService";

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || "";

async function sendWhatsappMessage(phone: string, message: string) {
  if (!ZAP_API_KEY) {
    console.warn(`[TAG-WEBHOOK] ⚠️ ZAP_CONTABIL_API_KEY não configurada`);
    return false;
  }
  try {
    const phoneDigits = phone.replace(/\D/g, "");
    console.log(`[TAG-WEBHOOK] 📤 Enviando: ${message.substring(0, 80)}...`);
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
    console.log(`[TAG-WEBHOOK] ✅ Enviada (ID: ${messageId})`);
    return true;
  } catch (error: any) {
    console.error(`[TAG-WEBHOOK] ❌ Erro: ${error.message}`);
    return false;
  }
}

const router = Router();

router.post("/tag-nota-fiscal", async (req, res) => {
  console.log("[TAG-WEBHOOK-DEBUG] 🔔 WEBHOOK CHAMADO - tag-nota-fiscal");
  let connection: mysql.Connection | null = null;
  const requestId = `tag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    const { ticketId, phoneE164, clientName, clientDocument, tag } = req.body;
    console.log(`[TAG-WEBHOOK] ✅ WEBHOOK RECEBIDO`);
    console.log(`[TAG-WEBHOOK] ticketId: ${ticketId}, tag: ${tag}`);

    // Validar se a tag é "nota fiscal"
    if (tag?.toLowerCase() !== "nota fiscal") {
      console.log(`[TAG-WEBHOOK] ❌ Tag inválida: ${tag}`);
      return res.status(200).json({ success: false, reason: "Tag não é nota fiscal" });
    }

    const DATABASE_URL = process.env.DATABASE_URL || "";
    connection = await mysql.createConnection(DATABASE_URL);
    console.log(`[TAG-WEBHOOK] ✅ Banco conectado`);

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
         "confirmation_pending", JSON.stringify(req.body), "waiting_confirmation"]
      );
      ticketId_db = (insertResult as any).insertId;
      console.log(`[TAG-WEBHOOK] ✅ Ticket criado: ${ticketId_db}`);

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
      console.log(`[TAG-WEBHOOK] 🔄 Ticket atualizado: ${ticketId_db}`);

      await connection.execute(
        `UPDATE zapcontabil_tickets SET
          status = ?,
          flow_state = ?,
          webhook_payload = ?,
          last_webhook_at = NOW(),
          updated_at = NOW()
        WHERE id = ?`,
        ["confirmation_pending", "waiting_confirmation", JSON.stringify(req.body), ticketId_db]
      );
    }

    console.log(`[TAG-WEBHOOK] 💬 Enviando pergunta de confirmação`);
    const confirmationMessage = `Olá ${clientName}! 👋\n\nDeseja emitir uma Nota Fiscal de Serviço (NFS-e)?\n\nResponda: *SIM* para continuar`;
    console.log(`[TAG-WEBHOOK] ❓ Mensagem: ${confirmationMessage}`);

    await sendWhatsappMessage(phoneE164, confirmationMessage);

    await connection.end();

    console.log(`[TAG-WEBHOOK] ✅ SUCESSO - requestId: ${requestId}`);
    return res.status(200).json({
      success: true,
      message: "Pergunta de confirmação enviada via tag",
      ticketId: ticketId_db,
      state: "waiting_confirmation",
      requestId,
    });
  } catch (error: any) {
    console.error(`[TAG-WEBHOOK] ❌ ERRO: ${error.message}`);
    if (connection) await connection.end().catch(() => {});
    return res.status(500).json({ success: false, error: error.message, requestId });
  }
});

export const zapcontabilWebhookTagRouter = router;
export default router;
