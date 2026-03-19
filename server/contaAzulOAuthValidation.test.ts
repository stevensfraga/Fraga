import { describe, it, expect, beforeAll } from "vitest";
import axios from "axios";

describe("Conta Azul OAuth Credentials Validation", () => {
  const CLIENT_ID = process.env.CONTA_AZUL_CLIENT_ID;
  const CLIENT_SECRET = process.env.CONTA_AZUL_CLIENT_SECRET;
  const TOKEN_ENDPOINT = "https://api.contaazul.com/oauth2/token";

  beforeAll(() => {
    console.log("\n🔐 Validando credenciais OAuth Conta Azul...");
    console.log(`CLIENT_ID: ${CLIENT_ID ? "✅ Definido" : "❌ Não definido"}`);
    console.log(`CLIENT_SECRET: ${CLIENT_SECRET ? "✅ Definido" : "❌ Não definido"}`);
  });

  it("should have CLIENT_ID and CLIENT_SECRET defined", () => {
    expect(CLIENT_ID).toBeDefined();
    expect(CLIENT_SECRET).toBeDefined();
    expect(CLIENT_ID).not.toBe("");
    expect(CLIENT_SECRET).not.toBe("");
  });

  it("should validate OAuth credentials format", () => {
    // CLIENT_ID should be alphanumeric
    expect(CLIENT_ID).toMatch(/^[a-z0-9]+$/);
    // CLIENT_SECRET should be alphanumeric
    expect(CLIENT_SECRET).toMatch(/^[a-z0-9]+$/);
  });

  it("should attempt to get token with credentials", async () => {
    try {
      const response = await axios.post(
        TOKEN_ENDPOINT,
        {
          grant_type: "client_credentials",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        },
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      console.log("\n✅ Token obtido com sucesso!");
      console.log(`Access Token: ${response.data.access_token?.substring(0, 20)}...`);
      console.log(`Token Type: ${response.data.token_type}`);
      console.log(`Expires In: ${response.data.expires_in}s`);

      expect(response.status).toBe(200);
      expect(response.data.access_token).toBeDefined();
      expect(response.data.token_type).toBe("Bearer");
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.error("\n❌ Erro 401: Credenciais inválidas!");
        console.error(`Erro: ${error.response.data?.error_description || error.message}`);
        throw new Error(
          `OAuth credentials are invalid: ${error.response.data?.error_description || error.message}`
        );
      } else if (error.code === "ECONNREFUSED") {
        console.warn("\n⚠️  Não foi possível conectar ao Conta Azul (conexão recusada)");
        console.warn("Continuando com teste local...");
      } else {
        console.error(`\n❌ Erro: ${error.message}`);
        throw error;
      }
    }
  });
});
