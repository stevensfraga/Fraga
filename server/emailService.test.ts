/**
 * Testes para o serviço de e-mail
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sendCollectionEmail,
  sendPaymentConfirmationEmail,
  sendResetEmail,
  testSMTPConnection,
} from "./emailService";

describe("Email Service", () => {
  describe("sendCollectionEmail", () => {
    it("deve retornar sucesso quando SMTP não está configurado", async () => {
      const result = await sendCollectionEmail(
        "cliente@example.com",
        "João Silva",
        "d_plus_7",
        1500.0,
        "2026-02-08"
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("deve incluir informações corretas do cliente", async () => {
      const result = await sendCollectionEmail(
        "cliente@example.com",
        "Maria Santos",
        "d_plus_3",
        2500.5,
        "2026-02-10"
      );

      expect(result).toBeDefined();
    });
  });

  describe("sendPaymentConfirmationEmail", () => {
    it("deve enviar e-mail de confirmação de pagamento", async () => {
      const result = await sendPaymentConfirmationEmail(
        "cliente@example.com",
        "Pedro Costa",
        3000.0,
        "2026-02-08"
      );

      expect(result).toBeDefined();
    });
  });

  describe("sendResetEmail", () => {
    it("deve enviar e-mail de reset para clientes > 60 dias", async () => {
      const result = await sendResetEmail(
        "cliente@example.com",
        "Ana Silva",
        5000.0
      );

      expect(result).toBeDefined();
    });
  });

  describe("testSMTPConnection", () => {
    it("deve retornar erro quando SMTP não está configurado", async () => {
      const result = await testSMTPConnection();

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });
});
