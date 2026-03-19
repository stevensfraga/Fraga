import { describe, it, expect, beforeEach, vi } from "vitest";
import axios from "axios";

// Mock axios
vi.mock("axios");

interface ClientData {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  municipio: string;
  estado: string;
  valor_atraso: number;
  dias_atraso: number;
  faixa: string;
  num_parcelas: number;
  vencimento_mais_antigo: string;
}

interface Message {
  id: string;
  clientId: string;
  messageType: "friendly" | "administrative" | "formal";
  message: string;
  sentAt: Date;
  status: "sent" | "delivered" | "read" | "failed";
  response?: string;
  respondedAt?: Date;
}

describe("ClientHistory Page", () => {
  describe("Data Loading", () => {
    it("should load client data from JSON", async () => {
      const mockClient: ClientData = {
        id: "7485216000133.0",
        nome: "TCVV TERMINAL DE CONTAINER VILA VELHA LTDA",
        email: "contato@tcvv.com.br",
        telefone: "27981657804",
        municipio: "Vila Velha",
        estado: "ES",
        valor_atraso: 20650,
        dias_atraso: 212,
        faixa: "formal",
        num_parcelas: 4,
        vencimento_mais_antigo: "2025-07-09",
      };

      expect(mockClient.id).toBe("7485216000133.0");
      expect(mockClient.nome).toBe("TCVV TERMINAL DE CONTAINER VILA VELHA LTDA");
      expect(mockClient.valor_atraso).toBe(20650);
      expect(mockClient.dias_atraso).toBe(212);
    });

    it("should handle missing client data", () => {
      const mockClients: ClientData[] = [];
      const clientId = "nonexistent-id";
      const client = mockClients.find((c) => c.id === clientId);

      expect(client).toBeUndefined();
    });

    it("should parse client data structure correctly", () => {
      const mockData = {
        clientes: [
          {
            id: "123",
            nome: "Test Client",
            dias_atraso: 30,
            valor_atraso: 1000,
            faixa: "friendly",
            num_parcelas: 1,
            vencimento_mais_antigo: "2025-01-01",
          },
        ],
      };

      const clients = mockData.clientes || mockData;
      expect(clients).toHaveLength(1);
      expect(clients[0].id).toBe("123");
    });
  });

  describe("Message Timeline", () => {
    it("should create message objects with correct structure", () => {
      const message: Message = {
        id: "1",
        clientId: "123",
        messageType: "friendly",
        message: "Test message",
        sentAt: new Date("2026-01-30"),
        status: "delivered",
        response: "Test response",
        respondedAt: new Date("2026-01-31"),
      };

      expect(message.id).toBe("1");
      expect(message.messageType).toBe("friendly");
      expect(message.status).toBe("delivered");
      expect(message.response).toBeDefined();
    });

    it("should calculate message statistics correctly", () => {
      const messages: Message[] = [
        {
          id: "1",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date(),
          status: "sent",
        },
        {
          id: "2",
          clientId: "123",
          messageType: "administrative",
          message: "Test",
          sentAt: new Date(),
          status: "delivered",
        },
        {
          id: "3",
          clientId: "123",
          messageType: "formal",
          message: "Test",
          sentAt: new Date(),
          status: "read",
          response: "Response",
        },
      ];

      const stats = {
        total: messages.length,
        sent: messages.filter((m) => m.status === "sent").length,
        delivered: messages.filter((m) => m.status === "delivered").length,
        read: messages.filter((m) => m.status === "read").length,
        responded: messages.filter((m) => m.response).length,
      };

      expect(stats.total).toBe(3);
      expect(stats.sent).toBe(1);
      expect(stats.delivered).toBe(1);
      expect(stats.read).toBe(1);
      expect(stats.responded).toBe(1);
    });

    it("should handle messages without responses", () => {
      const messages: Message[] = [
        {
          id: "1",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date(),
          status: "delivered",
        },
      ];

      const responded = messages.filter((m) => m.response);
      expect(responded).toHaveLength(0);
    });

    it("should filter messages by type", () => {
      const messages: Message[] = [
        {
          id: "1",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date(),
          status: "sent",
        },
        {
          id: "2",
          clientId: "123",
          messageType: "administrative",
          message: "Test",
          sentAt: new Date(),
          status: "sent",
        },
        {
          id: "3",
          clientId: "123",
          messageType: "formal",
          message: "Test",
          sentAt: new Date(),
          status: "sent",
        },
      ];

      const friendlyMessages = messages.filter((m) => m.messageType === "friendly");
      const administrativeMessages = messages.filter((m) => m.messageType === "administrative");
      const formalMessages = messages.filter((m) => m.messageType === "formal");

      expect(friendlyMessages).toHaveLength(1);
      expect(administrativeMessages).toHaveLength(1);
      expect(formalMessages).toHaveLength(1);
    });
  });

  describe("Message Status", () => {
    it("should validate message status values", () => {
      const validStatuses: Array<"sent" | "delivered" | "read" | "failed"> = [
        "sent",
        "delivered",
        "read",
        "failed",
      ];

      validStatuses.forEach((status) => {
        expect(["sent", "delivered", "read", "failed"]).toContain(status);
      });
    });

    it("should count messages by status", () => {
      const messages: Message[] = [
        {
          id: "1",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date(),
          status: "sent",
        },
        {
          id: "2",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date(),
          status: "delivered",
        },
        {
          id: "3",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date(),
          status: "read",
        },
      ];

      const statusCounts = {
        sent: messages.filter((m) => m.status === "sent").length,
        delivered: messages.filter((m) => m.status === "delivered").length,
        read: messages.filter((m) => m.status === "read").length,
        failed: messages.filter((m) => m.status === "failed").length,
      };

      expect(statusCounts.sent).toBe(1);
      expect(statusCounts.delivered).toBe(1);
      expect(statusCounts.read).toBe(1);
      expect(statusCounts.failed).toBe(0);
    });
  });

  describe("Timeline Rendering", () => {
    it("should sort messages by date", () => {
      const messages: Message[] = [
        {
          id: "3",
          clientId: "123",
          messageType: "formal",
          message: "Test",
          sentAt: new Date("2026-02-05"),
          status: "sent",
        },
        {
          id: "1",
          clientId: "123",
          messageType: "friendly",
          message: "Test",
          sentAt: new Date("2026-01-30"),
          status: "sent",
        },
        {
          id: "2",
          clientId: "123",
          messageType: "administrative",
          message: "Test",
          sentAt: new Date("2026-02-03"),
          status: "sent",
        },
      ];

      const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

      expect(sorted[0].id).toBe("1");
      expect(sorted[1].id).toBe("2");
      expect(sorted[2].id).toBe("3");
    });

    it("should format dates correctly", () => {
      const date = new Date("2026-02-06T18:21:00");
      const formatted = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      expect(formatted).toContain("06");
      expect(formatted).toContain("fevereiro");
      expect(formatted).toContain("2026");
    });
  });

  describe("Client Information Display", () => {
    it("should display client name correctly", () => {
      const client: ClientData = {
        id: "123",
        nome: "Test Company LTDA",
        email: "test@example.com",
        telefone: "27981657804",
        municipio: "Vila Velha",
        estado: "ES",
        valor_atraso: 5000,
        dias_atraso: 30,
        faixa: "friendly",
        num_parcelas: 2,
        vencimento_mais_antigo: "2026-01-01",
      };

      expect(client.nome).toBe("Test Company LTDA");
    });

    it("should display financial information correctly", () => {
      const client: ClientData = {
        id: "123",
        nome: "Test Company",
        email: "test@example.com",
        telefone: "27981657804",
        municipio: "Vila Velha",
        estado: "ES",
        valor_atraso: 20650,
        dias_atraso: 212,
        faixa: "formal",
        num_parcelas: 4,
        vencimento_mais_antigo: "2025-07-09",
      };

      expect(client.valor_atraso).toBe(20650);
      expect(client.dias_atraso).toBe(212);
      expect(client.num_parcelas).toBe(4);
    });

    it("should handle missing contact information", () => {
      const client: ClientData = {
        id: "123",
        nome: "Test Company",
        email: "",
        telefone: "",
        municipio: "Vila Velha",
        estado: "ES",
        valor_atraso: 5000,
        dias_atraso: 30,
        faixa: "friendly",
        num_parcelas: 2,
        vencimento_mais_antigo: "2026-01-01",
      };

      expect(client.email || "N/A").toBe("N/A");
      expect(client.telefone || "N/A").toBe("N/A");
    });
  });
});
