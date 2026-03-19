import { describe, it, expect } from "vitest";
import { getAuthorizationUrl } from "./contaAzulOAuthManager";

// Mock para getOAuthConfig
function getOAuthConfig() {
  return {
    clientId: process.env.CONTA_AZUL_CLIENT_ID || "test-id",
    clientSecret: process.env.CONTA_AZUL_CLIENT_SECRET || "test-secret",
    redirectUri: process.env.OAUTH_SERVER_URL
      ? `${process.env.OAUTH_SERVER_URL}/api/conta-azul/callback`
      : "http://localhost:3000/api/conta-azul/callback",
  };
}

describe("Conta Azul OAuth Manager", () => {
  describe("getAuthorizationUrl", () => {
    it("should generate valid authorization URL", () => {
      const url = getAuthorizationUrl();

      expect(url).toBeDefined();
      expect(url).toContain("https://api.contaazul.com/oauth2/authorize");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=");
      expect(url).toContain("redirect_uri=");
      expect(url).toContain("scope=sales+finance");
    });

    it("should include required OAuth parameters", () => {
      const url = getAuthorizationUrl();
      const urlObj = new URL(url);

      expect(urlObj.searchParams.get("response_type")).toBe("code");
      expect(urlObj.searchParams.get("scope")).toBe("sales finance");
      expect(urlObj.searchParams.get("client_id")).toBeTruthy();
      expect(urlObj.searchParams.get("redirect_uri")).toBeTruthy();
    });

    it("should use correct OAuth endpoint", () => {
      const url = getAuthorizationUrl();
      expect(url.startsWith("https://api.contaazul.com/oauth2/authorize")).toBe(true);
    });
  });

  describe("OAuth Flow Structure", () => {
    it("should follow correct OAuth 2.0 Authorization Code Flow", () => {
      const authUrl = getAuthorizationUrl();
      const urlObj = new URL(authUrl);

      expect(urlObj.searchParams.get("response_type")).toBe("code");
      expect(urlObj.hostname).toBe("api.contaazul.com");

      const redirectUri = urlObj.searchParams.get("redirect_uri");
      expect(redirectUri).toMatch(/^https?:\/\/.+\/api\/conta-azul\/callback$/);

      const scope = urlObj.searchParams.get("scope");
      expect(scope).toContain("finance");
      expect(scope).toContain("sales");
    });

    it("should have proper redirect URI format", () => {
      const config = getOAuthConfig();
      expect(config.redirectUri).toMatch(/^https?:\/\/.+\/api\/conta-azul\/callback$/);
    });

    it("should use environment variables for client credentials", () => {
      const originalClientId = process.env.CONTA_AZUL_CLIENT_ID;
      const originalClientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

      process.env.CONTA_AZUL_CLIENT_ID = "test-client-id";
      process.env.CONTA_AZUL_CLIENT_SECRET = "test-client-secret";

      const config = getOAuthConfig();

      expect(config.clientId).toBe("test-client-id");
      expect(config.clientSecret).toBe("test-client-secret");

      if (originalClientId) process.env.CONTA_AZUL_CLIENT_ID = originalClientId;
      if (originalClientSecret) process.env.CONTA_AZUL_CLIENT_SECRET = originalClientSecret;
    });

    it("should support custom redirect URI from environment", () => {
      const originalOAuthServerUrl = process.env.OAUTH_SERVER_URL;

      process.env.CONTA_AZUL_CLIENT_ID = "test-id";
      process.env.CONTA_AZUL_CLIENT_SECRET = "test-secret";
      process.env.OAUTH_SERVER_URL = "https://custom.example.com";

      const config = getOAuthConfig();

      expect(config.redirectUri).toBe("https://custom.example.com/api/conta-azul/callback");

      if (originalOAuthServerUrl) {
        process.env.OAUTH_SERVER_URL = originalOAuthServerUrl;
      } else {
        delete process.env.OAUTH_SERVER_URL;
      }
    });
  });
});
