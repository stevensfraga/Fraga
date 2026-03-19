import { describe, it, expect, vi } from 'vitest';
import {
  intentDetect,
  isFinancialIntent,
  buildReply,
  formatBRL,
  DebtSummary,
} from './aiDebtAssistant';

describe('aiDebtAssistant', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // formatBRL
  // ═══════════════════════════════════════════════════════════════════════════
  describe('formatBRL', () => {
    it('deve formatar valor como moeda BRL corretamente', () => {
      const result = formatBRL(255.6);
      expect(result).toContain('255');
      expect(result).toContain('60');
      expect(result).toContain('R$');
    });

    it('deve formatar valor inteiro corretamente', () => {
      const result = formatBRL(5000);
      expect(result).toContain('5');
      expect(result).toContain('000');
      expect(result).toContain('R$');
    });

    it('nunca deve retornar "255.6" sem formatação', () => {
      const result = formatBRL(255.6);
      expect(result).not.toBe('255.6');
      expect(result).not.toBe('255.60');
    });

    it('deve formatar zero corretamente', () => {
      const result = formatBRL(0);
      expect(result).toContain('R$');
      expect(result).toContain('0');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // intentDetect
  // ═══════════════════════════════════════════════════════════════════════════
  describe('intentDetect', () => {
    it('deve detectar intenção "saldo"', () => {
      expect(intentDetect('qual é meu saldo?')).toBe('saldo');
      expect(intentDetect('quanto devo?')).toBe('saldo');
      expect(intentDetect('valor em aberto')).toBe('saldo');
    });

    it('deve detectar intenção "link"', () => {
      expect(intentDetect('preciso do link de pagamento')).toBe('link');
      expect(intentDetect('como pago?')).toBe('link');
      expect(intentDetect('boleto')).toBe('link');
    });

    it('deve detectar intenção "negociar"', () => {
      expect(intentDetect('quero negociar')).toBe('negociar');
      expect(intentDetect('posso parcelar?')).toBe('negociar');
      expect(intentDetect('tem desconto?')).toBe('negociar');
    });

    it('deve detectar intenção "paguei"', () => {
      expect(intentDetect('já paguei')).toBe('paguei');
      expect(intentDetect('transferi ontem')).toBe('paguei');
      expect(intentDetect('depositei')).toBe('paguei');
    });

    it('deve detectar intenção "humano"', () => {
      expect(intentDetect('quero falar com humano')).toBe('humano');
      expect(intentDetect('preciso de um atendente')).toBe('humano');
    });

    it('deve detectar intenção "contestar"', () => {
      expect(intentDetect('quero contestar essa cobrança')).toBe('contestar');
      expect(intentDetect('não concordo com esse valor')).toBe('contestar');
      expect(intentDetect('cobrança indevida')).toBe('contestar');
    });

    it('deve detectar intenção "juridico"', () => {
      expect(intentDetect('vou acionar o jurídico')).toBe('juridico');
      expect(intentDetect('meu advogado vai resolver')).toBe('juridico');
      expect(intentDetect('vou no procon')).toBe('juridico');
      expect(intentDetect('isso é uma ameaça')).toBe('juridico');
    });

    it('deve detectar intenção "rescisao"', () => {
      expect(intentDetect('quero rescisão do contrato')).toBe('rescisao');
      expect(intentDetect('cancelar contrato')).toBe('rescisao');
      expect(intentDetect('encerrar contrato agora')).toBe('rescisao');
    });

    it('deve retornar "desconhecido" para mensagens genéricas', () => {
      expect(intentDetect('oi')).toBe('desconhecido');
      expect(intentDetect('tudo bem?')).toBe('desconhecido');
      expect(intentDetect('bom dia')).toBe('desconhecido');
      expect(intentDetect('obrigado')).toBe('desconhecido');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // isFinancialIntent
  // ═══════════════════════════════════════════════════════════════════════════
  describe('isFinancialIntent', () => {
    it('deve retornar true para intents financeiros', () => {
      expect(isFinancialIntent('saldo')).toBe(true);
      expect(isFinancialIntent('link')).toBe(true);
      expect(isFinancialIntent('negociar')).toBe(true);
      expect(isFinancialIntent('paguei')).toBe(true);
    });

    it('deve retornar false para intents não financeiros', () => {
      expect(isFinancialIntent('humano')).toBe(false);
      expect(isFinancialIntent('contestar')).toBe(false);
      expect(isFinancialIntent('juridico')).toBe(false);
      expect(isFinancialIntent('rescisao')).toBe(false);
      expect(isFinancialIntent('desconhecido')).toBe(false);
    });

    it('deve retornar false para intents inexistentes', () => {
      expect(isFinancialIntent('')).toBe(false);
      expect(isFinancialIntent('qualquer_coisa')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // buildReply — NOVO TEMPLATE OFICIAL
  // ═══════════════════════════════════════════════════════════════════════════
  describe('buildReply', () => {
    const mockDebtSummary: DebtSummary = {
      clientId: 1,
      clientName: 'Empresa Teste',
      documento: '12345678000190',
      email: 'teste@empresa.com',
      totalDebt: 5000.50,
      titlesCount: 3,
      maxDaysOverdue: 45,
      paymentLinkCanonical: 'https://payment.link/abc123',
      receivables: [
        { id: 1, amount: 2000, dueDate: new Date('2026-01-15'), daysOverdue: 43, status: 'overdue' },
        { id: 2, amount: 1500.50, dueDate: new Date('2026-01-20'), daysOverdue: 38, status: 'overdue' },
        { id: 3, amount: 1500, dueDate: new Date('2026-02-01'), daysOverdue: 26, status: 'overdue' },
      ],
    };

    // ── CENÁRIO: sem saldo em aberto (PARTE 2) ──
    it('deve retornar "não existe nenhum valor em aberto" quando debtSummary é null', () => {
      const reply = buildReply('saldo', null);
      expect(reply).toContain('não existe nenhum valor em aberto');
      expect(reply).not.toContain('Valor em aberto:');
      expect(reply).not.toContain('Quantidade de títulos:');
      expect(reply).not.toContain('Maior atraso:');
      expect(reply).not.toContain('payment.link');
    });

    it('deve retornar "não existe nenhum valor em aberto" para qualquer intent quando null', () => {
      const intents = ['saldo', 'link', 'negociar', 'paguei', 'humano', 'desconhecido'];
      for (const intent of intents) {
        const reply = buildReply(intent, null);
        expect(reply).toContain('não existe nenhum valor em aberto');
        // Nunca enviar link de cobrança quando sem saldo
        expect(reply).not.toContain('payment.link');
      }
    });

    it('deve retornar "não existe nenhum valor em aberto" quando totalDebt é 0', () => {
      const zeroDebt: DebtSummary = { ...mockDebtSummary, totalDebt: 0, titlesCount: 0 };
      const reply = buildReply('saldo', zeroDebt);
      expect(reply).toContain('não existe nenhum valor em aberto');
      expect(reply).not.toContain('Valor em aberto:');
    });

    it('deve retornar "não existe nenhum valor em aberto" quando totalDebt é negativo', () => {
      const negativeDebt: DebtSummary = { ...mockDebtSummary, totalDebt: -100 };
      const reply = buildReply('saldo', negativeDebt);
      expect(reply).toContain('não existe nenhum valor em aberto');
    });

    // ── CENÁRIO: com saldo — TEMPLATE OFICIAL (PARTE 1) ──
    it('deve usar "Verifiquei em nosso sistema" no template de saldo', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      expect(reply).toContain('Verifiquei em nosso sistema');
      // Nunca usar "Seu saldo em aberto"
      expect(reply).not.toContain('Seu saldo em aberto');
    });

    it('deve incluir nome do cliente na resposta de saldo', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      expect(reply).toContain('Empresa Teste');
    });

    it('deve incluir valor formatado em BRL (não "5000.5" ou "5000.50")', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      // Deve conter R$ com formatação brasileira
      expect(reply).toContain('R$');
      // Não deve conter valor sem formatação
      expect(reply).not.toContain('5000.5\n');
      expect(reply).not.toContain('5000.50\n');
    });

    it('deve incluir quantidade de títulos e dias de atraso', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      expect(reply).toContain('3');
      expect(reply).toContain('45 dias');
    });

    it('deve incluir link de pagamento quando disponível', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      expect(reply).toContain('https://payment.link/abc123');
    });

    it('deve incluir mensagem de baixa automática após pagamento', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      expect(reply).toContain('baixa ocorre automaticamente');
    });

    it('deve incluir oferta de ajuda para negociação', () => {
      const reply = buildReply('saldo', mockDebtSummary);
      expect(reply).toContain('segunda via ou negociação');
    });

    // ── INTENT "link" usa mesmo template que "saldo" ──
    it('deve usar template oficial para intent "link"', () => {
      const reply = buildReply('link', mockDebtSummary);
      expect(reply).toContain('Verifiquei em nosso sistema');
      expect(reply).toContain('https://payment.link/abc123');
    });

    it('deve informar link não disponível quando paymentLinkCanonical é null', () => {
      const debtWithoutLink = { ...mockDebtSummary, paymentLinkCanonical: null };
      const reply = buildReply('link', debtWithoutLink);
      expect(reply).toContain('link de pagamento');
      expect(reply).not.toContain('https://');
    });

    // ── INTENT "negociar" ──
    it('deve retornar resposta de negociação com valor formatado', () => {
      const reply = buildReply('negociar', mockDebtSummary);
      expect(reply).toContain('Empresa Teste');
      expect(reply).toContain('R$');
      expect(reply).toContain('atendimento especializado');
    });

    // ── INTENT "paguei" ──
    it('deve retornar resposta de pagamento realizado', () => {
      const reply = buildReply('paguei', mockDebtSummary);
      expect(reply).toContain('Obrigado pelo pagamento');
      expect(reply).toContain('24h');
    });

    // ── INTENT "humano" ──
    it('deve retornar resposta de handoff para humano', () => {
      const reply = buildReply('humano', mockDebtSummary);
      expect(reply).toContain('atendimento');
    });

    // ── INTENT desconhecido — usa template padrão com saldo ──
    it('deve retornar template padrão com saldo para intenção desconhecida', () => {
      const reply = buildReply('desconhecido', mockDebtSummary);
      expect(reply).toContain('Verifiquei em nosso sistema');
      expect(reply).toContain('R$');
    });

    // ── CONVERSÃO NUMÉRICA SEGURA ──
    it('deve lidar com totalDebt como string (bug do banco)', () => {
      const stringDebt: DebtSummary = { ...mockDebtSummary, totalDebt: '5000.50' as any };
      const reply = buildReply('saldo', stringDebt);
      expect(reply).toContain('R$');
      expect(reply).not.toContain('não existe nenhum valor em aberto');
    });

    it('deve tratar totalDebt como "0" (string) como sem saldo', () => {
      const zeroStringDebt: DebtSummary = { ...mockDebtSummary, totalDebt: '0' as any };
      const reply = buildReply('saldo', zeroStringDebt);
      expect(reply).toContain('não existe nenhum valor em aberto');
    });
  });
});
