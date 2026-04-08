/**
 * Testes para normalização de números de WhatsApp
 */
import { describe, it, expect } from 'vitest';
import { normalizeWhatsApp, isValidWhatsAppE164 } from './normalizeWhatsApp';

describe('normalizeWhatsApp', () => {
  it('deve normalizar número brasileiro com DDD e 9 dígitos', () => {
    expect(normalizeWhatsApp('27992052149')).toBe('+5527992052149');
  });

  it('deve normalizar número com espaços e traços', () => {
    expect(normalizeWhatsApp('27 99205-2149')).toBe('+5527992052149');
  });

  it('deve normalizar número com parênteses', () => {
    expect(normalizeWhatsApp('(27) 99205-2149')).toBe('+5527992052149');
  });

  it('deve normalizar número que já tem 55 mas sem +', () => {
    expect(normalizeWhatsApp('5527992052149')).toBe('+5527992052149');
  });

  it('deve normalizar número que já tem +55', () => {
    expect(normalizeWhatsApp('+5527992052149')).toBe('+5527992052149');
  });

  it('deve normalizar número com 0 inicial', () => {
    expect(normalizeWhatsApp('027992052149')).toBe('+5527992052149');
  });

  it('deve normalizar número com 8 dígitos (celular antigo)', () => {
    expect(normalizeWhatsApp('2799205214')).toBe('+552799205214');
  });

  it('deve retornar null para número muito curto', () => {
    expect(normalizeWhatsApp('123')).toBe(null);
  });

  it('deve retornar null para número vazio', () => {
    expect(normalizeWhatsApp('')).toBe(null);
  });

  it('deve retornar null para null', () => {
    expect(normalizeWhatsApp(null)).toBe(null);
  });

  it('deve retornar null para undefined', () => {
    expect(normalizeWhatsApp(undefined)).toBe(null);
  });

  it('deve retornar null para DDD inválido (< 11)', () => {
    expect(normalizeWhatsApp('0999205214')).toBe(null);
  });

  it('deve retornar null para DDD inválido (> 99)', () => {
    expect(normalizeWhatsApp('10099205214')).toBe(null);
  });

  it('deve normalizar todos os DDDs válidos (11-99)', () => {
    expect(normalizeWhatsApp('1199205214')).toBe('+551199205214');
    expect(normalizeWhatsApp('2799205214')).toBe('+552799205214');
    expect(normalizeWhatsApp('8599205214')).toBe('+558599205214');
  });

  it('deve normalizar números reais do banco (casos de teste)', () => {
    expect(normalizeWhatsApp('5527995810001')).toBe('+5527995810001');
    expect(normalizeWhatsApp('5511987654321')).toBe('+5511987654321');
    expect(normalizeWhatsApp('5527997190701')).toBe('+5527997190701');
  });
});

describe('isValidWhatsAppE164', () => {
  it('deve validar formato E.164 correto com 13 caracteres', () => {
    expect(isValidWhatsAppE164('+552799205214')).toBe(true);
  });

  it('deve validar formato E.164 correto com 14 caracteres', () => {
    expect(isValidWhatsAppE164('+5527992052149')).toBe(true);
  });

  it('deve rejeitar número sem +', () => {
    expect(isValidWhatsAppE164('5527992052149')).toBe(false);
  });

  it('deve rejeitar número sem 55', () => {
    expect(isValidWhatsAppE164('+27992052149')).toBe(false);
  });

  it('deve rejeitar número muito curto', () => {
    expect(isValidWhatsAppE164('+5527992')).toBe(false);
  });

  it('deve rejeitar número muito longo', () => {
    expect(isValidWhatsAppE164('+552799205214999')).toBe(false);
  });

  it('deve rejeitar null', () => {
    expect(isValidWhatsAppE164(null)).toBe(false);
  });

  it('deve rejeitar undefined', () => {
    expect(isValidWhatsAppE164(undefined)).toBe(false);
  });

  it('deve rejeitar string vazia', () => {
    expect(isValidWhatsAppE164('')).toBe(false);
  });

  it('deve rejeitar número com letras', () => {
    expect(isValidWhatsAppE164('+5527abc52149')).toBe(false);
  });

  it('deve validar números reais do banco após normalização', () => {
    const normalized1 = normalizeWhatsApp('5527995810001');
    expect(isValidWhatsAppE164(normalized1)).toBe(true);

    const normalized2 = normalizeWhatsApp('5511987654321');
    expect(isValidWhatsAppE164(normalized2)).toBe(true);
  });
});
