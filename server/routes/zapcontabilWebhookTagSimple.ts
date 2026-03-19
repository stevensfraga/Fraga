import { Router } from "express";
import mysql from "mysql2/promise";
import axios from "axios";
import { getNextQuestion } from "../services/nfseFlowStateMachine";
import { normalizePhoneNumber, identifyClientWithFallback } from "../services/clientIdentificationService";

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || "";

async function sendWhatsappMessage(phone: string, message: string) {
  if (!ZAP_API_KEY) {
    console.warn(`[TAG-SIMPLE] ⚠️ ZAP_CONTABIL_API_KEY não configurada`);
    return false;
  }
  try {
    const phoneDigits = phone.replace(/\D/g, "");
    console.log(`[TAG-SIMPLE] 📤 Enviando para ${phoneDigits}: ${message.substring(0, 60)}...`);
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
    console.log(`[TAG-SIMPLE] ✅ Mensagem enviada`);
    return true;
  } catch (error: any) {
    console.error(`[TAG-SIMPLE] ❌ Erro ao enviar: ${error.message}`);
    return false;
  }
}

const router = Router();

router.post("/webhook-tag-simple", async (req, res) => {
  console.log("[TAG-SIMPLE] 🔔 WEBHOOK RECEBIDO");
  console.log("[TAG-SIMPLE] Body:", JSON.stringify(req.body).substring(0, 200));
  
  let connection: mysql.Connection | null = null;

  try {
    const { ticketId, phoneE164, clientName, clientDocument, tags } = req.body;
    
    console.log(`[TAG-SIMPLE] ticketId: ${ticketId}`);
    console.log(`[TAG-SIMPLE] phone: ${phoneE164}`);
    console.log(`[TAG-SIMPLE] tags: ${JSON.stringify(tags)}`);

    let hasNotaFiscalTag = false;
    
    if (tags) {
      if (Array.isArray(tags)) {
        hasNotaFiscalTag = tags.some((t: any) => {
          const tagStr = typeof t === "string" ? t : t?.name || t?.label || "";
          return tagStr.toLowerCase().includes("nota fiscal");
        });
      } else if (typeof tags === "string") {
        hasNotaFiscalTag = tags.toLowerCase().includes("nota fiscal");
      }
    }

    console.log(`[TAG-SIMPLE] ✅ Tag encontrada: ${hasNotaFiscalTag}`);

    if (!hasNotaFiscalTag) {
      console.log(`[TAG-SIMPLE] ℹ️ Ignorando - tag não encontrada`);
      return res.status(200).json({ success: false, reason: "Tag não encontrada" });
    }

    const DATABASE_URL = process.env.DATABASE_URL || "";
    connection = await mysql.createConnection(DATABASE_URL);

    const phoneNormalized = normalizePhoneNumber(phoneE164);
    const clientIdentification = await identifyClientWithFallback(phoneNormalized || phoneE164, clientDocument, clientName);

    const [existingTickets] = await connection.execute(
      "SELECT id FROM zapcontabil_tickets WHERE ticket_id = ? LIMIT 1",
      [ticketId]
    );

    let ticketId_db: number;
    if ((existingTickets as any).length === 0) {
      const [insertResult] = await connection.execute(
        `INSERT INTO zapcontabil_tickets (ticket_id, phone_e164, client_name, client_document, status, flow_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [ticketId || null, phoneE164 || null, clientName || null, clientDocument || null, "flow_started", "waiting_document"]
      );
      ticketId_db = (insertResult as any).insertId;
      console.log(`[TAG-SIMPLE] ✅ Ticket criado: ${ticketId_db}`);
    } else {
      ticketId_db = (existingTickets as any)[0].id;
      console.log(`[TAG-SIMPLE] 🔄 Ticket encontrado: ${ticketId_db}`);
      
      await connection.execute(
        `UPDATE zapcontabil_tickets SET status = ?, flow_state = ?, updated_at = NOW() WHERE id = ?`,
        ["flow_started", "waiting_document", ticketId_db]
      );
    }

    console.log(`[TAG-SIMPLE] 💬 Enviando primeira pergunta`);
    const firstQuestion = getNextQuestion("waiting_document");
    await sendWhatsappMessage(phoneE164, firstQuestion);

    await connection.end();

    console.log(`[TAG-SIMPLE] ✅ SUCESSO`);
    return res.status(200).json({ success: true, message: "Fluxo iniciado", ticketId: ticketId_db });
  } catch (error: any) {
    console.error(`[TAG-SIMPLE] ❌ ERRO: ${error.message}`);
    if (connection) await connection.end().catch(() => {});
    return res.status(500).json({ success: false, error: error.message });
  }
});

export const zapcontabilWebhookTagSimpleRouter = router;
export default router;
