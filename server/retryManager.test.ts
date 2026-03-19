import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeWithRetry, createRetryConfig, getDefaultRetryConfig } from "./retryManager";

describe("Retry Manager", () => {
  describe("getDefaultRetryConfig", () => {
    it("deve retornar configuração padrão", () => {
      const config = getDefaultRetryConfig();
      expect(config.maxRetries).toBe(3);
      expect(config.initialDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.timeoutMs).toBe(10000);
    });
  });

  describe("createRetryConfig", () => {
    it("deve criar configuração com overrides", () => {
      const config = createRetryConfig({
        maxRetries: 5,
        initialDelayMs: 500,
      });
      expect(config.maxRetries).toBe(5);
      expect(config.initialDelayMs).toBe(500);
      expect(config.maxDelayMs).toBe(30000);
    });

    it("deve usar valores padrão se nenhum override for fornecido", () => {
      const config = createRetryConfig();
      expect(config.maxRetries).toBe(3);
      expect(config.initialDelayMs).toBe(1000);
    });
  });

  describe("executeWithRetry", () => {
    it("deve retornar sucesso na primeira tentativa", async () => {
      const fn = vi.fn().mockResolvedValue("sucesso");

      const result = await executeWithRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe("sucesso");
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("deve retornar sucesso após falhas iniciais", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Erro 1"))
        .mockRejectedValueOnce(new Error("Erro 2"))
        .mockResolvedValueOnce("sucesso");

      const result = await executeWithRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe("sucesso");
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("deve falhar após exceder maxRetries", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("Erro persistente"));

      const result = await executeWithRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Erro persistente");
      expect(result.attempts).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("deve respeitar timeout", async () => {
      const fn = vi.fn(() => new Promise(() => {}));

      const result = await executeWithRetry(fn, {
        maxRetries: 1,
        initialDelayMs: 10,
        timeoutMs: 50,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Timeout");
      expect(result.attempts).toBe(1);
    });

    it("deve retornar totalTimeMs correto", async () => {
      const fn = vi.fn().mockResolvedValue("sucesso");

      const result = await executeWithRetry(fn, {
        maxRetries: 1,
        initialDelayMs: 10,
      });

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.totalTimeMs).toBe("number");
    });

    it("deve preservar tipo de erro", async () => {
      const customError = new Error("Erro customizado");
      const fn = vi.fn().mockRejectedValue(customError);

      const result = await executeWithRetry(fn, {
        maxRetries: 1,
        initialDelayMs: 10,
      });

      expect(result.error).toBe("Erro customizado");
    });
  });
});
