import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getClientWhatsAppNumberFromAcessorias,
  isValidWhatsAppNumber,
} from './acessoriasClientPhone';
import axios from 'axios';

vi.mock('axios');

describe('Acessórias Client Phone Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidWhatsAppNumber', () => {
    it('deve validar número de WhatsApp válido com código de país', () => {
      expect(isValidWhatsAppNumber('5527981657804')).toBe(true);
    });

    it('deve validar número de WhatsApp válido sem código de país', () => {
      expect(isValidWhatsAppNumber('27981657804')).toBe(true);
    });

    it('deve rejeitar número vazio', () => {
      expect(isValidWhatsAppNumber('')).toBe(false);
    });

    it('deve rejeitar número undefined', () => {
      expect(isValidWhatsAppNumber(undefined)).toBe(false);
    });

    it('deve rejeitar número muito curto', () => {
      expect(isValidWhatsAppNumber('123')).toBe(false);
    });

    it('deve rejeitar número com caracteres especiais', () => {
      expect(isValidWhatsAppNumber('(27) 9 8165-7804')).toBe(true);
    });
  });

  describe('getClientWhatsAppNumberFromAcessorias', () => {
    it('deve buscar número de WhatsApp com sucesso', async () => {
      const mockAxios = axios as any;

      // Mock da autenticação
      mockAxios.post.mockResolvedValueOnce({
        data: {
          token: 'mock-token-123',
          expires_in: 3600,
        },
      });

      // Mock da busca de empresa
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'company-123',
              name: 'TCVV TERMINAL',
              email: 'contact@tcvv.com',
            },
          ],
        },
      });

      // Mock da busca de contatos
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'contact-123',
              name: 'João Silva',
              cellphone: '27981657804',
              phone: '2733221234',
              email: 'joao@tcvv.com',
            },
          ],
        },
      });

      const result = await getClientWhatsAppNumberFromAcessorias(
        'TCVV TERMINAL',
        'client-123'
      );

      expect(result).toBeDefined();
      expect(result?.clientName).toBe('TCVV TERMINAL');
      expect(result?.whatsappNumber).toBe('5527981657804');
      expect(result?.clientId).toBe('client-123');
    });

    it('deve retornar null quando empresa não encontrada', async () => {
      const mockAxios = axios as any;

      // Mock da autenticação
      mockAxios.post.mockResolvedValueOnce({
        data: {
          token: 'mock-token-123',
          expires_in: 3600,
        },
      });

      // Mock da busca de empresa (vazia)
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [],
        },
      });

      const result = await getClientWhatsAppNumberFromAcessorias(
        'EMPRESA INEXISTENTE',
        'client-123'
      );

      expect(result).toBeNull();
    });

    it('deve retornar email quando contato não tem telefone', async () => {
      const mockAxios = axios as any;

      // Mock da autenticação
      mockAxios.post.mockResolvedValueOnce({
        data: {
          token: 'mock-token-123',
          expires_in: 3600,
        },
      });

      // Mock da busca de empresa
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'company-123',
              name: 'TCVV TERMINAL',
              email: 'contact@tcvv.com',
            },
          ],
        },
      });

      // Mock da busca de contatos (sem telefone)
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'contact-123',
              name: 'João Silva',
              email: 'joao@tcvv.com',
            },
          ],
        },
      });

      const result = await getClientWhatsAppNumberFromAcessorias(
        'TCVV TERMINAL',
        'client-123'
      );

      expect(result).toBeDefined();
      expect(result?.email).toBe('joao@tcvv.com');
    });

    it('deve formatar número de telefone corretamente', async () => {
      const mockAxios = axios as any;

      // Mock da autenticação
      mockAxios.post.mockResolvedValueOnce({
        data: {
          token: 'mock-token-123',
          expires_in: 3600,
        },
      });

      // Mock da busca de empresa
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'company-123',
              name: 'EMPRESA TESTE',
              email: 'contact@empresa.com',
            },
          ],
        },
      });

      // Mock da busca de contatos com número formatado
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'contact-123',
              name: 'Maria Santos',
              cellphone: '(27) 9 8165-7804',
              phone: '(27) 3322-1234',
            },
          ],
        },
      });

      const result = await getClientWhatsAppNumberFromAcessorias(
        'EMPRESA TESTE',
        'client-123'
      );

      expect(result?.whatsappNumber).toBe('5527981657804');
    });

    it('deve priorizar celular sobre telefone fixo', async () => {
      const mockAxios = axios as any;

      // Mock da autenticação
      mockAxios.post.mockResolvedValueOnce({
        data: {
          token: 'mock-token-123',
          expires_in: 3600,
        },
      });

      // Mock da busca de empresa
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'company-123',
              name: 'EMPRESA TESTE',
              email: 'contact@empresa.com',
            },
          ],
        },
      });

      // Mock da busca de contatos com ambos os números
      mockAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'contact-123',
              name: 'Pedro Costa',
              cellphone: '27987654321',
              phone: '2733221234',
            },
          ],
        },
      });

      const result = await getClientWhatsAppNumberFromAcessorias(
        'EMPRESA TESTE',
        'client-123'
      );

      // Deve usar o celular (primeiro número)
      expect(result?.whatsappNumber).toBe('5527987654321');
    });
  });
});
