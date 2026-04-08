import { describe, it, expect } from 'vitest';
import {
  formatarMensagemCobranca,
} from './r7GeradorasCollectionManager';

describe('R7 Geradores Collection Manager', () => {
  describe('formatarMensagemCobranca', () => {
    it('deve incluir valor formatado em moeda brasileira', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
        document_number: 'DOC-001',
        boleto_url: 'https://example.com/boleto',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      expect(mensagem).toContain('R$ 1.500,00');
      expect(mensagem).toContain('DOC-001');
    });

    it('deve incluir link do boleto na mensagem', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
        boleto_url: 'https://example.com/boleto/123',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      expect(mensagem).toContain('https://example.com/boleto/123');
    });

    it('deve formatar valores em moeda brasileira com 2 casas decimais', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1234.56,
        status: 'open',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      expect(mensagem).toContain('R$ 1.234,56');
    });

    it('deve incluir saudação na mensagem', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      expect(mensagem).toContain('Olá');
      expect(mensagem.length).toBeGreaterThan(0);
    });

    it('deve incluir data formatada em português', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: '2026-02-15',
        amount: 1500.0,
        status: 'open',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      // Deve conter a data formatada em português (DD/MM/YYYY)
      expect(mensagem).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('deve incluir emoji na mensagem', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      // Deve conter pelo menos um emoji
      expect(mensagem).toMatch(/[📌⚠️📄💰📅🔗⏰⚡💳👋]/);
    });

    it('deve incluir número do documento', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
        document_number: 'DOC-12345',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      expect(mensagem).toContain('DOC-12345');
    });

    it('deve usar ID como fallback se documento_number não fornecido', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      expect(mensagem).toContain('123');
    });

    it('deve diferenciar mensagens por status de atraso', () => {
      // Boleto em atraso
      const dataPassada = new Date();
      dataPassada.setDate(dataPassada.getDate() - 5);
      const boletoAtrasado = {
        id: '123',
        customer_id: '456',
        due_date: dataPassada.toISOString().split('T')[0],
        amount: 1500.0,
        status: 'overdue',
      };

      const mensagemAtrasada = formatarMensagemCobranca(boletoAtrasado);

      // Deve conter indicador de atraso
      expect(mensagemAtrasada).toContain('atraso');
    });

    it('deve incluir chamada para ação', () => {
      const boleto = {
        id: '123',
        customer_id: '456',
        due_date: new Date().toISOString().split('T')[0],
        amount: 1500.0,
        status: 'open',
      };

      const mensagem = formatarMensagemCobranca(boleto);

      // Deve conter alguma chamada para ação (pague, efetue, etc)
      expect(mensagem.toLowerCase()).toMatch(/(pague|efetue|pagamento)/);
    });
  });
});
