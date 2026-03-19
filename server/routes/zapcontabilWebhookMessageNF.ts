import { Router } from "express";
import mysql from "mysql2/promise";
import axios from "axios";
import { getNextQuestion, transitionState } from "../services/nfseFlowStateMachine";
import { normalizePhoneNumber, identifyClientWithFallback } from "../services/clientIdentificationService";

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || "";

async function sendWhatsappMessage(phone: string, message: string) {
  if (!ZAP_API_KEY) {
    console.warn(`[MESSAGE-NF] ⚠️ ZAP_CONTABIL_API_KEY não configurada`);
    return false;
  }
  try {
    const phoneDigits = phone.replace(/\D/g, "");
    console.log(`[MESSAGE-NF] 📤 Enviando para ${phoneDigits}`);
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
    console.log(`[MESSAGE-NF] ✅ Mensagem enviada`);
    return true;
  } catch (error: any) {
    console.error(`[MESSAGE-NF] ❌ Erro: ${error.message}`);
    return false;
  }
}

const router = Router();

router.post("/webhook-message-nf", async (req, res) => {
  console.log("[MESSAGE-NF] 🔔 WEBHOOK RECEBIDO");
  
  let connection: mysql.Connection | null = null;

  try {
    const { ticketId, phoneE164, clientName, clientDocument, message, assignedTo, fromMe } = req.body;
    
    console.log(`[MESSAGE-NF] ticketId: ${ticketId}, assignedTo: ${assignedTo}, fromMe: ${fromMe}`);
    console.log(`[MESSAGE-NF] message: ${message?.substring(0, 50)}`);

    if (fromMe) {
      console.log(`[MESSAGE-NF] ℹ️ Ignorando - mensagem do sistema`);
      return res.status(200).json({ success: false, reason: "Mensagem do sistema" });
    }

    const isNotaFiscalAssigned = assignedTo?.toLowerCase?.()?.includes("nota fiscal");
    
    if (!isNotaFiscalAssigned) {
      console.log(`[MESSAGE-NF] ℹ️ Ignorando - não está com nota fiscal`);
      return res.status(200).json({ success: false, reason: "Não está com nota fiscal" });
    }

    console.log(`[MESSAGE-NF] ✅ Atendimento com nota fiscal detectado!`);

    const DATABASE_URL = process.env.DATABASE_URL || "";
    connection = await mysql.createConnection(DATABASE_URL);

    const [tickets] = await connection.execute(
      "SELECT * FROM zapcontabil_tickets WHERE ticket_id = ? LIMIT 1",
      [ticketId]
    );

    let ticketId_db: number;
    let currentFlowState: any = "waiting_document";

    if ((tickets as any).length === 0) {
      const phoneNormalized = normalizePhoneNumber(phoneE164);
      const clientIdentification = await identifyClientWithFallback(phoneNormalized || phoneE164, clientDocument, clientName);

      const [insertResult] = await connection.execute(
        `INSERT INTO zapcontabil_tickets (ticket_id, phone_e164, client_name, client_document, status, flow_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [ticketId || null, phoneE164 || null, clientName || null, clientDocument || null, "flow_started", "waiting_document"]
      );
      ticketId_db = (insertResult as any).insertId;
      console.log(`[MESSAGE-NF] ✅ Novo ticket criado: ${ticketId_db}`);
    } else {
      const ticket = (tickets as any)[0];
      ticketId_db = ticket.id;
      currentFlowState = ticket.flow_state || "waiting_document";
      console.log(`[MESSAGE-NF] 🔄 Ticket encontrado: ${ticketId_db}, state: ${currentFlowState}`);
    }

    console.log(`[MESSAGE-NF] 💬 Processando resposta: ${message?.substring(0, 50)}`);
    const nextState = transitionState(currentFlowState, message);

    await connection.execute(
      `UPDATE zapcontabil_tickets SET flow_state = ?, updated_at = NOW() WHERE id = ?`,
      [nextState, ticketId_db]
    );

    if (nextState === "completed") {
      console.log(`[MESSAGE-NF] ✅ Fluxo completo!`);
      await connection.execute(
        `UPDATE zapcontabil_tickets SET status = ?, updated_at = NOW() WHERE id = ?`,
        ["nfse_issued", ticketId_db]
      );
      await sendWhatsappMessage(phoneE164, "✅ Nota Fiscal de Serviço emitida com sucesso!");
    } else {
      const nextQuestion = getNextQuestion(nextState);
      console.log(`[MESSAGE-NF] ❓ Enviando próxima pergunta`);
      await sendWhatsappMessage(phoneE164, nextQuestion);
    }

    await connection.end();

    console.log(`[MESSAGE-NF] ✅ SUCESSO`);
    return res.status(200).json({ success: true, ticketId: ticketId_db, state: nextState });
  } catch (error: any) {
    console.error(`[MESSAGE-NF] ❌ ERRO: ${error.message}`);
    if (connection) await connection.end().catch(() => {});
    return res.status(500).json({ success: false, error: error.message });
  }
});

export const zapcontabilWebhookMessageNFRouter = router;
export default router;
