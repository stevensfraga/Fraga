import { Router } from "express";
import mysql from "mysql2/promise";
import axios from "axios";
import { getNextQuestion } from "../services/nfseFlowStateMachine";
import { normalizePhoneNumber, identifyClientWithFallback } from "../services/clientIdentificationService";

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || "";

async function sendWhatsappMessage(phone: string, message: string) {
  if (!ZAP_API_KEY) {
    console.warn(`[TRANSFER-NF] ⚠️ ZAP_CONTABIL_API_KEY não configurada`);
    return false;
  }
  try {
    const phoneDigits = phone.replace(/\D/g, "");
    console.log(`[TRANSFER-NF] 📤 Enviando para ${phoneDigits}`);
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
    console.log(`[TRANSFER-NF] ✅ Mensagem enviada`);
    return true;
  } catch (error: any) {
    console.error(`[TRANSFER-NF] ❌ Erro: ${error.message}`);
    return false;
  }
}

const router = Router();

router.post("/webhook-transfer-nf", async (req, res) => {
  console.log("[TRANSFER-NF] 🔔 WEBHOOK RECEBIDO");
  console.log("[TRANSFER-NF] Body:", JSON.stringify(req.body).substring(0, 300));
  
  let connection: mysql.Connection | null = null;

  try {
    const { ticketId, phoneE164, clientName, clientDocument, assignedTo, transferredTo } = req.body;
    
    const targetUser = assignedTo || transferredTo || "";
    console.log(`[TRANSFER-NF] Transferido para: ${targetUser}`);

    // Verificar se foi transferido para "nota fiscal"
    const isNotaFiscalTransfer = targetUser?.toLowerCase?.()?.includes("nota fiscal");
    
    if (!isNotaFiscalTransfer) {
      console.log(`[TRANSFER-NF] ℹ️ Ignorando - não é transferência para nota fiscal`);
      return res.status(200).json({ success: false, reason: "Não é transferência para nota fiscal" });
    }

    console.log(`[TRANSFER-NF] ✅ Transferência para nota fiscal detectada!`);

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
      console.log(`[TRANSFER-NF] ✅ Ticket criado: ${ticketId_db}`);
    } else {
      ticketId_db = (existingTickets as any)[0].id;
      console.log(`[TRANSFER-NF] 🔄 Ticket encontrado: ${ticketId_db}`);
      
      await connection.execute(
        `UPDATE zapcontabil_tickets SET status = ?, flow_state = ?, updated_at = NOW() WHERE id = ?`,
        ["flow_started", "waiting_document", ticketId_db]
      );
    }

    console.log(`[TRANSFER-NF] 💬 Enviando primeira pergunta`);
    const firstQuestion = getNextQuestion("waiting_document");
    await sendWhatsappMessage(phoneE164, firstQuestion);

    await connection.end();

    console.log(`[TRANSFER-NF] ✅ SUCESSO`);
    return res.status(200).json({ success: true, message: "Fluxo NFS-e iniciado", ticketId: ticketId_db });
  } catch (error: any) {
    console.error(`[TRANSFER-NF] ❌ ERRO: ${error.message}`);
    if (connection) await connection.end().catch(() => {});
    return res.status(500).json({ success: false, error: error.message });
  }
});

export const zapcontabilWebhookTransferRouter = router;
export default router;
