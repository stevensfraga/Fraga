import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getCollectionTemplate,
  getStageByDaysOverdue,
  formatTemplate,
  collectionRuleTemplates,
} from "./collectionRuleTemplates";

describe("Collection Rule Templates", () => {
  describe("getCollectionTemplate", () => {
    it("should return template for d_minus_5 stage", () => {
      const template = getCollectionTemplate("d_minus_5");
      expect(template).toBeDefined();
      expect(template?.stage).toBe("d_minus_5");
      expect(template?.name).toBe("D-5: Lembrete Preventivo");
      expect(template?.channels).toContain("whatsapp");
    });

    it("should return template for d_plus_60 stage", () => {
      const template = getCollectionTemplate("d_plus_60");
      expect(template).toBeDefined();
      expect(template?.stage).toBe("d_plus_60");
      expect(template?.name).toBe("D+60: Suspensão Administrativa");
      expect(template?.channels).toContain("email");
    });

    it("should return undefined for invalid stage", () => {
      const template = getCollectionTemplate("invalid_stage");
      expect(template).toBeUndefined();
    });

    it("should have all 9 stages defined", () => {
      expect(collectionRuleTemplates.length).toBe(9);
    });
  });

  describe("getStageByDaysOverdue", () => {
    it("should return d_minus_5 for -5 days", () => {
      const stage = getStageByDaysOverdue(-5);
      expect(stage).toBe("d_minus_5");
    });

    it("should return d_minus_1 for 0 days", () => {
      const stage = getStageByDaysOverdue(0);
      expect(stage).toBe("d_minus_1");
    });

    it("should return d_plus_3 for 3 days overdue", () => {
      const stage = getStageByDaysOverdue(3);
      expect(stage).toBe("d_plus_3");
    });

    it("should return d_plus_7 for 7 days overdue", () => {
      const stage = getStageByDaysOverdue(7);
      expect(stage).toBe("d_plus_7");
    });

    it("should return d_plus_15 for 15 days overdue", () => {
      const stage = getStageByDaysOverdue(15);
      expect(stage).toBe("d_plus_15");
    });

    it("should return d_plus_30 for 30 days overdue", () => {
      const stage = getStageByDaysOverdue(30);
      expect(stage).toBe("d_plus_30");
    });

    it("should return d_plus_45 for 45 days overdue", () => {
      const stage = getStageByDaysOverdue(45);
      expect(stage).toBe("d_plus_45");
    });

    it("should return d_plus_60 for 100 days overdue", () => {
      const stage = getStageByDaysOverdue(100);
      expect(stage).toBe("d_plus_60");
    });

    it("should return null for very future dates", () => {
      const stage = getStageByDaysOverdue(-10);
      expect(stage).toBeNull();
    });
  });

  describe("formatTemplate", () => {
    it("should replace all placeholders correctly", () => {
      const template = "Olá, {clientName}! Seu boleto vence em {dueDate}. Link: {paymentLink}";
      const variables = {
        clientName: "João Silva",
        dueDate: "15/02/2026",
        paymentLink: "https://boleto.com/123",
        companyName: "Fraga Contabilidade",
      };

      const result = formatTemplate(template, variables);

      expect(result).toContain("João Silva");
      expect(result).toContain("15/02/2026");
      expect(result).toContain("https://boleto.com/123");
    });

    it("should handle missing variables gracefully", () => {
      const template = "Cliente: {clientName}, Empresa: {companyName}";
      const variables = {
        clientName: "Maria",
        dueDate: "20/02/2026",
        paymentLink: "https://boleto.com/456",
        companyName: "Fraga Contabilidade",
      };

      const result = formatTemplate(template, variables);

      expect(result).toContain("Maria");
      expect(result).toContain("Fraga Contabilidade");
    });

    it("should replace multiple occurrences of same placeholder", () => {
      const template = "Olá {clientName}, {clientName} precisa pagar. {clientName}!";
      const variables = {
        clientName: "Pedro",
        dueDate: "25/02/2026",
        paymentLink: "https://boleto.com/789",
        companyName: "Fraga Contabilidade",
      };

      const result = formatTemplate(template, variables);

      const count = (result.match(/Pedro/g) || []).length;
      expect(count).toBe(3);
    });

    it("should format d_minus_5 template correctly", () => {
      const template = getCollectionTemplate("d_minus_5");
      expect(template).toBeDefined();

      const formatted = formatTemplate(template!.whatsappTemplate, {
        clientName: "Ana Costa",
        dueDate: "10/03/2026",
        paymentLink: "https://boleto.com/ana",
        companyName: "Fraga Contabilidade",
      });

      expect(formatted).toContain("Ana Costa");
      expect(formatted).toContain("10/03/2026");
      expect(formatted).toContain("https://boleto.com/ana");
    });

    it("should format d_plus_60 template correctly", () => {
      const template = getCollectionTemplate("d_plus_60");
      expect(template).toBeDefined();

      const formatted = formatTemplate(template!.emailTemplate, {
        clientName: "Carlos Mendes",
        dueDate: "01/01/2026",
        paymentLink: "https://boleto.com/carlos",
        companyName: "Fraga Contabilidade",
      });

      expect(formatted).toContain("Carlos Mendes");
      expect(formatted).toContain("suspenso");
    });
  });

  describe("Template Validation", () => {
    it("should have all stages with valid configuration", () => {
      collectionRuleTemplates.forEach((template) => {
        expect(template.stage).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.daysFromDueDate).toBeDefined();
        expect(template.channels).toBeDefined();
        expect(Array.isArray(template.channels)).toBe(true);
        expect(template.channels.length > 0).toBe(true);
      });
    });

    it("should have whatsapp template when whatsapp is in channels", () => {
      collectionRuleTemplates.forEach((template) => {
        if (template.channels.includes("whatsapp")) {
          expect(template.whatsappTemplate).toBeDefined();
          expect(template.whatsappTemplate.length > 0).toBe(true);
        }
      });
    });

    it("should have email template when email is in channels", () => {
      collectionRuleTemplates.forEach((template) => {
        if (template.channels.includes("email")) {
          expect(template.emailTemplate).toBeDefined();
          expect(template.emailTemplate.length > 0).toBe(true);
        }
      });
    });

    it("should have required placeholders in templates", () => {
      collectionRuleTemplates.forEach((template) => {
        if (template.whatsappTemplate) {
          expect(
            template.whatsappTemplate.includes("{clientName}") ||
              template.whatsappTemplate.includes("{companyName}")
          ).toBe(true);
        }

        if (template.emailTemplate) {
          expect(
            template.emailTemplate.includes("{clientName}") ||
              template.emailTemplate.includes("{companyName}")
          ).toBe(true);
        }
      });
    });
  });

  describe("Stage Progression", () => {
    it("should progress through all stages correctly", () => {
      const stages = [
        { days: -5, expected: "d_minus_5" },
        { days: -1, expected: "d_minus_1" },
        { days: 3, expected: "d_plus_3" },
        { days: 7, expected: "d_plus_7" },
        { days: 15, expected: "d_plus_15" },
        { days: 30, expected: "d_plus_30" },
        { days: 45, expected: "d_plus_45" },
        { days: 65, expected: "d_plus_60" },
      ];

      stages.forEach(({ days, expected }) => {
        const stage = getStageByDaysOverdue(days);
        expect(stage).toBe(expected);
      });
    });

    it("should have correct day offsets for each stage", () => {
      const expectedOffsets = [-5, -1, 3, 7, 15, 30, 45, 60];
      const actualOffsets = collectionRuleTemplates
        .filter((t) => t.stage !== "reset")
        .map((t) => t.daysFromDueDate);

      expectedOffsets.forEach((offset) => {
        expect(actualOffsets).toContain(offset);
      });
    });
  });
});
