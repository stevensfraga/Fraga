/**
 * Testes para feature flags e whitelist
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('featureFlags', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe('isPhoneWhitelisted', () => {
    it('deve retornar true para número na whitelist', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '+5527981657804';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(true);
    });

    it('deve retornar false para número fora da whitelist', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '+5527981657804';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5511999999999')).toBe(false);
    });

    it('deve retornar false se whitelist vazia', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(false);
    });

    it('deve retornar false se whitelist não definida', async () => {
      delete process.env.WHATSAPP_AI_WHITELIST;
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(false);
    });

    it('deve aceitar wildcard "*" para todos os números', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '*';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(true);
      expect(isPhoneWhitelisted('+5511999999999')).toBe(true);
      expect(isPhoneWhitelisted('+1234567890')).toBe(true);
    });

    it('deve suportar múltiplos números separados por vírgula', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '+5527981657804,+5511999999999';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(true);
      expect(isPhoneWhitelisted('+5511999999999')).toBe(true);
      expect(isPhoneWhitelisted('+5521888888888')).toBe(false);
    });

    it('deve fazer match sem "+" no input', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '+5527981657804';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('5527981657804')).toBe(true);
    });

    it('deve fazer match com "+" no input quando whitelist sem "+"', async () => {
      process.env.WHATSAPP_AI_WHITELIST = '5527981657804';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(true);
    });

    it('deve ignorar espaços na whitelist', async () => {
      process.env.WHATSAPP_AI_WHITELIST = ' +5527981657804 , +5511999999999 ';
      const { isPhoneWhitelisted } = await import('./featureFlags');
      expect(isPhoneWhitelisted('+5527981657804')).toBe(true);
      expect(isPhoneWhitelisted('+5511999999999')).toBe(true);
    });
  });

  describe('FEATURE_FLAGS', () => {
    it('INBOUND_AI_ENABLED deve ser true quando env=true', async () => {
      process.env.INBOUND_AI_ENABLED = 'true';
      const { FEATURE_FLAGS } = await import('./featureFlags');
      expect(FEATURE_FLAGS.INBOUND_AI_ENABLED).toBe(true);
    });

    it('INBOUND_AI_ENABLED deve ser false quando env=false', async () => {
      process.env.INBOUND_AI_ENABLED = 'false';
      const { FEATURE_FLAGS } = await import('./featureFlags');
      expect(FEATURE_FLAGS.INBOUND_AI_ENABLED).toBe(false);
    });

    it('KILL_SWITCH deve ser false por padrão', async () => {
      delete process.env.KILL_SWITCH;
      const { FEATURE_FLAGS } = await import('./featureFlags');
      expect(FEATURE_FLAGS.KILL_SWITCH).toBe(false);
    });
  });
});
