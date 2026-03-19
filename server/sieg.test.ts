/**
 * Testes de integração com a API SIEG
 * Valida que a SIEG_API_KEY está configurada e que a conexão funciona.
 */

import { describe, it, expect } from "vitest";
import { testSiegConnection, listarCertificadosSieg } from "./services/siegService";

describe("SIEG API Integration", () => {
  it("deve ter SIEG_API_KEY configurada", () => {
    const apiKey = process.env.SIEG_API_KEY;
    expect(apiKey).toBeTruthy();
    expect(apiKey?.length).toBeGreaterThan(5);
  });

  it("deve conectar ao SIEG e listar certificados", async () => {
    const result = await testSiegConnection();
    console.log("SIEG testConnection result:", JSON.stringify(result));

    // A conexão deve funcionar (ok: true) com a chave correta
    expect(result.ok).toBe(true);
    expect(result.message).toContain("OK");
    // certificatesCount pode ser 0 ou mais
    expect(typeof result.certificatesCount).toBe("number");
  }, 30_000); // timeout 30s para chamada de rede

  it("deve listar certificados do SIEG", async () => {
    const result = await listarCertificadosSieg();
    console.log("SIEG listar result:", JSON.stringify({ success: result.success, count: result.data?.length, error: result.error }));

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  }, 30_000);
});
