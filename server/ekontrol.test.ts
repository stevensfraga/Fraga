import { describe, it, expect } from "vitest";

describe("eKontrol API Keys", () => {
  it("should connect to eKontrol and list companies", async () => {
    const apiKey = process.env.EKONTROL_API_KEY;
    const apiKeyEmpresa = process.env.EKONTROL_API_KEY_EMPRESA;

    expect(apiKey).toBeTruthy();
    expect(apiKeyEmpresa).toBeTruthy();

    const body = new URLSearchParams({
      api_key: apiKey!,
      api_key_empresa: apiKeyEmpresa!,
    });

    const res = await fetch("https://app.e-kontroll.com.br/api/v1/metodo/listar_empresas", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.status).toBe(200);
    expect(json.dados?.data).toBeDefined();
    expect(Array.isArray(json.dados.data)).toBe(true);
    expect(json.dados.data.length).toBeGreaterThan(0);
  });
});
