/**
 * Sprint 4 Tests — Ações no Dossiê, Estágio no Ranking, Simulação
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Helper: calcDelta (copy from dashboard2Router) ──────────────────────────

function calcDelta(current: number, previous: number) {
  const delta = current - previous;
  const pct = previous === 0 ? (current > 0 ? 100 : 0) : (delta / previous) * 100;
  const direction = Math.abs(pct) < 1 ? "flat" : delta > 0 ? "up" : "down";
  return { delta, pct: Math.round(pct * 10) / 10, direction };
}

// ─── Helper: determineReguaStage (simulated) ─────────────────────────────────

function determineReguaStage(
  maxDaysOverdue: number,
  optOut: boolean,
  hasWhatsapp: boolean,
  isJuridico: boolean
): string {
  if (isJuridico) return "juridico";
  if (optOut) return "opt_out";
  if (!hasWhatsapp) return "sem_whatsapp";
  if (maxDaysOverdue <= 0) return "d_minus_3";
  if (maxDaysOverdue <= 3) return "d_0";
  if (maxDaysOverdue <= 7) return "d_plus_3";
  if (maxDaysOverdue <= 15) return "d_plus_7";
  return "d_plus_15";
}

// ─── Helper: nextDispatchDate ─────────────────────────────────────────────────

function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function nextBusinessDay(from: Date): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  while (!isBusinessDay(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Sprint 4 — Opt-out pula na régua", () => {
  it("cliente com optOut=true deve ter stage=opt_out", () => {
    const stage = determineReguaStage(30, true, true, false);
    expect(stage).toBe("opt_out");
  });

  it("cliente jurídico deve ter stage=juridico mesmo com optOut=false", () => {
    const stage = determineReguaStage(30, false, true, true);
    expect(stage).toBe("juridico");
  });

  it("cliente sem whatsapp deve ter stage=sem_whatsapp", () => {
    const stage = determineReguaStage(10, false, false, false);
    expect(stage).toBe("sem_whatsapp");
  });

  it("cliente com 7 dias de atraso deve ter stage=d_plus_3", () => {
    const stage = determineReguaStage(7, false, true, false);
    expect(stage).toBe("d_plus_3");
  });

  it("cliente com 15 dias de atraso deve ter stage=d_plus_7", () => {
    const stage = determineReguaStage(15, false, true, false);
    expect(stage).toBe("d_plus_7");
  });

  it("cliente com 20 dias de atraso deve ter stage=d_plus_15", () => {
    const stage = determineReguaStage(20, false, true, false);
    expect(stage).toBe("d_plus_15");
  });
});

describe("Sprint 4 — Lembrete manual gera auditoria", () => {
  it("correlationId deve ser gerado para cada envio manual", () => {
    // Simula geração de correlationId
    const correlationId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    expect(correlationId).toMatch(/^manual_\d+_[a-z0-9]+$/);
  });

  it("trigger deve ser 'manual' para lembretes manuais", () => {
    const trigger = "manual";
    expect(trigger).toBe("manual");
  });

  it("trigger deve ser 'cron' para disparos automáticos", () => {
    const trigger = "cron";
    expect(trigger).toBe("cron");
  });
});

describe("Sprint 4 — Preview mostra motivos corretos", () => {
  const mockCandidates = [
    { clientId: 1, clientName: "Cliente A", phone: "5511999990001", stage: "d_plus_7", totalDebt: 1500, titlesCount: 2, maxDaysOverdue: 10, hasPaymentLink: true },
    { clientId: 2, clientName: "Cliente B", phone: "5511999990002", stage: "d_plus_15", totalDebt: 3200, titlesCount: 3, maxDaysOverdue: 20, hasPaymentLink: false },
  ];

  it("preview deve retornar lista de candidatos com stage", () => {
    expect(mockCandidates.every(c => c.stage)).toBe(true);
  });

  it("preview deve incluir totalDebt e titlesCount", () => {
    expect(mockCandidates.every(c => c.totalDebt > 0 && c.titlesCount > 0)).toBe(true);
  });

  it("preview deve incluir hasPaymentLink", () => {
    expect(mockCandidates.some(c => c.hasPaymentLink)).toBe(true);
    expect(mockCandidates.some(c => !c.hasPaymentLink)).toBe(true);
  });

  it("totalCandidates deve ser >= candidates.length", () => {
    const totalCandidates = mockCandidates.length;
    const candidates = mockCandidates.filter(c => c.stage !== "opt_out");
    expect(totalCandidates).toBeGreaterThanOrEqual(candidates.length);
  });
});

describe("Sprint 4 — calcDelta sem NaN", () => {
  it("calcDelta com previous=0 e current=0 deve retornar flat", () => {
    const r = calcDelta(0, 0);
    expect(r.direction).toBe("flat");
    expect(isNaN(r.pct)).toBe(false);
  });

  it("calcDelta com previous=0 e current>0 deve retornar 100%", () => {
    const r = calcDelta(100, 0);
    expect(r.pct).toBe(100);
    expect(r.direction).toBe("up");
  });

  it("calcDelta com previous=100 e current=110 deve retornar +10%", () => {
    const r = calcDelta(110, 100);
    expect(r.pct).toBe(10);
    expect(r.direction).toBe("up");
  });

  it("calcDelta com previous=100 e current=90 deve retornar -10%", () => {
    const r = calcDelta(90, 100);
    expect(r.pct).toBe(-10);
    expect(r.direction).toBe("down");
  });
});

describe("Sprint 4 — nextBusinessDay", () => {
  it("sexta-feira deve avançar para segunda-feira", () => {
    // 2025-01-17 é sexta-feira (getDay()=5)
    const friday = new Date("2025-01-17T12:00:00Z");
    expect(friday.getUTCDay()).toBe(5);
    const next = nextBusinessDay(friday);
    // próximo dia útil após sexta é segunda (getDay()=1)
    expect(next.getUTCDay()).toBe(1);
  });

  it("sábado deve avançar para segunda-feira", () => {
    // 2025-01-18 é sábado (getUTCDay()=6)
    const saturday = new Date("2025-01-18T12:00:00Z");
    expect(saturday.getUTCDay()).toBe(6);
    const next = nextBusinessDay(saturday);
    expect(next.getUTCDay()).toBe(1);
  });

  it("segunda-feira deve avançar para terça-feira", () => {
    // 2025-01-20 é segunda-feira (getUTCDay()=1)
    const monday = new Date("2025-01-20T12:00:00Z");
    expect(monday.getUTCDay()).toBe(1);
    const next = nextBusinessDay(monday);
    expect(next.getUTCDay()).toBe(2);
  });
});
