#!/usr/bin/env node

/**
 * Script para fazer login no Conta Azul e gerar novo token
 */

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_URL = process.env.CONTA_AZUL_API_URL || "https://api.contaazul.com";
const EMAIL = process.env.ACESSORIAS_EMAIL;
const PASSWORD = process.env.ACESSORIAS_PASSWORD;
const CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID;
const CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET;

console.log("🔐 Tentando fazer login no Conta Azul...\n");
console.log(`Email: ${EMAIL ? "✅ Configurado" : "❌ Não configurado"}`);
console.log(`Senha: ${PASSWORD ? "✅ Configurado" : "❌ Não configurado"}`);
console.log(`Client ID: ${CLIENT_ID ? "✅ Configurado" : "❌ Não configurado"}`);
console.log(`Client Secret: ${CLIENT_SECRET ? "✅ Configurado" : "❌ Não configurado"}\n`);

async function loginAndGetToken() {
  try {
    if (!EMAIL || !PASSWORD) {
      throw new Error("Email ou senha não configurados");
    }

    // Tentar fazer login com Resource Owner Password Credentials flow
    console.log("📝 Tentando autenticação com Resource Owner Password Credentials...\n");

    const response = await axios.post(
      `${API_URL}/oauth/token`,
      {
        grant_type: "password",
        username: EMAIL,
        password: PASSWORD,
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

    const { access_token, expires_in, refresh_token } = response.data;

    console.log("✅ Login bem-sucedido!\n");
    console.log(`Token: ${access_token.substring(0, 30)}...`);
    console.log(`Expira em: ${expires_in} segundos (${Math.round(expires_in / 3600)} horas)`);
    console.log(`Refresh Token: ${refresh_token ? "✅ Disponível" : "❌ Não disponível"}\n`);

    console.log("📝 Atualize o .env com:\n");
    console.log(`CONTA_AZUL_API_TOKEN=${access_token}\n`);

    if (refresh_token) {
      console.log(`CONTA_AZUL_REFRESH_TOKEN=${refresh_token}\n`);
    }

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

loginAndGetToken();
