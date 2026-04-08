import { describe, it, expect } from "vitest";
import { validateWhatsAppNumber, formatWhatsAppNumber, generateMessage } from "./whatsapp";

describe("WhatsApp Integration", () => {
  describe("validateWhatsAppNumber", () => {
    it("should validate Brazilian phone numbers", () => {
      expect(validateWhatsAppNumber("5511999999999")).toBe(true);
      expect(validateWhatsAppNumber("11999999999")).toBe(true);
      expect(validateWhatsAppNumber("(11) 99999-9999")).toBe(true);
    });

    it("should reject invalid phone numbers", () => {
      expect(validateWhatsAppNumber("123")).toBe(false);
      expect(validateWhatsAppNumber("")).toBe(false);
    });
  });

  describe("formatWhatsAppNumber", () => {
    it("should format Brazilian numbers correctly", () => {
      expect(formatWhatsAppNumber("11999999999")).toBe("5511999999999");
      expect(formatWhatsAppNumber("(11) 99999-9999")).toBe("5511999999999");
    });

    it("should preserve already formatted numbers", () => {
      expect(formatWhatsAppNumber("5511999999999")).toBe("5511999999999");
    });
  });

  describe("generateMessage", () => {
    it("should generate friendly message", () => {
      const message = generateMessage(
        "friendly",
        "João Silva",
        "1.500,00",
        1,
        "15/02/2026"
      );
      expect(message).toContain("João Silva");
      expect(message).toContain("1.500,00");
      expect(message).toContain("15/02/2026");
    });

    it("should generate administrative message", () => {
      const message = generateMessage(
        "administrative",
        "Maria Santos",
        "2.000,00",
        2,
        "01/02/2026"
      );
      expect(message).toContain("Maria Santos");
      expect(message).toContain("2.000,00");
      expect(message).toContain("últimos 2 mês");
    });

    it("should generate formal message", () => {
      const message = generateMessage(
        "formal",
        "Carlos Costa",
        "5.000,00"
      );
      expect(message).toContain("Carlos Costa");
      expect(message).toContain("5.000,00");
      expect(message).toContain("suspensos");
    });
  });

  describe("API Key Validation", () => {
    it("should have WHATSAPP_API_KEY configured", () => {
      const apiKey = process.env.WHATSAPP_API_KEY;
      expect(apiKey).toBeDefined();
      expect(apiKey!.length).toBeGreaterThan(100);
      expect(apiKey).toMatch(/^[a-f0-9]+$/);
    });
  });
});
