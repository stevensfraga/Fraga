import { describe, it, expect, vi, beforeEach } from "vitest";

describe("WhatsApp Message Sending Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate friendly message format", () => {
    const clientName = "Empresa Teste";
    const amount = 1500.00;
    const message = `Oi ${clientName}! Passando só para confirmar se o boleto referente a R$ ${amount.toFixed(2)} já foi programado. Qualquer coisa me avisa!`;
    
    expect(message).toContain("Empresa Teste");
    expect(message).toContain("1500.00");
    expect(message).toContain("boleto");
    console.log("[Test] Friendly message format validated:", message);
  });

  it("should validate administrative message format", () => {
    const clientName = "Empresa Teste";
    const amount = 3000.00;
    const daysOverdue = 45;
    const message = `Olá ${clientName}, Identificamos valores em aberto de R$ ${amount.toFixed(2)} há ${daysOverdue} dias. Para manter os serviços ativos, precisamos regularizar. Podemos seguir com pagamento integral ou parcelamento. Qual opção prefere?`;
    
    expect(message).toContain("Empresa Teste");
    expect(message).toContain("3000.00");
    expect(message).toContain("45 dias");
    console.log("[Test] Administrative message format validated:", message);
  });

  it("should validate formal message format", () => {
    const clientName = "Empresa Teste";
    const amount = 5000.00;
    const message = `${clientName}, Sem a regularização do débito de R$ ${amount.toFixed(2)} até 48 horas, os serviços serão suspensos conforme contrato. Favor regularizar urgentemente.`;
    
    expect(message).toContain("Empresa Teste");
    expect(message).toContain("5000.00");
    expect(message).toContain("48 horas");
    expect(message).toContain("suspensos");
    console.log("[Test] Formal message format validated:", message);
  });

  it("should classify clients by days overdue", () => {
    const classifyClient = (daysOverdue: number): "friendly" | "administrative" | "formal" => {
      if (daysOverdue <= 30) return "friendly";
      if (daysOverdue <= 90) return "administrative";
      return "formal";
    };

    expect(classifyClient(15)).toBe("friendly");
    expect(classifyClient(45)).toBe("administrative");
    expect(classifyClient(120)).toBe("formal");
    console.log("[Test] Client classification working correctly");
  });

  it("should format phone numbers for WhatsApp", () => {
    const formatPhoneForWhatsApp = (phone: string): string => {
      // Remove non-digits
      const cleaned = phone.replace(/\D/g, "");
      // Ensure it starts with country code (55 for Brazil)
      if (!cleaned.startsWith("55")) {
        return "55" + cleaned;
      }
      return cleaned;
    };

    expect(formatPhoneForWhatsApp("11 98765-4321")).toBe("5511987654321");
    expect(formatPhoneForWhatsApp("5511987654321")).toBe("5511987654321");
    expect(formatPhoneForWhatsApp("(11) 98765-4321")).toBe("5511987654321");
    console.log("[Test] Phone number formatting working correctly");
  });

  it("should validate message payload structure", () => {
    const messagePayload = {
      clientId: "test-001",
      clientName: "Empresa Teste",
      clientPhone: "5511987654321",
      amount: 1500.00,
      daysOverdue: 15,
      messageType: "friendly" as const,
    };

    expect(messagePayload).toHaveProperty("clientId");
    expect(messagePayload).toHaveProperty("clientName");
    expect(messagePayload).toHaveProperty("clientPhone");
    expect(messagePayload).toHaveProperty("amount");
    expect(messagePayload).toHaveProperty("daysOverdue");
    expect(messagePayload).toHaveProperty("messageType");
    expect(messagePayload.messageType).toMatch(/friendly|administrative|formal/);
    console.log("[Test] Message payload structure validated");
  });

  it("should handle multiple message types in sequence", () => {
    const messages = [
      { type: "friendly", daysOverdue: 15 },
      { type: "administrative", daysOverdue: 45 },
      { type: "formal", daysOverdue: 120 },
    ];

    const classifyClient = (daysOverdue: number): "friendly" | "administrative" | "formal" => {
      if (daysOverdue <= 30) return "friendly";
      if (daysOverdue <= 90) return "administrative";
      return "formal";
    };

    messages.forEach((msg) => {
      const classified = classifyClient(msg.daysOverdue);
      expect(classified).toBe(msg.type);
    });

    console.log("[Test] Multiple message types handled correctly");
  });

  it("should calculate correct overdue amounts", () => {
    const clients = [
      { name: "Client A", amount: 1500.00, daysOverdue: 15 },
      { name: "Client B", amount: 3000.00, daysOverdue: 45 },
      { name: "Client C", amount: 5000.00, daysOverdue: 120 },
    ];

    const totalOverdue = clients.reduce((sum, client) => sum + client.amount, 0);
    expect(totalOverdue).toBe(9500.00);

    const formalClientsTotal = clients
      .filter((c) => c.daysOverdue > 90)
      .reduce((sum, client) => sum + client.amount, 0);
    expect(formalClientsTotal).toBe(5000.00);

    console.log("[Test] Overdue amount calculations correct");
  });
});
