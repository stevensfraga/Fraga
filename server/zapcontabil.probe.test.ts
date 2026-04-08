import { describe, it, expect } from "vitest";
import axios from "axios";

const API_URL = process.env.ZAP_CONTABIL_API_URL;
const BEARER_JWT = process.env.ZAP_CONTABIL_BEARER_JWT;

describe("ZapContábil API Probe", () => {
  it("should authenticate with Bearer JWT and get response from /info", async () => {
    if (!API_URL || !BEARER_JWT) {
      throw new Error("Missing ZAP_CONTABIL_API_URL or ZAP_CONTABIL_BEARER_JWT");
    }

    try {
      const response = await axios.get(`${API_URL}/info`, {
        headers: {
          "Authorization": `Bearer ${BEARER_JWT}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      expect(response.status).toBeLessThan(500);
      expect(response.headers["content-type"]).toContain("application/json");
      
      console.log(`✅ Probe successful: ${response.status}`);
      console.log(`Response:`, JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        console.error(`❌ Authentication failed: ${error.response.status}`);
        console.error(`Response:`, error.response.data);
        throw new Error(`Bearer JWT authentication failed: ${error.response.status}`);
      }
      throw error;
    }
  });

  it("should validate API URL format", () => {
    expect(API_URL).toBeDefined();
    expect(API_URL).toContain("https://");
    expect(API_URL).toContain("zapcontabil");
  });

  it("should validate Bearer JWT format", () => {
    expect(BEARER_JWT).toBeDefined();
    expect(BEARER_JWT).toMatch(/^eyJ/);
    const parts = BEARER_JWT.split(".");
    expect(parts).toHaveLength(3);
  });
});
