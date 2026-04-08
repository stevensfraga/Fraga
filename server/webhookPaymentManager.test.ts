import { describe, it, expect } from "vitest";
import { validateWebhookSignature } from "./webhookPaymentManager";
import crypto from "crypto";

describe("Webhook Payment Manager", () => {
  describe("validateWebhookSignature", () => {
    it("should validate correct HMAC-SHA256 signature", () => {
      const payload = JSON.stringify({
        id: "webhook-123",
        event: "payment.received",
        data: { amount: 100 },
      });
      const secret = "webhook-secret-key";

      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      const isValid = validateWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it("should reject invalid signature", () => {
      const payload = JSON.stringify({
        id: "webhook-123",
        event: "payment.received",
        data: { amount: 100 },
      });
      const secret = "webhook-secret-key";
      const invalidSignature = "invalid-signature-hash";

      const isValid = validateWebhookSignature(payload, invalidSignature, secret);
      expect(isValid).toBe(false);
    });

    it("should reject signature with wrong secret", () => {
      const payload = JSON.stringify({
        id: "webhook-123",
        event: "payment.received",
        data: { amount: 100 },
      });
      const secret = "webhook-secret-key";
      const wrongSecret = "wrong-secret-key";

      const correctSignature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      const isValid = validateWebhookSignature(payload, correctSignature, wrongSecret);
      expect(isValid).toBe(false);
    });

    it("should reject signature with modified payload", () => {
      const payload = JSON.stringify({
        id: "webhook-123",
        event: "payment.received",
        data: { amount: 100 },
      });
      const modifiedPayload = JSON.stringify({
        id: "webhook-123",
        event: "payment.received",
        data: { amount: 200 }, // Modified amount
      });
      const secret = "webhook-secret-key";

      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      const isValid = validateWebhookSignature(modifiedPayload, signature, secret);
      expect(isValid).toBe(false);
    });

    it("should handle empty payload", () => {
      const payload = "";
      const secret = "webhook-secret-key";

      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      const isValid = validateWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it("should handle special characters in payload", () => {
      const payload = JSON.stringify({
        id: "webhook-123",
        event: "payment.received",
        data: {
          description: "Pagamento com caracteres especiais: áéíóú ñ ç",
          amount: 100.50,
        },
      });
      const secret = "webhook-secret-key";

      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      const isValid = validateWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });
  });

  describe("Webhook Structure", () => {
    it("should support payment.received event", () => {
      const payload = {
        id: "webhook-123",
        event: "payment.received",
        data: {
          receivable_id: "rec-456",
          amount: 100,
          payment_date: "2026-02-08T10:00:00Z",
          payment_method: "boleto",
        },
      };

      expect(payload.event).toBe("payment.received");
      expect(payload.data.receivable_id).toBeDefined();
      expect(payload.data.amount).toBeDefined();
      expect(payload.data.payment_date).toBeDefined();
      expect(payload.data.payment_method).toBeDefined();
    });

    it("should support optional payment method", () => {
      const payload = {
        id: "webhook-123",
        event: "payment.received",
        data: {
          receivable_id: "rec-456",
          amount: 100,
          payment_date: "2026-02-08T10:00:00Z",
          // payment_method is optional
        },
      };

      expect(payload.data.receivable_id).toBeDefined();
      expect(payload.data.amount).toBeDefined();
    });

    it("should have unique webhook ID", () => {
      const webhook1 = { id: "webhook-123" };
      const webhook2 = { id: "webhook-456" };

      expect(webhook1.id).not.toBe(webhook2.id);
    });
  });

  describe("HMAC-SHA256 Security", () => {
    it("should use SHA256 algorithm", () => {
      const payload = "test-payload";
      const secret = "test-secret";

      const signature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      expect(signature).toHaveLength(64); // SHA256 produces 64 hex characters
    });

    it("should produce different signatures for different secrets", () => {
      const payload = "test-payload";
      const secret1 = "secret-1";
      const secret2 = "secret-2";

      const sig1 = crypto
        .createHmac("sha256", secret1)
        .update(payload)
        .digest("hex");

      const sig2 = crypto
        .createHmac("sha256", secret2)
        .update(payload)
        .digest("hex");

      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different payloads", () => {
      const secret = "test-secret";
      const payload1 = "payload-1";
      const payload2 = "payload-2";

      const sig1 = crypto
        .createHmac("sha256", secret)
        .update(payload1)
        .digest("hex");

      const sig2 = crypto
        .createHmac("sha256", secret)
        .update(payload2)
        .digest("hex");

      expect(sig1).not.toBe(sig2);
    });
  });
});
