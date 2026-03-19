import { describe, it, expect } from "vitest";

describe("OAuth Credentials Validation", () => {
  it("should have CONTA_AZUL_CLIENT_ID configured", () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId?.length).toBeGreaterThan(20);
    console.log("✅ CLIENT_ID configured:", clientId?.substring(0, 15) + "...");
  });

  it("should have CONTA_AZUL_CLIENT_SECRET configured", () => {
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
    expect(clientSecret).toBeDefined();
    expect(clientSecret?.length).toBeGreaterThan(40);
    console.log("✅ CLIENT_SECRET configured:", clientSecret?.substring(0, 15) + "...");
  });

  it("should validate CLIENT_ID format", () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    expect(clientId).toMatch(/^[a-z0-9]{20,}$/);
  });

  it("should validate CLIENT_SECRET format", () => {
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
    expect(clientSecret).toMatch(/^[a-z0-9]{40,}$/);
  });

  it("should generate valid OAuth URL", () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const redirectUri = "https://seu-dominio.com/api/conta-azul/callback";
    
    const authUrl = `https://api.contaazul.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=sales+finance`;
    
    expect(authUrl).toContain("https://api.contaazul.com/oauth2/authorize");
    expect(authUrl).toContain(`client_id=${clientId}`);
    expect(authUrl).toContain("scope=sales");
  });
});
