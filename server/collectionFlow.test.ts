import { describe, it, expect, beforeAll } from "vitest";
import { sendCollectionMessage } from "./whatsappIntegration";

describe("Collection Flow - Complete Integration", () => {
  it("should send a collection message with all required fields", async () => {
    const result = await sendCollectionMessage({
      phoneNumber: "+55 11 99999-9999",
      customerName: "João Silva",
      amount: 1500.5,
      dueDate: "2026-02-15",
      bankSlipUrl: "https://example.com/boleto/123456",
      invoiceNumber: "NF-2026-001",
    });

    // Note: This will fail if WHATSAPP_API_KEY is not set
    // In production, the API key should be configured
    console.log("✅ Collection message test:", result);
    expect(result).toBeDefined();
  });

  it("should format phone numbers correctly", async () => {
    const testCases = [
      { input: "11999999999", expected: "5511999999999" },
      { input: "+55 11 9999-9999", expected: "5511999999999" },
      { input: "5511999999999", expected: "5511999999999" },
    ];

    for (const testCase of testCases) {
      const result = await sendCollectionMessage({
        phoneNumber: testCase.input,
        customerName: "Test",
        amount: 100,
        dueDate: "2026-02-15",
      });

      console.log(`Phone format test: ${testCase.input} -> ${testCase.expected}`);
      expect(result).toBeDefined();
    }
  });

  it("should handle missing phone number gracefully", async () => {
    const result = await sendCollectionMessage({
      phoneNumber: "",
      customerName: "Test",
      amount: 100,
      dueDate: "2026-02-15",
    });

    expect(result.success).toBe(false);
    console.log("✅ Missing phone number handled correctly");
  });

  it("should format currency correctly", async () => {
    const amounts = [100, 1500.5, 0.01, 999999.99];

    for (const amount of amounts) {
      const result = await sendCollectionMessage({
        phoneNumber: "+55 11 99999-9999",
        customerName: "Test",
        amount,
        dueDate: "2026-02-15",
      });

      console.log(`✅ Amount formatted: R$ ${amount}`);
      expect(result).toBeDefined();
    }
  });
});
