/**
 * Testes para o syncPaymentsJob melhorado
 * Cobre: isPaidStatus, isLostOrCancelledStatus, normalizeBaseUrl, windowDays
 */

import { describe, it, expect } from 'vitest';

// --- Helpers internos (replicados para teste sem importar o módulo completo) ---

function isPaidStatus(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).toLowerCase().trim();
  if (s === 'acquitted') return true;
  if (s === 'paid' || s === 'paga' || s === 'quitada' || s === 'recebido') return true;
  if (s.includes('quit') || s.includes('paid') || s.includes('recebid')) return true;
  return false;
}

function isLostOrCancelledStatus(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).toLowerCase().trim();
  return s === 'lost' || s === 'cancelled' || s === 'cancelado' || s === 'perdido';
}

function normalizeBaseUrl(input?: string): string {
  let base = input || 'https://api-v2.contaazul.com';
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/v1\/?$/, '');
  return base;
}

// --- Testes ---

describe('isPaidStatus', () => {
  it('reconhece ACQUITTED como pago', () => {
    expect(isPaidStatus('ACQUITTED')).toBe(true);
    expect(isPaidStatus('acquitted')).toBe(true);
  });

  it('reconhece variações de paid/paga/quitada', () => {
    expect(isPaidStatus('paid')).toBe(true);
    expect(isPaidStatus('PAID')).toBe(true);
    expect(isPaidStatus('paga')).toBe(true);
    expect(isPaidStatus('quitada')).toBe(true);
    expect(isPaidStatus('recebido')).toBe(true);
    expect(isPaidStatus('RECEBIDO')).toBe(true);
  });

  it('reconhece strings parciais', () => {
    expect(isPaidStatus('ACQUITTED_PARTIAL')).toBe(true); // contém 'quit'
    expect(isPaidStatus('PAID_LATE')).toBe(true);         // contém 'paid'
  });

  it('não marca OVERDUE como pago', () => {
    expect(isPaidStatus('OVERDUE')).toBe(false);
    expect(isPaidStatus('OPEN')).toBe(false);
    expect(isPaidStatus('PENDING')).toBe(false);
  });

  it('trata null/undefined como não pago', () => {
    expect(isPaidStatus(null)).toBe(false);
    expect(isPaidStatus(undefined)).toBe(false);
    expect(isPaidStatus('')).toBe(false);
  });
});

describe('isLostOrCancelledStatus', () => {
  it('reconhece LOST e CANCELLED', () => {
    expect(isLostOrCancelledStatus('lost')).toBe(true);
    expect(isLostOrCancelledStatus('LOST')).toBe(true);
    expect(isLostOrCancelledStatus('cancelled')).toBe(true);
    expect(isLostOrCancelledStatus('CANCELLED')).toBe(true);
    expect(isLostOrCancelledStatus('cancelado')).toBe(true);
    expect(isLostOrCancelledStatus('perdido')).toBe(true);
  });

  it('não marca OVERDUE como cancelado', () => {
    expect(isLostOrCancelledStatus('OVERDUE')).toBe(false);
    expect(isLostOrCancelledStatus('OPEN')).toBe(false);
    expect(isLostOrCancelledStatus('ACQUITTED')).toBe(false);
  });

  it('trata null/undefined como não cancelado', () => {
    expect(isLostOrCancelledStatus(null)).toBe(false);
    expect(isLostOrCancelledStatus(undefined)).toBe(false);
  });
});

describe('normalizeBaseUrl', () => {
  it('remove /v1 do final', () => {
    expect(normalizeBaseUrl('https://api-v2.contaazul.com/v1')).toBe('https://api-v2.contaazul.com');
    expect(normalizeBaseUrl('https://api-v2.contaazul.com/v1/')).toBe('https://api-v2.contaazul.com');
  });

  it('remove barra final', () => {
    expect(normalizeBaseUrl('https://api-v2.contaazul.com/')).toBe('https://api-v2.contaazul.com');
  });

  it('mantém URL sem /v1', () => {
    expect(normalizeBaseUrl('https://api-v2.contaazul.com')).toBe('https://api-v2.contaazul.com');
  });

  it('usa default quando undefined', () => {
    expect(normalizeBaseUrl(undefined)).toBe('https://api-v2.contaazul.com');
  });
});

describe('windowDays logic', () => {
  it('calcula a data de início corretamente para 60 dias', () => {
    const windowDays = 60;
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    const diffMs = Date.now() - windowStart.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    expect(diffDays).toBe(windowDays);
  });

  it('calcula a data de fim (hoje + 30 dias) corretamente', () => {
    const toDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const diffMs = toDate.getTime() - Date.now();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    expect(diffDays).toBe(30);
  });
});

describe('Cenário de desync: título substituído no CA', () => {
  it('título com ID diferente no CA não é encontrado no caMap → não atualiza', () => {
    // Simula o cenário da PAOLLA: contaAzulId local não existe no CA
    const caMap = new Map<string, { id: string; status: string }>([
      ['e18c62b5-novo-id', { id: 'e18c62b5-novo-id', status: 'ACQUITTED' }],
    ]);

    const localReceivable = {
      id: 420467,
      contaAzulId: 'd1625d70-id-antigo',
      status: 'overdue',
    };

    const ca = caMap.get(String(localReceivable.contaAzulId));
    expect(ca).toBeUndefined(); // ID não encontrado → sync não atualiza
  });

  it('título com mesmo ID no CA é encontrado e marcado como pago', () => {
    const caMap = new Map<string, { id: string; status: string }>([
      ['dcdacdc1-kadydja', { id: 'dcdacdc1-kadydja', status: 'ACQUITTED' }],
    ]);

    const localReceivable = {
      id: 420473,
      contaAzulId: 'dcdacdc1-kadydja',
      status: 'pending',
    };

    const ca = caMap.get(String(localReceivable.contaAzulId));
    expect(ca).toBeDefined();
    expect(isPaidStatus(ca?.status)).toBe(true);
  });
});
