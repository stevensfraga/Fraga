import axios from "axios";

const WEBHOOK_URL = "http://localhost:3000/api/trpc/webhook.receiveMessage";

// Simular resposta positiva do cliente
const testPayload = {
  message: {
    id: "3EB04EF08CD7D0668CE63E_TEST",
    body: "Vou pagar amanhã, sem problema! Obrigado pela lembrança.",
    type: "text",
    subtype: "text",
    isMedia: false,
    myContact: false,
    fromMe: false,
    contactId: 2,
    ticketId: 7993,
    timestamp: Date.now(),
    from: "5527981657804",
    to: "5527981657804",
    contact: {
      id: 2,
      name: "R7 GERADORES LTDA",
      number: "5527981657804",
    },
  },
  connection: {
    id: 1,
    name: "fraga-connection",
  },
  event: "message.create",
};

async function testWebhook() {
  try {
    console.log("📤 Enviando teste de webhook...\n");
    console.log("Payload:");
    console.log(JSON.stringify(testPayload, null, 2));
    console.log("\n");

    const response = await axios.post(WEBHOOK_URL, testPayload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log("✅ Resposta do webhook:");
    console.log(`Status: ${response.status}`);
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("❌ Erro ao testar webhook:");
    console.error(`Mensagem: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    process.exit(1);
  }
}

testWebhook();
