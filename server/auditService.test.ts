/**
 * Testes Unitários para Serviço de Auditoria
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { runFullAudit, formatAuditForConsole } from "./auditService";

describe("auditService", () => {
  describe("runFullAudit", () => {
    it("deve retornar resultado com estrutura válida", async () => {
      const result = await runFullAudit();

      // Validar estrutura básica
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("checks");
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("recommendations");
    });

    it("deve ter timestamp válido", async () => {
      const result = await runFullAudit();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).toBeGreaterThan(0);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("deve ter status válido", async () => {
      const result = await runFullAudit();

      expect(["healthy", "warning", "critical"]).toContain(result.status);
    });

    it("deve validar todos os 8 componentes", async () => {
      const result = await runFullAudit();

      const expectedComponents = [
        "oauth",
        "boletos",
        "whatsapp",
        "dashboard",
        "scheduler",
        "webhook",
        "encryption",
        "database",
      ];

      expectedComponents.forEach((component) => {
        expect(result.checks).toHaveProperty(component);
      });

      expect(Object.keys(result.checks).length).toBe(8);
    });

    it("cada check deve ter estrutura válida", async () => {
      const result = await runFullAudit();

      Object.entries(result.checks).forEach(([key, check]) => {
        expect(check).toHaveProperty("name");
        expect(check).toHaveProperty("status");
        expect(check).toHaveProperty("message");

        expect(typeof check.name).toBe("string");
        expect(["pass", "warning", "fail"]).toContain(check.status);
        expect(typeof check.message).toBe("string");
      });
    });

    it("resumo deve ser consistente com checks", async () => {
      const result = await runFullAudit();

      const checks = Object.values(result.checks);
      const passed = checks.filter((c) => c.status === "pass").length;
      const warnings = checks.filter((c) => c.status === "warning").length;
      const failed = checks.filter((c) => c.status === "fail").length;

      expect(result.summary.passed).toBe(passed);
      expect(result.summary.warnings).toBe(warnings);
      expect(result.summary.failed).toBe(failed);
      expect(result.summary.totalChecks).toBe(checks.length);
    });

    it("taxa de sucesso deve estar entre 0 e 100", async () => {
      const result = await runFullAudit();

      expect(result.summary.successRate).toBeGreaterThanOrEqual(0);
      expect(result.summary.successRate).toBeLessThanOrEqual(100);
    });

    it("recomendações devem ser array", async () => {
      const result = await runFullAudit();

      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it("status crítico deve ter recomendações", async () => {
      const result = await runFullAudit();

      if (result.status === "critical") {
        expect(result.recommendations.length).toBeGreaterThan(0);
      }
    });

    it("se todos os checks passarem, status deve ser healthy", async () => {
      const result = await runFullAudit();

      const allPass = Object.values(result.checks).every((c) => c.status === "pass");

      if (allPass) {
        expect(result.status).toBe("healthy");
      }
    });

    it("se houver falha, status não deve ser healthy", async () => {
      const result = await runFullAudit();

      const hasFail = Object.values(result.checks).some((c) => c.status === "fail");

      if (hasFail) {
        expect(result.status).not.toBe("healthy");
      }
    });
  });

  describe("formatAuditForConsole", () => {
    it("deve retornar string formatada", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      expect(typeof formatted).toBe("string");
      expect(formatted.length).toBeGreaterThan(0);
    });

    it("deve conter título da auditoria", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      expect(formatted).toContain("AUDITORIA COMPLETA");
    });

    it("deve conter status geral", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      expect(formatted).toContain("Status Geral");
      expect(formatted).toContain(result.status.toUpperCase());
    });

    it("deve conter resumo", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      expect(formatted).toContain("RESUMO");
      expect(formatted).toContain("Total de verificações");
      expect(formatted).toContain("Taxa de sucesso");
    });

    it("deve conter detalhes de cada check", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      Object.values(result.checks).forEach((check) => {
        expect(formatted).toContain(check.name);
        expect(formatted).toContain(check.message);
      });
    });

    it("deve conter recomendações se houver", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      if (result.recommendations.length > 0) {
        expect(formatted).toContain("RECOMENDAÇÕES");
        result.recommendations.forEach((rec) => {
          expect(formatted).toContain(rec);
        });
      }
    });

    it("deve conter timestamp", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      expect(formatted).toContain("Auditoria em:");
      expect(formatted).toContain(result.timestamp);
    });

    it("deve conter emojis de status", async () => {
      const result = await runFullAudit();
      const formatted = formatAuditForConsole(result);

      expect(formatted).toContain("✅");
      expect(formatted).toContain("🔍");
    });
  });

  describe("Validações de Componentes", () => {
    it("OAuth check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const oauth = result.checks.oauth;

      expect(oauth.name).toBe("OAuth Conta Azul");
      expect(["pass", "warning", "fail"]).toContain(oauth.status);
    });

    it("Boletos check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const boletos = result.checks.boletos;

      expect(boletos.name).toBe("Busca de Boletos");
      expect(["pass", "warning", "fail"]).toContain(boletos.status);
    });

    it("WhatsApp check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const whatsapp = result.checks.whatsapp;

      expect(whatsapp.name).toBe("Integração WhatsApp");
      expect(["pass", "warning", "fail"]).toContain(whatsapp.status);
    });

    it("Dashboard check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const dashboard = result.checks.dashboard;

      expect(dashboard.name).toBe("Dashboard/Auditoria");
      expect(["pass", "warning", "fail"]).toContain(dashboard.status);
    });

    it("Scheduler check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const scheduler = result.checks.scheduler;

      expect(scheduler.name).toBe("Scheduler de Cobrança");
      expect(["pass", "warning", "fail"]).toContain(scheduler.status);
    });

    it("Webhook check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const webhook = result.checks.webhook;

      expect(webhook.name).toBe("Webhook de Pagamento");
      expect(["pass", "warning", "fail"]).toContain(webhook.status);
    });

    it("Encryption check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const encryption = result.checks.encryption;

      expect(encryption.name).toBe("Criptografia AES-256");
      expect(["pass", "warning", "fail"]).toContain(encryption.status);
    });

    it("Database check deve ter estrutura correta", async () => {
      const result = await runFullAudit();
      const database = result.checks.database;

      expect(database.name).toBe("Conexão com Banco de Dados");
      expect(["pass", "warning", "fail"]).toContain(database.status);
    });
  });

  describe("Recomendações", () => {
    it("deve gerar recomendações apropriadas", async () => {
      const result = await runFullAudit();

      // Se há falha de OAuth, deve recomendar reautorização
      if (result.checks.oauth.status === "fail") {
        expect(result.recommendations.some((r) => r.includes("OAuth"))).toBe(true);
      }

      // Se há falha de banco, deve recomendar verificação
      if (result.checks.database.status === "fail") {
        expect(result.recommendations.some((r) => r.includes("banco"))).toBe(true);
      }
    });

    it("se sistema está saudável, deve ter recomendação positiva", async () => {
      const result = await runFullAudit();

      if (result.status === "healthy") {
        expect(result.recommendations.some((r) => r.includes("pronto"))).toBe(true);
      }
    });
  });

  describe("Consistência de Dados", () => {
    it("múltiplas execuções devem ter estrutura consistente", async () => {
      const result1 = await runFullAudit();
      const result2 = await runFullAudit();

      // Estrutura deve ser idêntica
      expect(Object.keys(result1.checks)).toEqual(Object.keys(result2.checks));
      expect(result1.summary.totalChecks).toBe(result2.summary.totalChecks);
    });

    it("timestamp deve ser diferente entre execuções", async () => {
      const result1 = await runFullAudit();

      // Aguardar um pouco
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result2 = await runFullAudit();

      // Timestamps devem ser diferentes (ou pelo menos não iguais)
      expect(result1.timestamp).not.toBe(result2.timestamp);
    });
  });
});
