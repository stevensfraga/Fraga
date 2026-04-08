/**
 * Fluxo OAuth 2.0 para Conta Azul
 * Implementa Authorization Code Flow
 */

import axios from "axios";

const API_URL = process.env.CONTA_AZUL_API_URL || "https://api.contaazul.com";
const AUTH_URL = "https://auth.contaazul.com";
const CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID;
const CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET;
const REDIRECT_URI = process.env.CONTA_AZUL_REDIRECT_URI || "https://dashboard.fragacontabilidade.com.br/api/oauth/callback";

/**
 * Gerar URL de autorização
 */
export function getAuthorizationUrl(): string {
  if (!CLIENT_ID) {
    throw new Error("CLIENT_ID não configurado");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "read write",
  });

  return `${AUTH_URL}/login?${params.toString()}`;
}

/**
 * Trocar código de autorização por token
 */
export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("CLIENT_ID ou CLIENT_SECRET não configurados");
  }

  try {
    console.log("[ContaAzul OAuth] Trocando código por token...");

    const response = await axios.post(
      `${API_URL}/oauth/token`,
      {
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000,
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    console.log("[ContaAzul OAuth] ✅ Token obtido com sucesso!");
    console.log(`[ContaAzul OAuth] Expira em: ${expires_in} segundos`);

    return {
      access_token,
      refresh_token,
      expires_in,
    };
  } catch (error: any) {
    console.error("[ContaAzul OAuth] ❌ Erro ao trocar código por token:");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error(`Erro: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Renovar token usando refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{
  access_token: string;
  expires_in: number;
}> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("CLIENT_ID ou CLIENT_SECRET não configurados");
  }

  try {
    console.log("[ContaAzul OAuth] Renovando token...");

    const response = await axios.post(
      `${API_URL}/oauth/token`,
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
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

    console.log("[ContaAzul OAuth] ✅ Token renovado com sucesso!");

    return {
      access_token,
      expires_in,
    };
  } catch (error: any) {
    console.error("[ContaAzul OAuth] ❌ Erro ao renovar token:");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error(`Erro: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Buscar contas a receber com token válido
 */
export async function fetchContasReceber(accessToken: string): Promise<any[]> {
  try {
    console.log("[ContaAzul API] Buscando contas a receber...");

    const response = await axios.get(`${API_URL}/v1/contas-receber`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
    console.log(`[ContaAzul API] ✅ ${contas.length} contas encontradas`);

    return contas;
  } catch (error: any) {
    console.error("[ContaAzul API] ❌ Erro ao buscar contas:");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error(`Erro: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Buscar clientes
 */
export async function fetchClientes(accessToken: string): Promise<any[]> {
  try {
    console.log("[ContaAzul API] Buscando clientes...");

    const response = await axios.get(`${API_URL}/v1/clientes`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const clientes = response.data.data || [];
    console.log(`[ContaAzul API] ✅ ${clientes.length} clientes encontrados`);

    return clientes;
  } catch (error: any) {
    console.error("[ContaAzul API] ❌ Erro ao buscar clientes:");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Dados: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error(`Erro: ${error.message}`);
    }
    throw error;
  }
}
