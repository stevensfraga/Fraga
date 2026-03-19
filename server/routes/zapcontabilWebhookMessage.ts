/**
 * Webhook para receber mensagens do WhatsApp via ZapContábil
 * Implementa fluxo guiado com state machine para coleta de dados do tomador
 */

import { Router } from "express";
import mysql from "mysql2/promise";
import { URL } from "url";
import axios from "axios";
import {
  NfseFlowData,
  transitionState,
  getNextQuestion,
  generateReviewSummary,
} from "../services/nfseFlowStateMachine";

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

// Função para enviar mensagem no WhatsApp via ZapContábil
async function sendWhatsappMessage(phone: string, message: string) {
  if (!ZAP_API_KEY) {
    console.warn(`[NFSE-MESSAGE-WHATSAPP] ⚠️ ZAP_CONTABIL_API_KEY não configurada`);
    return false;
  }

  try {
    const phoneDigits = phone.replace(/\D/g, '');
    
    console.log(`[NFSE-MESSAGE-WHATSAPP] 📤 Enviando mensagem`);
    console.log(`[NFSE-MESSAGE-WHATSAPP]   - phone: ${phoneDigits}`);
    console.log(`[NFSE-MESSAGE-WHATSAPP]   - message: ${message.substring(0, 100)}...`);

    const response = await axios.post(
      `${ZAP_API_URL}/api/send/${phoneDigits}`,
      {
        body: message,
        connectionFrom: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const messageId = response.data?.message?.id || response.data?.messageId || response.data?.id;
    
    console.log(`[NFSE-MESSAGE-WHATSAPP] ✅ Mensagem enviada com sucesso`);
    console.log(`[NFSE-MESSAGE-WHATSAPP]   - messageId: ${messageId}`);
    console.log(`[NFSE-MESSAGE-WHATSAPP]   - status: ${response.status}`);
    return true;
  } catch (error: any) {
    const errMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro desconhecido';
    const httpStatus = error.response?.status || 0;
    
    console.error(`[NFSE-MESSAGE-WHATSAPP] ❌ Falha no envio`);
    console.error(`[NFSE-MESSAGE-WHATSAPP]   - status: ${httpStatus}`);
    console.error(`[NFSE-MESSAGE-WHATSAPP]   - error: ${errMsg}`);
    return false;
  }
}

const router = Router();

/**
 * POST /api/zapcontabil/webhook-message
 * Recebe mensagem do cliente e processa fluxo guiado de coleta de dados
 */
router.post("/webhook-message", async (req, res) => {
  let connection;
  const startTime = Date.now();
  const requestId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    const { ticketId, phoneE164, clientMessage } = req.body;
    
    // Garantir que ticketId é string (pode vir como inteiro do webhook)
    const ticketIdStr = String(ticketId);

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ WEBHOOK RECEBIDO`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] requestId: ${requestId}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] timestamp: ${new Date().toISOString()}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] ticketId: ${ticketIdStr}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] phoneE164: ${phoneE164}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] clientMessage: "${clientMessage}"`);

    if (!ticketIdStr || !phoneE164 || !clientMessage) {
      console.log(`[NFSE-MESSAGE-WEBHOOK] ❌ ERRO: Parâmetros obrigatórios faltando`);
      return res.status(400).json({
        success: false,
        error: "Parâmetros obrigatórios: ticketId, phoneE164, clientMessage",
      });
    }

    // Usar DATABASE_URL direto
    console.log(`[NFSE-MESSAGE-WEBHOOK] 🔗 Conectando ao banco de dados...`);
    connection = await mysql.createConnection(process.env.DATABASE_URL!);
    console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ Conexão ao banco estabelecida`);

    // 1. Buscar ticket existente
    console.log(`[NFSE-MESSAGE-WEBHOOK] 🔍 Procurando ticket: ${ticketIdStr}`);
    const [ticketResults] = await connection.execute(
      "SELECT * FROM zapcontabil_tickets WHERE ticket_id = ?",
      [ticketIdStr]
    );

    if ((ticketResults as any).length === 0) {
      console.log(`[NFSE-MESSAGE-WEBHOOK] ❌ ERRO: Ticket não encontrado: ${ticketIdStr}`);
      await connection.end();
      return res.status(404).json({
        success: false,
        error: "Ticket não encontrado",
      });
    }

    const ticket = (ticketResults as any)[0];
    console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ Ticket encontrado`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - id: ${ticket.id}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - flow_state: ${ticket.flow_state}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - client_name: ${ticket.client_name}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - client_document: ${ticket.client_document}`);

    let flowData: NfseFlowData = {
      ticketId: ticketIdStr,
      phone: phoneE164,
      clientName: ticket.client_name,
      takerDocument: ticket.client_document,
      takerDocumentType: ticket.client_document_type as any,
      takerName: ticket.client_name,
      serviceDescription: ticket.service_description,
      serviceValue: ticket.service_value,
      state: ticket.flow_state || "waiting_document",
      createdAt: new Date(ticket.created_at),
      updatedAt: new Date(ticket.updated_at),
      attemptCount: ticket.flow_attempt_count || 0,
    };

    console.log(`[NFSE-MESSAGE-WEBHOOK] 📊 Estado da máquina de estado:`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - estado atual: ${flowData.state}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - tentativas: ${flowData.attemptCount}`);

    // 2. Processar transição de estado
    console.log(`[NFSE-MESSAGE-WEBHOOK] 🔄 Processando transição de estado...`);
    const transition = transitionState(flowData.state, clientMessage, flowData);

    console.log(`[NFSE-MESSAGE-WEBHOOK] 📋 Resultado da transição:`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - próximo estado: ${transition.nextState}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - erro: ${transition.error || 'nenhum'}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK]   - dados atualizados: ${transition.updatedData ? 'sim' : 'não'}`);

    if (transition.error) {
      console.log(`[NFSE-MESSAGE-WEBHOOK] ⚠️ Erro na validação: ${transition.error}`);

      // Enviar mensagem de erro no WhatsApp
      console.log(`[NFSE-MESSAGE-WEBHOOK] 💬 Enviando mensagem de erro no WhatsApp`);
      await sendWhatsappMessage(phoneE164, `❌ ${transition.error}`);

      // Enviar próxima pergunta
      const nextQuestion = getNextQuestion(flowData.state);
      if (nextQuestion) {
        console.log(`[NFSE-MESSAGE-WEBHOOK] 💬 Enviando próxima pergunta no WhatsApp`);
        await sendWhatsappMessage(phoneE164, nextQuestion);
      }

      await connection.end();
      return res.status(200).json({
        success: false,
        reason: "Validação falhou",
        error: transition.error,
      });
    }

    // 3. Atualizar dados do ticket com os dados coletados
    if (transition.updatedData) {
      console.log(`[NFSE-MESSAGE-WEBHOOK] 🔄 Atualizando dados do fluxo`);
      flowData = { ...flowData, ...transition.updatedData };
      console.log(`[NFSE-MESSAGE-WEBHOOK]   - takerDocument: ${flowData.takerDocument}`);
      console.log(`[NFSE-MESSAGE-WEBHOOK]   - takerName: ${flowData.takerName}`);
      console.log(`[NFSE-MESSAGE-WEBHOOK]   - serviceDescription: ${flowData.serviceDescription}`);
      console.log(`[NFSE-MESSAGE-WEBHOOK]   - serviceValue: ${flowData.serviceValue}`);
    }

    // 4. Atualizar ticket no banco
    console.log(`[NFSE-MESSAGE-WEBHOOK] 💾 Salvando estado no banco de dados`);
    await connection.execute(
      `UPDATE zapcontabil_tickets SET
        flow_state = ?,
        flow_attempt_count = ?,
        client_document = ?,
        client_document_type = ?,
        client_name = ?,
        service_description = ?,
        service_value = ?,
        last_message = ?,
        updated_at = NOW()
      WHERE ticket_id = ?`,
      [
        transition.nextState,
        flowData.attemptCount + 1,
        flowData.takerDocument || null,
        flowData.takerDocumentType || null,
        flowData.takerName || null,
        flowData.serviceDescription || null,
        flowData.serviceValue || null,
        clientMessage,
        ticketIdStr,
      ]
    );
    console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ Ticket atualizado no banco`);

    // 5. Processar próximo passo
    if (transition.nextState === "review_pending") {
      console.log(`[NFSE-MESSAGE-WEBHOOK] 📋 Gerando resumo para confirmação`);
      // Gerar resumo e pedir confirmação
      const summary = generateReviewSummary(flowData);
      console.log(`[NFSE-MESSAGE-WEBHOOK] 💬 Enviando resumo no WhatsApp`);
      await sendWhatsappMessage(phoneE164, summary);

      await connection.end();
      return res.status(200).json({
        success: true,
        state: transition.nextState,
        message: "Resumo enviado, aguardando confirmação",
      });
    }

    if (transition.nextState === "confirmed") {
      console.log(`[NFSE-MESSAGE-WEBHOOK] 🚀 Criando emissão de NFS-e`);
      // Criar emissão de NFS-e
      console.log(`[NFSE-MESSAGE-WEBHOOK] 📝 Inserindo emissão no banco`);

      const [emissionResult] = await connection.execute(
        `INSERT INTO nfse_emissions (
          ticket_id, 
          emitter_company_id, 
          emitter_cnpj, 
          taker_name, 
          taker_document, 
          service_description, 
          service_value, 
          net_value,
          status, 
          emission_attempts, 
          created_at, 
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          ticketIdStr,
          ticket.emitter_company_id || null,
          ticket.emitter_cnpj || null,
          flowData.takerName || null,
          flowData.takerDocument || null,
          flowData.serviceDescription || null,
          flowData.serviceValue || 0,
          flowData.serviceValue || 0,
          "ready_to_emit",
          1
        ]
      );

      const emissionId = (emissionResult as any).insertId;
      console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ Emissão criada com ID: ${emissionId}`);

      // Atualizar ticket com referência à emissão
      console.log(`[NFSE-MESSAGE-WEBHOOK] 🔄 Atualizando ticket com referência à emissão`);
      await connection.execute(
        `UPDATE zapcontabil_tickets SET
          nfse_emission_id = ?,
          flow_state = ?,
          status = ?,
          updated_at = NOW()
        WHERE ticket_id = ?`,
        [emissionId, "confirmed", "ready_to_emit", ticketIdStr]
      );
      console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ Ticket atualizado com status 'ready_to_emit'`);

      // Responder no WhatsApp que iniciamos o processo
      console.log(`[NFSE-MESSAGE-WEBHOOK] 💬 Enviando confirmação no WhatsApp`);
      await sendWhatsappMessage(
        phoneE164,
        `✅ Dados confirmados! Estamos emitindo sua NFS-e. Você receberá a nota fiscal em breve.`
      );

      const duration = Date.now() - startTime;
      console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ FLUXO COMPLETO FINALIZADO`);
      console.log(`[NFSE-MESSAGE-WEBHOOK] requestId: ${requestId}`);
      console.log(`[NFSE-MESSAGE-WEBHOOK] emissionId: ${emissionId}`);
      console.log(`[NFSE-MESSAGE-WEBHOOK] duração: ${duration}ms`);
      console.log(`${'═'.repeat(80)}\n`);

      await connection.end();
      return res.status(200).json({
        success: true,
        state: transition.nextState,
        emissionId,
        requestId,
        message: "Emissão criada, processando...",
      });
    }

    if (transition.nextState === "cancelled") {
      console.log(`[NFSE-MESSAGE-WEBHOOK] ❌ Fluxo cancelado pelo cliente`);
      // Atualizar ticket como cancelado
      await connection.execute(
        `UPDATE zapcontabil_tickets SET
          flow_state = ?,
          status = ?,
          updated_at = NOW()
        WHERE ticket_id = ?`,
        ["cancelled", "cancelled", ticketIdStr]
      );

      console.log(`[NFSE-MESSAGE-WEBHOOK] 💬 Enviando confirmação de cancelamento`);
      await sendWhatsappMessage(
        phoneE164,
        `Entendido. Cancelamos sua solicitação de NFS-e. Se precisar de ajuda, entre em contato conosco.`
      );

      const duration = Date.now() - startTime;
      console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ FLUXO CANCELADO`);
      console.log(`[NFSE-MESSAGE-WEBHOOK] requestId: ${requestId}`);
      console.log(`[NFSE-MESSAGE-WEBHOOK] duração: ${duration}ms`);
      console.log(`${'═'.repeat(80)}\n`);

      await connection.end();
      return res.status(200).json({
        success: true,
        state: transition.nextState,
        message: "Fluxo cancelado",
      });
    }

    // Próximo estado é uma pergunta
    console.log(`[NFSE-MESSAGE-WEBHOOK] ❓ Aguardando próxima resposta do cliente`);
    const nextQuestion = getNextQuestion(transition.nextState);
    if (nextQuestion) {
      console.log(`[NFSE-MESSAGE-WEBHOOK] 💬 Enviando próxima pergunta no WhatsApp`);
      await sendWhatsappMessage(phoneE164, nextQuestion);
    }

    const duration = Date.now() - startTime;
    console.log(`[NFSE-MESSAGE-WEBHOOK] ✅ WEBHOOK PROCESSADO COM SUCESSO`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] requestId: ${requestId}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] próximo estado: ${transition.nextState}`);
    console.log(`[NFSE-MESSAGE-WEBHOOK] duração: ${duration}ms`);
    console.log(`${'═'.repeat(80)}\n`);

    await connection.end();
    return res.status(200).json({
      success: true,
      state: transition.nextState,
      requestId,
      message: "Mensagem processada, próxima pergunta enviada",
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n${'═'.repeat(80)}`);
    console.error(`[NFSE-MESSAGE-WEBHOOK] ❌ ERRO AO PROCESSAR WEBHOOK`);
    console.error(`[NFSE-MESSAGE-WEBHOOK] requestId: ${requestId}`);
    console.error(`[NFSE-MESSAGE-WEBHOOK] duração: ${duration}ms`);
    console.error(`[NFSE-MESSAGE-WEBHOOK] erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    console.error(`[NFSE-MESSAGE-WEBHOOK] stack: ${error instanceof Error ? error.stack : 'N/A'}`);
    console.error(`${'═'.repeat(80)}\n`);

    if (connection) {
      await connection.end();
    }

    return res.status(500).json({
      success: false,
      requestId,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export { router as zapcontabilWebhookMessageRouter };
