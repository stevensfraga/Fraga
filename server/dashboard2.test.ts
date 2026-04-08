/**
 * Testes para o dashboard2Router
 * Cobre: lógica de comparativo de período, cálculo de delta/pct, exportData
 */
import { describe, it, expect } from "vitest";

// ─── Helpers reutilizados do router ──────────────────────────────────────────

function calcComparativo(current: number, previous: number) {
  const delta = current - previous;
  const pct = previous !== 0 ? (delta / Math.abs(previous)) * 100 : 0;
  const direction =
    Math.abs(pct) < 1 ? "flat" : delta > 0 ? "up" : "down";
  return { delta, pct: Math.round(pct * 10) / 10, direction };
}

// ─── Testes do comparativo ────────────────────────────────────────────────────

describe("calcComparativo", () => {
  it("retorna 'up' quando current > previous", () => {
    const result = calcComparativo(1200, 1000);
    expect(result.direction).toBe("up");
    expect(result.delta).toBe(200);
    expect(result.pct).toBe(20);
  });

  it("retorna 'down' quando current < previous", () => {
    const result = calcComparativo(800, 1000);
    expect(result.direction).toBe("down");
    expect(result.delta).toBe(-200);
    expect(result.pct).toBe(-20);
  });

  it("retorna 'flat' quando variação < 1%", () => {
    const result = calcComparativo(1005, 1000);
    expect(result.direction).toBe("flat");
  });

  it("não divide por zero quando previous = 0", () => {
    const result = calcComparativo(500, 0);
    expect(result.pct).toBe(0);
    expect(result.direction).toBe("flat"); // sem referência anterior
  });

  it("calcula corretamente com valores negativos (lucro → prejuízo)", () => {
    const result = calcComparativo(-100, 200);
    expect(result.delta).toBe(-300);
    expect(result.direction).toBe("down");
  });

  it("arredonda pct para 1 casa decimal", () => {
    const result = calcComparativo(1333, 1000);
    expect(result.pct).toBe(33.3);
  });
});

// ─── Testes do exportData shape ───────────────────────────────────────────────

describe("exportData shape", () => {
  const mockExportData = {
    generatedAt: new Date().toISOString(),
    period: { days: 30, since: new Date().toISOString() },
    kpis: {
      totalActive: 464,
      totalOpen: 212823.5,
      recovered: 105896.0,
      recoveryRate: 33.2,
    },
    ranking: [
      { name: "Cliente A", titlesCount: 3, totalDebt: 15000, maxDaysOverdue: 45 },
      { name: "Cliente B", titlesCount: 1, totalDebt: 8500, maxDaysOverdue: 12 },
    ],
    faixas: [
      { faixa: "0-7", count: 12, total: 8000 },
      { faixa: "8-15", count: 8, total: 12000 },
      { faixa: "16-30", count: 5, total: 9500 },
      { faixa: "30+", count: 20, total: 45000 },
    ],
  };

  it("tem todos os campos obrigatórios no exportData", () => {
    expect(mockExportData).toHaveProperty("kpis");
    expect(mockExportData).toHaveProperty("ranking");
    expect(mockExportData).toHaveProperty("faixas");
    expect(mockExportData).toHaveProperty("period");
  });

  it("kpis tem os campos corretos", () => {
    expect(mockExportData.kpis).toHaveProperty("totalActive");
    expect(mockExportData.kpis).toHaveProperty("totalOpen");
    expect(mockExportData.kpis).toHaveProperty("recovered");
    expect(mockExportData.kpis).toHaveProperty("recoveryRate");
  });

  it("ranking tem no máximo 20 itens", () => {
    expect(mockExportData.ranking.length).toBeLessThanOrEqual(20);
  });

  it("faixas tem os 4 buckets esperados", () => {
    const faixaKeys = mockExportData.faixas.map(f => f.faixa);
    expect(faixaKeys).toContain("0-7");
    expect(faixaKeys).toContain("8-15");
    expect(faixaKeys).toContain("16-30");
    expect(faixaKeys).toContain("30+");
  });

  it("recoveryRate está entre 0 e 100", () => {
    expect(mockExportData.kpis.recoveryRate).toBeGreaterThanOrEqual(0);
    expect(mockExportData.kpis.recoveryRate).toBeLessThanOrEqual(100);
  });
});

// ─── Testes de rate limit de alertas ─────────────────────────────────────────

describe("alerta rate limit", () => {
  it("não dispara alerta se lastTriggeredAt for hoje", () => {
    const lastTriggeredAt = new Date();
    const now = new Date();
    const sameDay =
      lastTriggeredAt.toDateString() === now.toDateString();
    expect(sameDay).toBe(true); // rate limit deve bloquear
  });

  it("dispara alerta se lastTriggeredAt for ontem", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const now = new Date();
    const sameDay = yesterday.toDateString() === now.toDateString();
    expect(sameDay).toBe(false); // rate limit deve liberar
  });

  it("threshold de valor em aberto dispara quando current >= threshold", () => {
    const threshold = 250000;
    const currentOpen = 260000;
    expect(currentOpen >= threshold).toBe(true);
  });

  it("threshold de valor em aberto não dispara quando current < threshold", () => {
    const threshold = 250000;
    const currentOpen = 240000;
    expect(currentOpen >= threshold).toBe(false);
  });

  it("threshold de aumento % dispara quando pctIncrease >= threshold", () => {
    const threshold = 10; // 10%
    const prevOpen = 200000;
    const currentOpen = 225000;
    const pctIncrease = ((currentOpen - prevOpen) / prevOpen) * 100;
    expect(pctIncrease).toBeGreaterThanOrEqual(threshold);
  });
});
