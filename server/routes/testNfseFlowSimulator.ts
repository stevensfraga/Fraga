/**
 * Endpoint de teste para simular fluxo completo de NFS-e
 * Permite testar o webhook sem precisar transferir um ticket real no ZapContábil
 */

import { Router } from "express";
import axios from "axios";

const router = Router();

/**
 * GET /api/test/nfse-flow-simulator
 * Retorna instruções de uso
 */
router.get("/", (req, res) => {
  return res.status(200).json({
    message: "Simulador de Fluxo NFS-e",
    endpoints: [
      {
        method: "POST",
        path: "/api/test/nfse-flow-simulator/transfer",
        description: "Simula transferência de ticket para setor 'nota fiscal'",
        example: {
          ticketId: 12345,
          phoneE164: "+5527981657804",
          clientName: "Cliente Teste",
          clientDocument: "07838084000186",
          sector: "nota fiscal",
          previousSector: "atendimento",
        },
      },
      {
        method: "POST",
        path: "/api/test/nfse-flow-simulator/message",
        description: "Simula resposta do cliente no WhatsApp",
        example: {
          ticketId: 12345,
          phoneE164: "+5527981657804",
          clientMessage: "12345678901",
        },
      },
      {
        method: "POST",
        path: "/api/test/nfse-flow-simulator/full-flow",
        description: "Simula fluxo completo (transfer + messages)",
        example: {
          ticketId: 12345,
          phoneE164: "+5527981657804",
          clientName: "Cliente Teste",
          clientDocument: "07838084000186",
          sector: "nota fiscal",
          previousSector: "atendimento",
          messages: [
            "12345678901",
            "João Silva",
            "Serviços contábeis",
            "1500.00",
            "sim",
          ],
        },
      },
    ],
  });
});

/**
 * POST /api/test/nfse-flow-simulator/transfer
 * Simula transferência de ticket para setor "nota fiscal"
 */
