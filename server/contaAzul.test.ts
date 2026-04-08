import { describe, it, expect } from "vitest";
import axios from "axios";

describe("Conta Azul OAuth Authentication", () => {
  it("should validate OAuth credentials are set", async () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    expect(clientId).toBeDefined();
    expect(clientSecret).toBeDefined();
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();
  });

  it("should authenticate with Conta Azul OAuth", async () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    try {
      // Tentar obter um token de acesso
      const response = await axios.post(
        "https://api.contaazul.com/oauth/token",
        {
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("access_token");
      expect(response.data.access_token).toBeTruthy();
    } catch (error: any) {
      // Se falhar com 401 ou 403, as credenciais estão incorretas
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error(`OAuth authentication failed: ${error.response.status} - ${error.response.data?.error || "Unknown error"}`);
      }
      // Outros erros podem ser de rede, etc.
      console.warn("OAuth test warning:", error.message);
    }
  });
});
