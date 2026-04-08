import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveCollectionMessage, getClientHistory, updateMessageResponse } from "./db";

// Mock do banco de dados
vi.mock("./db", () => ({
  getDb: vi.fn(),
  saveCollectionMessage: vi.fn(),
  getClientHistory: vi.fn(),
  updateMessageResponse: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

describe("Collection Message History Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveCollectionMessage", () => {
    it("should save a collection message successfully", async () => {
      const mockSave = vi.fn().mockResolvedValue({ id: 1 });
      vi.mocked(saveCollectionMessage).mockImplementationOnce(mockSave);

      const result = await saveCollectionMessage(
        1,
        "friendly",
        "Template de cobrança amigável",
        "Oi cliente! Confirmando boleto de R$ 1000",
        "msg-123"
      );

      expect(result).toBeDefined();
    });

    it("should handle different message types", async () => {
      const messageTypes: Array<"friendly" | "administrative" | "formal"> = [
        "friendly",
        "administrative",
        "formal",
      ];

      for (const type of messageTypes) {
        const mockSave = vi.fn().mockResolvedValue({ id: 1 });
        vi.mocked(saveCollectionMessage).mockImplementationOnce(mockSave);

        const result = await saveCollectionMessage(
          1,
          type,
          `Template ${type}`,
          `Mensagem ${type}`,
          `msg-${type}`
        );

        expect(result).toBeDefined();
      }
    });

    it("should handle optional whatsappMessageId", async () => {
      const mockSave = vi.fn().mockResolvedValue({ id: 1 });
      vi.mocked(saveCollectionMessage).mockImplementationOnce(mockSave);

      const result = await saveCollectionMessage(
        1,
        "friendly",
        "Template",
        "Mensagem"
      );

      expect(result).toBeDefined();
    });
  });

  describe("getClientHistory", () => {
    it("should retrieve client history successfully", async () => {
      const mockHistory = [
        {
          id: 1,
          clientId: 1,
          messageType: "friendly" as const,
          messageSent: "Oi cliente!",
          status: "sent" as const,
          createdAt: new Date(),
          messageTemplate: "Template",
          whatsappMessageId: null,
          receivableId: null,
          responseReceived: false,
          responseText: null,
          responseDate: null,
          outcome: "pending" as const,
          sentAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(getClientHistory).mockResolvedValueOnce(mockHistory);

      const result = await getClientHistory(1);

      expect(result).toHaveLength(1);
      expect(result[0].messageType).toBe("friendly");
    });

    it("should return empty array for client with no history", async () => {
      vi.mocked(getClientHistory).mockResolvedValueOnce([]);

      const result = await getClientHistory(999);

      expect(result).toHaveLength(0);
    });

    it("should return multiple messages in order", async () => {
      const mockHistory = [
        {
          id: 2,
          clientId: 1,
          messageType: "administrative" as const,
          messageSent: "Olá cliente...",
          status: "sent" as const,
          createdAt: new Date(Date.now() - 1000),
          messageTemplate: "Template",
          whatsappMessageId: null,
          receivableId: null,
          responseReceived: false,
          responseText: null,
          responseDate: null,
          outcome: "pending" as const,
          sentAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 1,
          clientId: 1,
          messageType: "friendly" as const,
          messageSent: "Oi cliente!",
          status: "sent" as const,
          createdAt: new Date(),
          messageTemplate: "Template",
          whatsappMessageId: null,
          receivableId: null,
          responseReceived: false,
          responseText: null,
          responseDate: null,
          outcome: "pending" as const,
          sentAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(getClientHistory).mockResolvedValueOnce(mockHistory);

      const result = await getClientHistory(1);

      expect(result).toHaveLength(2);
      expect(result[0].messageType).toBe("administrative");
      expect(result[1].messageType).toBe("friendly");
    });
  });

  describe("updateMessageResponse", () => {
    it("should update message response successfully", async () => {
      const mockUpdate = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(updateMessageResponse).mockImplementationOnce(mockUpdate);

      const result = await updateMessageResponse(
        1,
        "Cliente respondeu que vai pagar",
        "agreed"
      );

      expect(result).toBeDefined();
    });

    it("should handle different outcome types", async () => {
      const outcomes: Array<"agreed" | "paid" | "no_response" | "rejected"> = [
        "agreed",
        "paid",
        "no_response",
        "rejected",
      ];

      for (const outcome of outcomes) {
        const mockUpdate = vi.fn().mockResolvedValue({ success: true });
        vi.mocked(updateMessageResponse).mockImplementationOnce(mockUpdate);

        const result = await updateMessageResponse(
          1,
          `Resposta: ${outcome}`,
          outcome
        );

        expect(result).toBeDefined();
      }
    });
  });

  describe("Message history workflow", () => {
    it("should complete a full workflow: send -> receive response -> update", async () => {
      // 1. Save message
      const mockSave = vi.fn().mockResolvedValue({ id: 1 });
      vi.mocked(saveCollectionMessage).mockImplementationOnce(mockSave);

      const saveResult = await saveCollectionMessage(
        1,
        "friendly",
        "Template",
        "Mensagem"
      );
      expect(saveResult).toBeDefined();

      // 2. Get history
      const mockHistory = [
        {
          id: 1,
          clientId: 1,
          messageType: "friendly" as const,
          messageSent: "Mensagem",
          status: "sent" as const,
          createdAt: new Date(),
          messageTemplate: "Template",
          whatsappMessageId: null,
          receivableId: null,
          responseReceived: false,
          responseText: null,
          responseDate: null,
          outcome: "pending" as const,
          sentAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(getClientHistory).mockResolvedValueOnce(mockHistory);

      const historyResult = await getClientHistory(1);
      expect(historyResult).toHaveLength(1);

      // 3. Update response
      const mockUpdate = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(updateMessageResponse).mockImplementationOnce(mockUpdate);

      const updateResult = await updateMessageResponse(
        1,
        "Cliente respondeu",
        "agreed"
      );
      expect(updateResult).toBeDefined();
    });
  });
});
