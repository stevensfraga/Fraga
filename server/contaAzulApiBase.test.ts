import { describe, it, expect } from "vitest";
import axios from "axios";
import { db } from "./db";
import { contaAzulTokens } from "../drizzle/schema";

describe("Conta Azul API Base", () => {
  it("should fetch categories from api-v2 endpoint using token from DB", async () => {
    const apiBase = process.env.CONTA_AZUL_API_BASE;
    expect(apiBase).toBeDefined();

    // Buscar token mais recente do banco
    const tokenRecord = await db
      .select()
      .from(contaAzulTokens)
      .orderBy((t) => t.updatedAt)
      .limit(1);

    expect(tokenRecord).toHaveLength(1);
    const token = tokenRecord[0]?.accessToken;
    expect(token).toBeDefined();

    console.log("✅ Token encontrado no DB");
    console.log("Token (primeiros 10 chars):", token?.substring(0, 10));

    try {
      const response = await axios.get(`${apiBase}/categorias`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      console.log("✅ API Base test passed");
      console.log("Status:", response.status);
      console.log("Data received:", JSON.stringify(response.data).substring(0, 150));

      expect(response.status).toBe(200);
    } catch (error: any) {
      console.error("❌ API Base test failed");
      console.error("Status:", error.response?.status);
      console.error("Error:", error.response?.data || error.message);
      throw error;
    }
  });
});
