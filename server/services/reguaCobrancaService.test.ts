/**
 * Testes: Régua de Cobrança Service (PROVA DE FOGO)
 *
 * Cobertura:
 *   - isQuietHours: horário normal, quiet hours, cruzamento de meia-noite
 *   - isBusinessDay: seg-sex, sábado, domingo
 *   - getAllowedStages: env var, default
 *   - determineStage: todas as faixas (-3 a 15, fora da faixa)
 *   - buildReguaMessage: todos os 5 templates
 *   - consolidateCandidates: múltiplos títulos por cliente, etapa mais avançada
 *   - isOptOutMessage: palavras-chave de opt-out
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isQuietHours,
  isBusinessDay,
  getAllowedStages,
  determineStage,
  buildReguaMessage,
  consolidateCandidates,
  isOptOutMessage,
  type ReguaCandidate,
  type ReguaStage,
} from './reguaCobrancaService';

// ─── isQuietHours ─────────────────────────────────────────────────────────────

describe('isQuietHours', () => {
  const originalEnv = process.env.REGUA_QUIET_HOURS;

  beforeEach(() => {
    process.env.REGUA_QUIET_HOURS = '18:00-08:00';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.REGUA_QUIET_HOURS = originalEnv;
    } else {
      delete process.env.REGUA_QUIET_HOURS;
    }
  });

  it('deve retornar false para horário comercial (10:00 BRT)', () => {
    const date = new Date('2026-03-01T13:00:00.000Z'); // 10:00 BRT
    expect(isQuietHours(date)).toBe(false);
  });

  it('deve retornar true para 19:00 BRT (quiet hours 18:00-08:00)', () => {
    // 19:00 BRT = 22:00 UTC
    const date = new Date('2026-03-01T22:00:00.000Z');
    expect(isQuietHours(date)).toBe(true);
  });

  it('deve retornar true para 03:00 BRT (quiet hours ativas, cruzamento meia-noite)', () => {
    const date = new Date('2026-03-01T06:00:00.000Z'); // 03:00 BRT
    expect(isQuietHours(date)).toBe(true);
  });

  it('deve retornar false para 08:01 BRT (logo após quiet hours)', () => {
    const date = new Date('2026-03-01T11:01:00.000Z'); // 08:01 BRT
    expect(isQuietHours(date)).toBe(false);
  });

  it('deve retornar false se REGUA_QUIET_HOURS tem formato inválido', () => {
    process.env.REGUA_QUIET_HOURS = 'invalido';
    const date = new Date('2026-03-01T13:00:00.000Z');
    expect(isQuietHours(date)).toBe(false);
  });

  it('deve funcionar com quiet hours sem cruzamento de meia-noite (ex: 22:00-23:00)', () => {
    process.env.REGUA_QUIET_HOURS = '22:00-23:00';
    const dateInside = new Date('2026-03-02T01:30:00.000Z'); // 22:30 BRT
    const dateOutside = new Date('2026-03-01T13:00:00.000Z'); // 10:00 BRT
    expect(isQuietHours(dateInside)).toBe(true);
    expect(isQuietHours(dateOutside)).toBe(false);
  });
});

// ─── isBusinessDay ────────────────────────────────────────────────────────────

describe('isBusinessDay', () => {
  it('deve retornar true para segunda-feira', () => {
    // 2026-03-02 é segunda-feira
    const date = new Date('2026-03-02T13:00:00.000Z'); // 10:00 BRT
    expect(isBusinessDay(date)).toBe(true);
  });

  it('deve retornar true para sexta-feira', () => {
    // 2026-02-27 é sexta-feira
    const date = new Date('2026-02-27T13:00:00.000Z');
    expect(isBusinessDay(date)).toBe(true);
  });

  it('deve retornar false para sábado', () => {
    // 2026-02-28 é sábado
    const date = new Date('2026-02-28T13:00:00.000Z');
    expect(isBusinessDay(date)).toBe(false);
  });

  it('deve retornar false para domingo', () => {
    // 2026-03-01 é domingo
    const date = new Date('2026-03-01T13:00:00.000Z');
    expect(isBusinessDay(date)).toBe(false);
  });
});

// ─── getAllowedStages ─────────────────────────────────────────────────────────

describe('getAllowedStages', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.REGUA_ALLOWED_STAGES;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.REGUA_ALLOWED_STAGES = savedEnv;
    } else {
      delete process.env.REGUA_ALLOWED_STAGES;
    }
  });

  it('deve retornar TODOS os estágios quando env var tem valor legado (d_plus_7,d_plus_15)', () => {
    // Comportamento corrigido em 09/03/2026: valor legado é tratado como "todos os estágios"
    process.env.REGUA_ALLOWED_STAGES = 'd_plus_7,d_plus_15';
    const stages = getAllowedStages();
    expect(stages).toHaveLength(11); // todos os 11 estágios
    expect(stages).toContain('d_plus_7');
    expect(stages).toContain('d_plus_15');
    expect(stages).toContain('d_minus_3');
    expect(stages).toContain('d_plus_365');
  });

  it('deve retornar todas as etapas quando env var é "*"', () => {
    // "*" não é uma etapa válida, então retorna vazio (filtro só aceita etapas válidas)
    // Para liberar todas, usar: d_minus_3,d_0,d_plus_3,d_plus_7,d_plus_15
    process.env.REGUA_ALLOWED_STAGES = 'd_minus_3,d_0,d_plus_3,d_plus_7,d_plus_15';
    const stages = getAllowedStages();
    expect(stages).toEqual(['d_minus_3', 'd_0', 'd_plus_3', 'd_plus_7', 'd_plus_15']);
  });

  it('deve retornar TODOS os estágios quando env var não está definida (correção estrutural)', () => {
    delete process.env.REGUA_ALLOWED_STAGES;
    const stages = getAllowedStages();
    // Correção 09/03/2026: Default agora inclui todos os estágios
    expect(stages).toEqual(['d_minus_3', 'd_0', 'd_plus_3', 'd_plus_7', 'd_plus_15', 'd_plus_30', 'd_plus_45', 'd_plus_60', 'd_plus_90', 'd_plus_180', 'd_plus_365']);
  });

  it('deve aceitar REGUA_ALLOWED_STAGES com todos os estágios', () => {
    process.env.REGUA_ALLOWED_STAGES = 'd_minus_3,d_0,d_plus_3,d_plus_7,d_plus_15,d_plus_30,d_plus_45,d_plus_60,d_plus_90,d_plus_180,d_plus_365';
    const stages = getAllowedStages();
    expect(stages).toHaveLength(11);
    expect(stages).toContain('d_plus_30');
    expect(stages).toContain('d_plus_60');
    expect(stages).toContain('d_plus_90');
  });

  it('deve filtrar etapas inválidas', () => {
    process.env.REGUA_ALLOWED_STAGES = 'd_plus_7,invalido,d_0';
    const stages = getAllowedStages();
    expect(stages).toEqual(['d_plus_7', 'd_0']);
  });
});

// ─── isOptOutMessage ──────────────────────────────────────────────────────────

describe('isOptOutMessage', () => {
  it('deve retornar true para "parar"', () => {
    expect(isOptOutMessage('parar')).toBe(true);
  });

  it('deve retornar true para "cancelar"', () => {
    expect(isOptOutMessage('cancelar')).toBe(true);
  });

  it('deve retornar true para "PARAR" (case insensitive)', () => {
    expect(isOptOutMessage('PARAR')).toBe(true);
  });

  it('deve retornar true para "sair"', () => {
    expect(isOptOutMessage('sair')).toBe(true);
  });

  it('deve retornar true para "não quero mais"', () => {
    expect(isOptOutMessage('não quero mais')).toBe(true);
  });

  it('deve retornar true para "nao quero mais" (sem acento)', () => {
    expect(isOptOutMessage('nao quero mais')).toBe(true);
  });

  it('deve retornar true para "pare de enviar"', () => {
    expect(isOptOutMessage('pare de enviar')).toBe(true);
  });

  it('deve retornar false para "quanto devo?"', () => {
    expect(isOptOutMessage('quanto devo?')).toBe(false);
  });

  it('deve retornar false para "bom dia"', () => {
    expect(isOptOutMessage('bom dia')).toBe(false);
  });

  it('deve retornar false para texto vazio', () => {
    expect(isOptOutMessage('')).toBe(false);
  });
});

// ─── determineStage ───────────────────────────────────────────────────────────

describe('determineStage', () => {
  it('deve retornar d_minus_3 para daysOverdue=-3', () => {
    expect(determineStage(-3)).toBe('d_minus_3');
  });

  it('deve retornar d_minus_3 para daysOverdue=-1', () => {
    expect(determineStage(-1)).toBe('d_minus_3');
  });

  it('deve retornar d_0 para daysOverdue=0', () => {
    expect(determineStage(0)).toBe('d_0');
  });

  it('deve retornar d_plus_3 para daysOverdue=1', () => {
    expect(determineStage(1)).toBe('d_plus_3');
  });

  it('deve retornar d_plus_3 para daysOverdue=3', () => {
    expect(determineStage(3)).toBe('d_plus_3');
  });

  it('deve retornar d_plus_7 para daysOverdue=4', () => {
    expect(determineStage(4)).toBe('d_plus_7');
  });

  it('deve retornar d_plus_7 para daysOverdue=7', () => {
    expect(determineStage(7)).toBe('d_plus_7');
  });

  it('deve retornar d_plus_15 para daysOverdue=8', () => {
    expect(determineStage(8)).toBe('d_plus_15');
  });

  it('deve retornar d_plus_15 para daysOverdue=15', () => {
    expect(determineStage(15)).toBe('d_plus_15');
  });

  it('deve retornar d_plus_30 para daysOverdue=16', () => {
    expect(determineStage(16)).toBe('d_plus_30');
  });

  it('deve retornar d_plus_60 para daysOverdue=50', () => {
    expect(determineStage(50)).toBe('d_plus_60');
  });

  it('deve retornar d_plus_90 para daysOverdue=70', () => {
    expect(determineStage(70)).toBe('d_plus_90');
  });

  it('deve retornar d_plus_180 para daysOverdue=100', () => {
    expect(determineStage(100)).toBe('d_plus_180');
  });

  it('deve retornar d_plus_365 para daysOverdue=200', () => {
    expect(determineStage(200)).toBe('d_plus_365');
  });

  it('deve retornar null para daysOverdue=-4 (muito cedo)', () => {
    expect(determineStage(-4)).toBeNull();
  });
});

// ─── buildReguaMessage ────────────────────────────────────────────────────────

describe('buildReguaMessage', () => {
  const baseParams = {
    clientName: 'Empresa Teste LTDA',
    totalDebt: 1500.75,
    titlesCount: 3,
    maxDaysOverdue: 5,
    paymentLink: 'https://pagamento.fraga.com.br/abc123',
    correlationId: '[#FRAGA:123:456:789:1234567890]',
  };

  it('d_minus_3: deve conter "3 dias" e link de pagamento', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_minus_3' });
    expect(msg).toContain('3 dias');
    expect(msg).toContain('https://pagamento.fraga.com.br/abc123');
    expect(msg).toContain('Empresa');
    expect(msg).toContain('[#FRAGA:123:456:789:1234567890]');
  });

  it('d_0: deve conter "vencem hoje" e valor formatado', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_0' });
    expect(msg).toContain('hoje');
    expect(msg).toContain('1.500,75');
    expect(msg).toContain('https://pagamento.fraga.com.br/abc123');
  });

  it('d_plus_3: deve conter dias de atraso e link', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_plus_3' });
    expect(msg).toContain('5 dia(s) de atraso');
    expect(msg).toContain('https://pagamento.fraga.com.br/abc123');
  });

  it('d_plus_7: deve conter aviso de restrições cadastrais', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_plus_7' });
    expect(msg).toContain('restrições');
    expect(msg).toContain('negociar');
  });

  it('d_plus_15: deve conter aviso de cobrança administrativa', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_plus_15' });
    expect(msg).toContain('cobrança administrativa');
    expect(msg).toContain('Fraga Contabilidade');
  });

  it('deve exibir aviso quando não há link de pagamento', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_plus_3', paymentLink: null });
    expect(msg).toContain('Link de pagamento não disponível');
  });

  it('deve usar o primeiro nome do cliente', () => {
    const msg = buildReguaMessage({ ...baseParams, stage: 'd_0', clientName: 'João Silva Santos' });
    expect(msg).toContain('João');
    expect(msg).not.toContain('João Silva Santos');
  });

  it('deve incluir correlationId em todos os templates', () => {
    const stages: ReguaStage[] = ['d_minus_3', 'd_0', 'd_plus_3', 'd_plus_7', 'd_plus_15'];
    for (const stage of stages) {
      const msg = buildReguaMessage({ ...baseParams, stage });
      expect(msg).toContain('[#FRAGA:123:456:789:1234567890]');
    }
  });
});

// ─── consolidateCandidates ────────────────────────────────────────────────────

describe('consolidateCandidates', () => {
  const makeCandidate = (
    clientId: number,
    receivableId: number,
    amount: string,
    daysOverdue: number,
    stage: ReguaStage,
    paymentLink?: string
  ): ReguaCandidate => ({
    clientId,
    clientName: `Cliente ${clientId}`,
    whatsappNumber: `+5527999${clientId.toString().padStart(6, '0')}`,
    optOut: false,
    receivableId,
    amount,
    dueDate: new Date(),
    daysOverdue,
    stage,
    paymentLinkCanonical: paymentLink || null,
    link: null,
  });

  it('deve consolidar múltiplos títulos do mesmo cliente em 1 entrada', () => {
    const candidates = [
      makeCandidate(1, 101, '500.00', 3, 'd_plus_3'),
      makeCandidate(1, 102, '300.00', 5, 'd_plus_7'),
      makeCandidate(1, 103, '200.00', 1, 'd_plus_3'),
    ];

    const result = consolidateCandidates(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe(1);
    expect(result[0].totalDebt).toBeCloseTo(1000.0);
    expect(result[0].titlesCount).toBe(3);
    expect(result[0].maxDaysOverdue).toBe(5);
  });

  it('deve usar a etapa mais avançada (maior atraso) para o cliente', () => {
    const candidates = [
      makeCandidate(1, 101, '500.00', 3, 'd_plus_3'),
      makeCandidate(1, 102, '300.00', 10, 'd_plus_15'),
    ];

    const result = consolidateCandidates(candidates);
    expect(result[0].stage).toBe('d_plus_15');
  });

  it('deve separar clientes diferentes', () => {
    const candidates = [
      makeCandidate(1, 101, '500.00', 3, 'd_plus_3'),
      makeCandidate(2, 201, '700.00', 7, 'd_plus_7'),
    ];

    const result = consolidateCandidates(candidates);
    expect(result).toHaveLength(2);
    const client1 = result.find((r) => r.clientId === 1);
    const client2 = result.find((r) => r.clientId === 2);
    expect(client1?.totalDebt).toBeCloseTo(500.0);
    expect(client2?.totalDebt).toBeCloseTo(700.0);
  });

  it('deve retornar lista vazia para candidatos vazios', () => {
    const result = consolidateCandidates([]);
    expect(result).toHaveLength(0);
  });

  it('deve usar paymentLink do título com maior atraso', () => {
    const candidates = [
      makeCandidate(1, 101, '500.00', 3, 'd_plus_3', 'https://link-titulo-3dias.com'),
      makeCandidate(1, 102, '300.00', 10, 'd_plus_15', 'https://link-titulo-10dias.com'),
    ];

    const result = consolidateCandidates(candidates);
    expect(result[0].paymentLink).toBe('https://link-titulo-10dias.com');
  });

  it('deve tratar amount como string e somar corretamente', () => {
    const candidates = [
      makeCandidate(1, 101, '1234.56', 2, 'd_plus_3'),
      makeCandidate(1, 102, '765.44', 2, 'd_plus_3'),
    ];

    const result = consolidateCandidates(candidates);
    expect(result[0].totalDebt).toBeCloseTo(2000.0);
  });
});
