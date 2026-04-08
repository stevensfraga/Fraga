import { describe, it, expect, beforeAll } from "vitest";
import { getValidAccessToken } from "./contaAzulOAuthManager";
import axios from "axios";

describe("Conta Azul API Endpoints", () => {
  let accessToken: string;

  beforeAll(async () => {
    // Get valid access token from database
    try {
      accessToken = await getValidAccessToken();
      console.log("✅ Access token retrieved successfully");
    } catch (error) {
      console.error("❌ Failed to get access token:", error);
      throw error;
    }
  });

  it("should fetch companies list", async () => {
    try {
      const response = await axios.get("https://api.contaazul.com/v1/companies", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      console.log("✅ Companies fetched:", response.data);
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    } catch (error) {
      console.error("❌ Error fetching companies:", error);
      throw error;
    }
  });

  it("should fetch receivables with OPEN status", async () => {
    try {
      const response = await axios.get(
        "https://api.contaazul.com/v1/financial/receivables?status=OPEN,OVERDUE&include=bank_slip,customer",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Receivables fetched:", response.data);
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();

      // Validate that bank_slip.url is present
      if (response.data.data && Array.isArray(response.data.data)) {
        response.data.data.forEach((receivable: any) => {
          if (receivable.bank_slip) {
            expect(receivable.bank_slip.url).toBeDefined();
            console.log(`✅ Bank slip URL found: ${receivable.bank_slip.url}`);
          }
        });
      }
    } catch (error) {
      console.error("❌ Error fetching receivables:", error);
      throw error;
    }
  });

  it("should fetch financial charges", async () => {
    try {
      const response = await axios.get(
        "https://api.contaazul.com/v1/financial/charges",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Charges fetched:", response.data);
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    } catch (error) {
      console.error("❌ Error fetching charges:", error);
      throw error;
    }
  });

  it("should fetch sales invoices", async () => {
    try {
      const response = await axios.get(
        "https://api.contaazul.com/v1/sales/invoices",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Invoices fetched:", response.data);
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    } catch (error) {
      console.error("❌ Error fetching invoices:", error);
      throw error;
    }
  });
});
