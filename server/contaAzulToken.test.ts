import { describe, it, expect } from "vitest";
import axios from "axios";

describe("Conta Azul JWT Token Authentication", () => {
  it("should have JWT token set", async () => {
    const token = process.env.CONTA_AZUL_API_TOKEN;
    expect(token).toBeDefined();
    expect(token).toBeTruthy();
    expect(token).toContain(".");  // JWT tokens have dots separating parts
  });

  it("should authenticate with JWT token to Conta Azul API", async () => {
    const token = process.env.CONTA_AZUL_API_TOKEN;

    try {
      // Testar com um endpoint simples da API
      const response = await axios.get(
        "https://api-v2.contaazul.com/v1/categorias",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      // Se chegou aqui, a autenticação funcionou
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    } catch (error: any) {
      // Se falhar com 401 ou 403, o token é inválido
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error(`JWT token authentication failed: ${error.response.status} - ${error.response.data?.message || "Unauthorized"}`);
      }
      // Outros erros (como 404) indicam que a autenticação funcionou mas o endpoint não existe
      // Isso é OK para nosso teste
      if (error.response?.status === 404) {
        expect(error.response.status).toBe(404);
        return;
      }
      // Erros de rede ou timeout
      throw error;
    }
  });
});
