/**
 * 🧪 Testes Unitários para Sistema de Envio do Primeiro Boleto
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  formatCurrency,
  formatDate,
  validateWhatsAppNumber,
  validateBankSlipUrl,
  prepareMessage,
  validatePreparedMessage,
} from "./messagePreparation";
import { isBusinessHours } from "./secureDispatch";

describe("Message Preparation Service", () => {
  describe("formatCurrency", () => {
    it("deve formatar valor em moeda brasileira", () => {
      expect(formatCurrency(5000)).toBe("R$ 5.000,00");
      expect(formatCurrency(1234.56)).toBe("R$ 1.234,56");
      expect(formatCurrency(0.01)).toBe("R$ 0,01");
    });

    it("deve lidar com valores grandes", () => {
      expect(formatCurrency(1000000)).toBe("R$ 1.000.000,00");
    });

    it("deve lidar com valores negativos", () => {
      expect(formatCurrency(-5000)).toBe("-R$ 5.000,00");
    });
  });

  describe("formatDate", () => {
    it("deve formatar data em formato brasileiro", () => {
      const date = new Date("2026-02-28");
      expect(formatDate(date)).toBe("28/02/2026");
    });

    it("deve lidar com datas no início do mês", () => {
      const date = new Date("2026-02-01");
      expect(formatDate(date)).toBe("01/02/2026");
    });

    it("deve lidar com datas em diferentes meses", () => {
      expect(formatDate(new Date("2026-01-15"))).toBe("15/01/2026");
      expect(formatDate(new Date("2026-12-31"))).toBe("31/12/2026");
    });
  });

  describe("validateWhatsAppNumber", () => {
    it("deve validar número WhatsApp correto", () => {
      const result = validateWhatsAppNumber("+5511999999999");
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("deve validar número sem +55", () => {
      const result = validateWhatsAppNumber("11999999999");
      expect(result.isValid).toBe(true);
    });

    it("deve rejeitar número com poucos dígitos", () => {
      const result = validateWhatsAppNumber("+551199999");
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("deve rejeitar número com muitos dígitos", () => {
      const result = validateWhatsAppNumber("+551199999999999");
      expect(result.isValid).toBe(false);
    });

    it("deve rejeitar número com caracteres inválidos", () => {
      const result = validateWhatsAppNumber("+55 11 9999-9999");
      expect(result.isValid).toBe(false);
    });
  });

  describe("validateBankSlipUrl", () => {
    it("deve validar URL HTTPS válida", () => {
      const result = validateBankSlipUrl("https://conta-azul.com/boleto/123456");
      expect(result.isValid).toBe(true);
    });

    it("deve rejeitar URL HTTP", () => {
      const result = validateBankSlipUrl("http://conta-azul.com/boleto/123456");
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("deve rejeitar URL inválida", () => {
      const result = validateBankSlipUrl("not-a-url");
      expect(result.isValid).toBe(false);
    });

    it("deve validar URL com parâmetros", () => {
      const result = validateBankSlipUrl(
        "https://conta-azul.com/boleto/123456?token=abc&ref=xyz"
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe("prepareMessage", () => {
    const validData = {
      customerName: "R7 Geradores",
      whatsappNumber: "+5511999999999",
      amount: 5000,
      dueDate: new Date("2026-02-28"),
      bankSlipUrl: "https://conta-azul.com/boleto/123456",
    };

    it("deve preparar mensagem amigável válida", () => {
      const result = prepareMessage(validData);

      expect(result.validation.isValid).toBe(true);
      expect(result.validation.errors).toHaveLength(0);
      expect(result.message).toContain("R7 Geradores");
      expect(result.message).toContain("R$ 5.000,00");
      expect(result.message).toContain("28/02/2026");
      expect(result.formattedAmount).toBe("R$ 5.000,00");
      expect(result.formattedDueDate).toBe("28/02/2026");
    });

    it("deve gerar mensagem administrativa", () => {
      const result = prepareMessage({
        ...validData,
        messageType: "administrative",
      });

      expect(result.validation.isValid).toBe(true);
      expect(result.message).toContain("Informamos");
    });

    it("deve gerar mensagem formal", () => {
      const result = prepareMessage({
        ...validData,
        messageType: "formal",
      });

      expect(result.validation.isValid).toBe(true);
      expect(result.message).toContain("Prezado");
    });

    it("deve rejeitar número WhatsApp inválido", () => {
      const result = prepareMessage({
        ...validData,
        whatsappNumber: "invalid",
      });

      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors.length).toBeGreaterThan(0);
    });

    it("deve rejeitar URL inválida", () => {
      const result = prepareMessage({
        ...validData,
        bankSlipUrl: "http://invalid.com",
      });

      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors.length).toBeGreaterThan(0);
    });

    it("deve rejeitar valor zero", () => {
      const result = prepareMessage({
        ...validData,
        amount: 0,
      });

      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors.length).toBeGreaterThan(0);
    });

    it("deve rejeitar nome vazio", () => {
      const result = prepareMessage({
        ...validData,
        customerName: "",
      });

      expect(result.validation.isValid).toBe(false);
    });

    it("deve avisar sobre boleto vencido", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = prepareMessage({
        ...validData,
        dueDate: yesterday,
      });

      expect(result.validation.warnings.length).toBeGreaterThan(0);
      expect(result.validation.warnings[0]).toContain("vencido");
    });

    it("deve avisar sobre boleto vencendo em breve", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = prepareMessage({
        ...validData,
        dueDate: tomorrow,
      });

      expect(result.validation.warnings.length).toBeGreaterThan(0);
      expect(result.validation.warnings[0]).toContain("vence");
    });
  });

  describe("validatePreparedMessage", () => {
    const validPrepared = {
      whatsappNumber: "+5511999999999",
      message: "Teste de mensagem",
      formattedAmount: "R$ 5.000,00",
      formattedDueDate: "28/02/2026",
      validation: {
        isValid: true,
        errors: [],
        warnings: [],
      },
    };

    it("deve validar mensagem preparada válida", () => {
      const result = validatePreparedMessage(validPrepared);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("deve rejeitar mensagem com erros de validação", () => {
      const result = validatePreparedMessage({
        ...validPrepared,
        validation: {
          isValid: false,
          errors: ["Número inválido"],
          warnings: [],
        },
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Número inválido");
    });

    it("deve rejeitar mensagem vazia", () => {
      const result = validatePreparedMessage({
        ...validPrepared,
        message: "",
      });

      expect(result.isValid).toBe(false);
    });

    it("deve rejeitar mensagem muito longa", () => {
      const result = validatePreparedMessage({
        ...validPrepared,
        message: "a".repeat(5000),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("muito longa");
    });
  });
});

describe("Secure Dispatch Service", () => {
  describe("isBusinessHours", () => {
    it("deve permitir envio em horário comercial", () => {
      // Mock de um horário comercial (10h numa terça)
      const mockDate = new Date("2026-02-10T10:00:00"); // Terça-feira
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = isBusinessHours();

      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("deve bloquear envio antes das 8h", () => {
      const mockDate = new Date("2026-02-10T07:59:00"); // 7:59
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = isBusinessHours();

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();

      vi.useRealTimers();
    });

    it("deve bloquear envio após as 18h", () => {
      const mockDate = new Date("2026-02-10T18:01:00"); // 18:01
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = isBusinessHours();

      expect(result.allowed).toBe(false);

      vi.useRealTimers();
    });

    it("deve bloquear envio no sábado", () => {
      const mockDate = new Date("2026-02-13T10:00:00"); // Sábado
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = isBusinessHours();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("sábado");

      vi.useRealTimers();
    });

    it("deve bloquear envio no domingo", () => {
      const mockDate = new Date("2026-02-14T10:00:00"); // Domingo
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const result = isBusinessHours();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("domingo");

      vi.useRealTimers();
    });
  });
});
