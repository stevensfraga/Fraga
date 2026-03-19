#!/usr/bin/env node

/**
 * Script para renovar token do Conta Azul
 */

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_URL = process.env.CONTA_AZUL_API_URL || "https://api.contaazul.com";
const CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID;
const CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET;

console.log("🔄 Renovando token do Conta Azul...\n");

async function refreshToken() {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error("Client ID ou Client Secret não configurados");
    }

    console.log(`API URL: ${API_URL}`);
    console.log(`Client ID: ${CLIENT_ID}\n`);

    const response = await axios.post(
      `${API_URL}/oauth/token`,
      {
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000,
      }
    );

    const { access_token, expires_in } = response.data;

    console.log("✅ Token renovado com sucesso!\n");
    console.log(`Token: ${access_token.substring(0, 20)}...`);
    console.log(`Expira em: ${expires_in} segundos (${Math.round(expires_in / 3600)} horas)\n`);

    console.log("📝 Atualize o .env com:\n");
    console.log(`CONTA_AZUL_API_TOKEN=${access_token}\n`);

    return access_token;
  } catch (error) {
    if (error.response) {
      console.error("❌ Erro da API:");
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`❌ Erro: ${error.message}`);
    }
    process.exit(1);
  }
}

refreshToken();
