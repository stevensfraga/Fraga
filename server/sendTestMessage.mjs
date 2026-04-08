import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ZAP_API_URL = "https://api-fraga.zapcontabil.chat";
const ZAP_API_KEY = process.env.WHATSAPP_API_KEY;

// Dados da R7 Geradores
const client = {
  nome: "R7 GERADORES LTDA",
  cnpj: "21.918.918/0001-94",
  telefone: "(27) 98165-7804",
  valor_aberto: 240.0,
  data_vencimento: "03/10/2025",
};

// Formatar número para padrão internacional
function formatPhoneNumber(phone) {
  // Remove caracteres especiais
  const cleaned = phone.replace(/\D/g, "");
  // Se começar com 0, remove
  const withoutZero = cleaned.startsWith("0") ? cleaned.substring(1) : cleaned;
  // Adiciona código do país (55 para Brasil)
  return `55${withoutZero}`;
}

// Mensagem de cobrança amigável
const message = `Olá ${client.nome}! 👋

Espero que esteja tudo bem! 

Gostaria de lembrá-lo sobre uma pendência em nossa conta:

💰 Valor: R$ ${client.valor_aberto}
📅 Vencimento: ${client.data_vencimento}
📌 CNPJ: ${client.cnpj}

Você poderia regularizar essa pendência? Isso nos ajudaria muito!

Se já realizou o pagamento, por favor desconsidere esta mensagem.

Qualquer dúvida, estou à disposição! 😊

Obrigado!`;

async function sendMessage() {
  try {
    if (!ZAP_API_KEY) {
      console.error("❌ WHATSAPP_API_KEY não configurada");
      process.exit(1);
    }

    const formattedPhone = formatPhoneNumber(client.telefone);
    console.log(`📱 Enviando para: ${formattedPhone}`);
    console.log(`👤 Cliente: ${client.nome}`);
    console.log(`💰 Valor: R$ ${client.valor_aberto}`);
    console.log(`\n📝 Mensagem:\n${message}\n`);

    const endpoint = `${ZAP_API_URL}/api/send/${formattedPhone}`;

    const response = await axios.post(
      endpoint,
      {
        body: message,
        connectionFrom: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        timeout: 10000,
      }
    );

    console.log(`✅ Resposta do servidor: ${response.status}`);
    console.log(JSON.stringify(response.data, null, 2));

    if (response.status === 200 || response.data.success) {
      console.log(`\n✅ Mensagem enviada com sucesso!`);
      console.log(`📌 ID: ${response.data.messageId || response.data.id || "sent"}`);
    } else {
      console.error(`❌ Erro: ${response.data.error || "Erro desconhecido"}`);
    }
  } catch (error) {
    console.error(`❌ Erro ao enviar mensagem:`);
    console.error(`Mensagem: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    process.exit(1);
  }
}

sendMessage();
