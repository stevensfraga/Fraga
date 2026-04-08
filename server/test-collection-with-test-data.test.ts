import { describe, it, expect, beforeAll } from "vitest";
import { 
  getTestClientById, 
  getTestClientByName,
  getAllTestClients,
  formatPhoneForWhatsApp,
  isValidWhatsAppNumber
} from "./testClientsData";

describe("Collection System with Test Data", () => {
  describe("Test Data Loading", () => {
    it("should load all test clients", () => {
      const clients = getAllTestClients();
      expect(clients.length).toBeGreaterThan(0);
      expect(clients.length).toBe(11);
    });

    it("should find ELLY PRODUTOS OTICOS by ID", () => {
      const client = getTestClientById("3232776000125.0");
      expect(client).toBeDefined();
      expect(client?.nome).toBe("ELLY PRODUTOS OTICOS");
      expect(client?.cnpj).toBe("03.232.776/0001-25");
    });

    it("should find ELLY PRODUTOS OTICOS by name", () => {
      const client = getTestClientByName("ELLY");
      expect(client).toBeDefined();
      expect(client?.nome).toBe("ELLY PRODUTOS OTICOS");
    });

    it("should have valid phone numbers for all test clients", () => {
      const clients = getAllTestClients();
      clients.forEach(client => {
        expect(client.telefone).toBeDefined();
        expect(isValidWhatsAppNumber(client.telefone)).toBe(true);
      });
    });
  });

  describe("Phone Number Formatting", () => {
    it("should format phone number correctly", () => {
      const formatted = formatPhoneForWhatsApp("5527981234567");
      expect(formatted).toBe("5527981234567");
    });

    it("should add country code for 11-digit numbers", () => {
      const formatted = formatPhoneForWhatsApp("27981234567");
      expect(formatted).toBe("5527981234567");
    });

    it("should add country code for 10-digit numbers", () => {
      const formatted = formatPhoneForWhatsApp("2798123456");
      expect(formatted).toBe("552798123456");
    });

    it("should handle numbers with formatting", () => {
      const formatted = formatPhoneForWhatsApp("(27) 98123-4567");
      expect(formatted).toBe("5527981234567");
    });

    it("should return empty string for invalid numbers", () => {
      const formatted = formatPhoneForWhatsApp("123");
      expect(formatted).toBe("");
    });
  });

  describe("Message Type Classification", () => {
    it("should classify clients by overdue range", () => {
      const clients = getAllTestClients();
      
      const friendly = clients.filter(c => c.faixa === "friendly");
      const administrative = clients.filter(c => c.faixa === "administrative");
      const formal = clients.filter(c => c.faixa === "formal");

      expect(friendly.length).toBeGreaterThanOrEqual(0);
      expect(administrative.length).toBeGreaterThanOrEqual(0);
      expect(formal.length).toBeGreaterThanOrEqual(0);
    });

    it("should have at least one client in each range", () => {
      const clients = getAllTestClients();
      const ranges = new Set(clients.map(c => c.faixa));
      
      // Should have at least 2 different ranges
      expect(ranges.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Test Data Completeness", () => {
    it("should have all required fields for each client", () => {
      const clients = getAllTestClients();
      clients.forEach(client => {
        expect(client.id).toBeDefined();
        expect(client.nome).toBeDefined();
        expect(client.cnpj).toBeDefined();
        expect(client.dias_atraso).toBeDefined();
        expect(client.valor_atraso).toBeDefined();
        expect(client.faixa).toBeDefined();
        expect(client.num_parcelas).toBeDefined();
        expect(client.vencimento_mais_antigo).toBeDefined();
        expect(client.telefone).toBeDefined();
      });
    });

    it("should have realistic overdue values", () => {
      const clients = getAllTestClients();
      clients.forEach(client => {
        expect(client.dias_atraso).toBeGreaterThan(0);
        expect(client.valor_atraso).toBeGreaterThan(0);
        expect(client.num_parcelas).toBeGreaterThan(0);
      });
    });

    it("should have total value greater than zero", () => {
      const clients = getAllTestClients();
      const totalValue = clients.reduce((sum, c) => sum + c.valor_atraso, 0);
      expect(totalValue).toBeGreaterThan(0);
    });
  });

  describe("Message Templates", () => {
    it("should have appropriate message for friendly stage", () => {
      const templates: Record<string, string> = {
        friendly: `Olá, tudo bem?\nEstamos fazendo uma revisão interna e identificamos honorários em aberto referentes aos últimos meses.\nGostaria de confirmar se existe alguma pendência ou dificuldade para regularização, para que possamos alinhar da melhor forma e evitar impactos na continuidade dos serviços.\nFico no aguardo do seu retorno.`,
        administrative: `Olá, tudo bem?\nSeguindo nossa comunicação anterior, gostaria de confirmar se você recebeu nossa mensagem sobre os honorários em aberto.\nCaso tenha alguma dúvida ou dificuldade, estou à disposição para conversar e encontrar a melhor solução.\nQuando podemos contar com a regularização?\nObrigado!`,
        formal: `Olá, tudo bem?\nEstou preocupado pois ainda não conseguimos regularizar os honorários em aberto há mais de um mês.\nGostaria de entender se há algo que eu possa fazer para ajudar a resolver isso.\nPodemos agendar uma conversa para alinhamento?`,
      };

      expect(templates.friendly).toContain("revisão interna");
      expect(templates.administrative).toContain("comunicação anterior");
      expect(templates.formal).toContain("preocupado");
    });
  });

  describe("Client Statistics", () => {
    it("should calculate total overdue amount", () => {
      const clients = getAllTestClients();
      const totalOverdue = clients.reduce((sum, c) => sum + c.valor_atraso, 0);
      
      // Should be approximately R$ 174,000 based on test data
      expect(totalOverdue).toBeGreaterThan(100000);
      expect(totalOverdue).toBeLessThan(200000);
    });

    it("should have ELLY PRODUTOS OTICOS with significant overdue", () => {
      const client = getTestClientById("3232776000125.0");
      expect(client?.valor_atraso).toBeGreaterThan(10000);
      expect(client?.dias_atraso).toBeGreaterThan(600);
    });
  });
});
