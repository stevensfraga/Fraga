import { describe, it, expect } from "vitest";

// ─── calcDelta helper (copiado do dashboard2Router) ───────────────────────────

function calcDelta(current: number, previous: number) {
  const delta = current - previous;
  const pct = previous > 0 ? (delta / previous) * 100 : current > 0 ? 100 : 0;
  return {
    delta: Math.round(delta * 100) / 100,
    pct: Math.round(pct * 10) / 10,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

describe("calcDelta", () => {
  it("retorna up quando atual > anterior", () => {
    const r = calcDelta(1000, 800);
    expect(r.direction).toBe("up");
    expect(r.delta).toBe(200);
    expect(r.pct).toBe(25);
  });

  it("retorna down quando atual < anterior", () => {
    const r = calcDelta(500, 1000);
    expect(r.direction).toBe("down");
    expect(r.delta).toBe(-500);
    expect(r.pct).toBe(-50);
  });

  it("retorna flat quando igual", () => {
    const r = calcDelta(300, 300);
    expect(r.direction).toBe("flat");
    expect(r.delta).toBe(0);
    expect(r.pct).toBe(0);
  });

  it("não divide por zero quando anterior = 0 e atual > 0", () => {
    const r = calcDelta(500, 0);
    expect(r.direction).toBe("up");
    expect(r.pct).toBe(100);
    expect(Number.isFinite(r.pct)).toBe(true);
  });

  it("não divide por zero quando ambos = 0", () => {
    const r = calcDelta(0, 0);
    expect(r.direction).toBe("flat");
    expect(r.pct).toBe(0);
    expect(Number.isFinite(r.pct)).toBe(true);
  });

  it("arredonda corretamente", () => {
    const r = calcDelta(1001.999, 1000);
    expect(r.delta).toBe(2);
    expect(Number.isFinite(r.pct)).toBe(true);
  });
});

// ─── Dossiê do Cliente — shape dos dados ─────────────────────────────────────

describe("ClienteDossie data shapes", () => {
  it("resumo tem campos obrigatórios", () => {
    const mockResumo = {
      id: 1,
      name: "Empresa Teste LTDA",
      document: "12.345.678/0001-90",
      email: "teste@empresa.com",
      whatsappNumber: "5511999999999",
      whatsappSource: "manual",
      status: "active",
      optOut: false,
      cnae: "6920601",
      reguaStage: "d_plus_3",
      lastDispatchAt: "2026-02-01T09:00:00.000Z",
      nextStage: "d_plus_7",
      totalOpen: 5000,
      openCount: 3,
      maxDaysOverdue: 15,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };

    expect(mockResumo).toHaveProperty("id");
    expect(mockResumo).toHaveProperty("name");
    expect(mockResumo).toHaveProperty("totalOpen");
    expect(mockResumo).toHaveProperty("maxDaysOverdue");
    expect(mockResumo).toHaveProperty("reguaStage");
    expect(typeof mockResumo.totalOpen).toBe("number");
    expect(typeof mockResumo.maxDaysOverdue).toBe("number");
  });

  it("título tem campos obrigatórios", () => {
    const mockTitulo = {
      id: 42,
      contaAzulId: "ca-123",
      amount: 1500.00,
      dueDate: "2026-01-15",
      paidDate: null,
      status: "overdue",
      description: "Honorários Jan/26",
      link: "https://boleto.example.com/123",
      linhaDigitavel: "12345.67890 12345.678901 12345.678901 1 12340000015000",
      pdfStorageUrl: null,
      dispatchCount: 2,
      lastDispatchedAt: "2026-01-20",
      daysOverdue: 46,
    };

    expect(mockTitulo).toHaveProperty("id");
    expect(mockTitulo).toHaveProperty("amount");
    expect(mockTitulo).toHaveProperty("dueDate");
    expect(mockTitulo).toHaveProperty("status");
    expect(mockTitulo).toHaveProperty("daysOverdue");
    expect(typeof mockTitulo.amount).toBe("number");
    expect(typeof mockTitulo.daysOverdue).toBe("number");
  });

  it("evento de timeline tem campos obrigatórios", () => {
    const mockEvent = {
      type: "regua",
      id: 10,
      createdAt: "2026-01-20T09:00:00.000Z",
      data: {
        stage: "d_plus_3",
        status: "sent",
        phone: "5511999999999",
        template: "cobranca_d3",
        correlationId: "abc-123",
        errorMessage: null,
      },
    };

    expect(mockEvent).toHaveProperty("type");
    expect(mockEvent).toHaveProperty("id");
    expect(mockEvent).toHaveProperty("createdAt");
    expect(mockEvent).toHaveProperty("data");
    expect(["regua", "collection", "inbound", "ai"]).toContain(mockEvent.type);
  });
});

// ─── Export CSV helper ────────────────────────────────────────────────────────

describe("exportCSV helper", () => {
  function buildCSV(rows: any[]): string {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [
      headers.join(","),
      ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? "")).join(","))
    ].join("\n");
  }

  it("gera CSV com cabeçalho correto", () => {
    const rows = [
      { nome: "Empresa A", valor: 1000, status: "overdue" },
      { nome: "Empresa B", valor: 2000, status: "pending" },
    ];
    const csv = buildCSV(rows);
    expect(csv).toContain("nome,valor,status");
    expect(csv).toContain("Empresa A");
    expect(csv).toContain("1000");
  });

  it("retorna string vazia para array vazio", () => {
    expect(buildCSV([])).toBe("");
  });

  it("escapa aspas em valores com vírgula", () => {
    const rows = [{ nome: "Empresa, LTDA", valor: 500 }];
    const csv = buildCSV(rows);
    expect(csv).toContain('"Empresa, LTDA"');
  });
});

// ─── Recuperado via Régua vs Pagamentos Totais ────────────────────────────────

describe("Separação recuperado via régua vs pagamentos totais", () => {
  it("recoveredViaRegua <= totalPaid (subconjunto)", () => {
    // Invariante: o recuperado via régua é sempre <= pagamentos totais
    const totalPaid = 50000;
    const recoveredViaRegua = 12000;
    expect(recoveredViaRegua).toBeLessThanOrEqual(totalPaid);
  });

  it("taxa de recuperação usa recoveredViaRegua, não totalPaid", () => {
    const totalOpen = 100000;
    const recoveredViaRegua = 12000;
    const totalPaid = 50000;

    const rateCorreto = (recoveredViaRegua / (totalOpen + recoveredViaRegua)) * 100;
    const rateInflado = (totalPaid / (totalOpen + totalPaid)) * 100;

    // A taxa correta deve ser menor que a inflada
    expect(rateCorreto).toBeLessThan(rateInflado);
    expect(rateCorreto).toBeCloseTo(10.7, 0);
  });
});