router.post("/transfer", async (req, res) => {
  try {
    const {
      ticketId = 12345,
      phoneE164 = "+5527981657804",
      clientName = "Cliente Teste",
      clientDocument = "07838084000186",
      sector = "nota fiscal",
      previousSector = "atendimento",
    } = req.body;

    console.log("\n" + "═".repeat(80));
    console.log("[TEST-SIMULATOR] 🧪 Iniciando simulação de TRANSFER");
    console.log("[TEST-SIMULATOR] Enviando para: POST /api/zapcontabil/setor-nota-fiscal");
    console.log("[TEST-SIMULATOR] Payload:");
    console.log(
      JSON.stringify(
        {
          ticketId,
          phoneE164,
          clientName,
          clientDocument,
          sector,
          previousSector,
        },
        null,
        2
      )
    );

    const response = await axios.post(
      "http://localhost:3000/api/zapcontabil/setor-nota-fiscal",
      {
        ticketId,
        phoneE164,
        clientName,
        clientDocument,
        sector,
        previousSector,
      },
      {
        timeout: 30000,
      }
    );

    console.log("[TEST-SIMULATOR] ✅ Resposta recebida:");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("═".repeat(80) + "\n");

    return res.status(200).json({
      success: true,
      message: "Simulação de TRANSFER concluída",
      response: response.data,
    });
  } catch (error: any) {
    console.error("[TEST-SIMULATOR] ❌ Erro na simulação:");
    console.error(error.response?.data || error.message);
    console.error("═".repeat(80) + "\n");

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**
 * POST /api/test/nfse-flow-simulator/message
 * Simula resposta do cliente no WhatsApp
 */
router.post("/message", async (req, res) => {
  try {
    const {
      ticketId = 12345,
      phoneE164 = "+5527981657804",
      clientMessage = "12345678901",
    } = req.body;

    console.log("\n" + "═".repeat(80));
    console.log("[TEST-SIMULATOR] 🧪 Iniciando simulação de MESSAGE");
    console.log("[TEST-SIMULATOR] Enviando para: POST /api/zapcontabil/webhook-message");
    console.log("[TEST-SIMULATOR] Payload:");
    console.log(
      JSON.stringify(
        {
          ticketId,
          phoneE164,
          clientMessage,
        },
        null,
        2
      )
    );

    const response = await axios.post(
      "http://localhost:3000/api/zapcontabil/webhook-message",
      {
        ticketId,
        phoneE164,
        clientMessage,
      },
      {
        timeout: 30000,
      }
    );

    console.log("[TEST-SIMULATOR] ✅ Resposta recebida:");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("═".repeat(80) + "\n");

    return res.status(200).json({
      success: true,
      message: "Simulação de MESSAGE concluída",
      response: response.data,
    });
  } catch (error: any) {
    console.error("[TEST-SIMULATOR] ❌ Erro na simulação:");
    console.error(error.response?.data || error.message);
    console.error("═".repeat(80) + "\n");

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**
 * POST /api/test/nfse-flow-simulator/full-flow
 * Simula fluxo completo (transfer + messages)
 */
router.post("/full-flow", async (req, res) => {
  try {
    const {
      ticketId = 12345,
      phoneE164 = "+5527981657804",
      clientName = "Cliente Teste",
      clientDocument = "07838084000186",
      sector = "nota fiscal",
      previousSector = "atendimento",
      messages = [
        "12345678901", // CPF/CNPJ
        "João Silva", // Nome
        "Serviços contábeis", // Descrição
        "1500.00", // Valor
        "sim", // Confirmação
      ],
    } = req.body;

    console.log("\n" + "═".repeat(80));
    console.log("[TEST-SIMULATOR] 🧪 Iniciando simulação de FULL-FLOW");
    console.log("[TEST-SIMULATOR] Etapas: TRANSFER → MESSAGES");
    console.log("═".repeat(80) + "\n");

    // Etapa 1: Transfer
    console.log("[TEST-SIMULATOR] 📍 ETAPA 1: TRANSFER");
    console.log("[TEST-SIMULATOR] Enviando para: POST /api/zapcontabil/setor-nota-fiscal");

    const transferResponse = await axios.post(
      "http://localhost:3000/api/zapcontabil/setor-nota-fiscal",
      {
        ticketId,
        phoneE164,
        clientName,
        clientDocument,
        sector,
        previousSector,
      },
      {
        timeout: 30000,
      }
    );

    console.log("[TEST-SIMULATOR] ✅ TRANSFER concluído");
    console.log(JSON.stringify(transferResponse.data, null, 2));

    // Aguardar um pouco
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Etapa 2: Messages
    console.log("\n[TEST-SIMULATOR] 📍 ETAPA 2: MESSAGES");
    const messageResponses = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      console.log(
        `[TEST-SIMULATOR] Mensagem ${i + 1}/${messages.length}: "${message}"`
      );
      console.log(
        "[TEST-SIMULATOR] Enviando para: POST /api/zapcontabil/webhook-message"
      );

      const messageResponse = await axios.post(
        "http://localhost:3000/api/zapcontabil/webhook-message",
        {
          ticketId,
          phoneE164,
          clientMessage: message,
        },
        {
          timeout: 30000,
        }
      );

      console.log(`[TEST-SIMULATOR] ✅ Mensagem ${i + 1} processada`);
      console.log(JSON.stringify(messageResponse.data, null, 2));
      messageResponses.push(messageResponse.data);

      // Aguardar um pouco entre mensagens
      if (i < messages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log("\n" + "═".repeat(80));
    console.log("[TEST-SIMULATOR] ✅ FULL-FLOW CONCLUÍDO COM SUCESSO");
    console.log("═".repeat(80) + "\n");

    return res.status(200).json({
      success: true,
      message: "Simulação de FULL-FLOW concluída",
      transfer: transferResponse.data,
      messages: messageResponses,
    });
  } catch (error: any) {
    console.error("\n" + "═".repeat(80));
    console.error("[TEST-SIMULATOR] ❌ ERRO NA SIMULAÇÃO");
    console.error(error.response?.data || error.message);
    console.error("═".repeat(80) + "\n");

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

export { router as testNfseFlowSimulatorRouter };
