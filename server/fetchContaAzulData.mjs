#!/usr/bin/env node

/**
 * Script para buscar dados reais do Conta Azul
 * Busca clientes com contas a receber em atraso
 */

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_URL = process.env.CONTA_AZUL_API_URL || "https://api.contaazul.com";
const TOKEN = process.env.CONTA_AZUL_API_TOKEN;
const CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID;
const CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET;

console.log("🔍 Buscando dados do Conta Azul...\n");
console.log(`API URL: ${API_URL}`);
console.log(`Token: ${TOKEN ? "✅ Configurado" : "❌ Não configurado"}`);
console.log(`Client ID: ${CLIENT_ID ? "✅ Configurado" : "❌ Não configurado"}`);
console.log(`Client Secret: ${CLIENT_SECRET ? "✅ Configurado" : "❌ Não configurado"}\n`);

async function fetchContaAzulData() {
  try {
    if (!TOKEN) {
      throw new Error("Token do Conta Azul não configurado");
    }

    // Buscar contas a receber
    console.log("📊 Buscando contas a receber em atraso...\n");

    const response = await axios.get(`${API_URL}/v1/contas-receber`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      params: {
        status: "aberto",
        sort: "dataVencimento",
        order: "asc",
      },
      timeout: 15000,
    });

    const contas = response.data.data || [];
    console.log(`✅ Total de contas em aberto: ${contas.length}\n`);

    // Filtrar contas vencidas
    const hoje = new Date();
    const contasVencidas = contas.filter((conta) => {
      const vencimento = new Date(conta.dataVencimento);
      return vencimento < hoje;
    });

    console.log(`⚠️  Contas vencidas: ${contasVencidas.length}\n`);

    if (contasVencidas.length > 0) {
      console.log("📋 Primeiras 10 contas vencidas:\n");

      contasVencidas.slice(0, 10).forEach((conta, index) => {
        const vencimento = new Date(conta.dataVencimento);
        const hoje = new Date();
        const diasAtraso = Math.floor(
          (hoje - vencimento) / (1000 * 60 * 60 * 24)
        );

        console.log(`${index + 1}. ${conta.cliente?.nome || "Cliente Desconhecido"}`);
        console.log(`   CNPJ: ${conta.cliente?.cnpj || "N/A"}`);
        console.log(`   Valor: R$ ${conta.valor?.toFixed(2) || "0.00"}`);
        console.log(`   Vencimento: ${conta.dataVencimento}`);
        console.log(`   Dias em atraso: ${diasAtraso}`);
        console.log(`   Número: ${conta.numero || "N/A"}`);
        console.log(`   ID: ${conta.id}\n`);
      });
    }

    // Buscar clientes
    console.log("👥 Buscando clientes...\n");

    const clientesResponse = await axios.get(`${API_URL}/v1/clientes`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const clientes = clientesResponse.data.data || [];
    console.log(`✅ Total de clientes: ${clientes.length}\n`);

    if (clientes.length > 0) {
      console.log("📋 Primeiros 5 clientes:\n");

      clientes.slice(0, 5).forEach((cliente, index) => {
        console.log(`${index + 1}. ${cliente.nome}`);
        console.log(`   CNPJ/CPF: ${cliente.cnpj || cliente.cpf || "N/A"}`);
        console.log(`   Email: ${cliente.email || "N/A"}`);
        console.log(`   Telefone: ${cliente.telefone || "N/A"}`);
        console.log(`   ID: ${cliente.id}\n`);
      });
    }

    console.log("✅ Dados do Conta Azul obtidos com sucesso!\n");

    return {
      contas,
      contasVencidas,
      clientes,
    };
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

fetchContaAzulData();
