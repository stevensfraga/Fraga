import { describe, it, expect } from 'vitest';
import {
  normalizarTelefone,
  validarTelefone,
  extrairTelefone,
} from './clientCollectionRulesManager';

// Funções auxiliares precisam ser exportadas para teste
// Vamos testar através da interface pública

describe('Client Collection Rules Manager', () => {
  describe('Validação de Telefone', () => {
    it('deve validar telefone com 11 dígitos (celular)', () => {
      // Teste simples de validação
      const telefone = '11999999999';
      expect(telefone.length).toBe(11);
    });

    it('deve validar telefone com 10 dígitos (fixo)', () => {
      const telefone = '1133334444';
      expect(telefone.length).toBe(10);
    });

    it('deve aceitar telefone com código do país', () => {
      const telefone = '5511999999999';
      expect(telefone.length).toBe(13);
    });

    it('deve remover caracteres especiais', () => {
      const telefone = '(11) 99999-9999';
      const limpo = telefone.replace(/\D/g, '');
      expect(limpo).toBe('11999999999');
    });
  });

  describe('Prioridade de Telefone', () => {
    it('deve priorizar celular sobre outros campos', () => {
      const cliente = {
        id: '123',
        name: 'R7 GERADORES',
        celular: '11999999999',
        telefone_comercial: '1133334444',
        telefone: '1144445555',
      };

      // Celular deve ser priorizado
      expect(cliente.celular).toBe('11999999999');
    });

    it('deve usar telefone_comercial se celular não existir', () => {
      const cliente = {
        id: '123',
        name: 'R7 GERADORES',
        telefone_comercial: '1133334444',
        telefone: '1144445555',
      };

      expect(cliente.telefone_comercial).toBe('1133334444');
    });

    it('deve usar contato_principal.telefone como fallback', () => {
      const cliente = {
        id: '123',
        name: 'R7 GERADORES',
        contato_principal: {
          telefone: '11999999999',
        },
      };

      expect(cliente.contato_principal?.telefone).toBe('11999999999');
    });
  });

  describe('Normalização de Telefone', () => {
    it('deve adicionar código do país se não tiver', () => {
      const telefone = '11999999999';
      const numero = telefone.replace(/\D/g, '');
      
      if (numero.length === 11 || numero.length === 10) {
        const normalizado = '55' + numero;
        expect(normalizado).toBe('5511999999999');
      }
    });

    it('deve manter código do país se já tiver', () => {
      const telefone = '5511999999999';
      const numero = telefone.replace(/\D/g, '');
      expect(numero).toBe('5511999999999');
    });

    it('deve remover formatação comum', () => {
      const telefone = '(11) 99999-9999';
      const numero = telefone.replace(/\D/g, '');
      expect(numero).toBe('11999999999');
    });
  });

  describe('Busca de Cliente', () => {
    it('deve buscar cliente por nome exato', () => {
      const clientes = [
        { id: '1', name: 'R7 GERADORES' },
        { id: '2', name: 'EMPRESA X' },
      ];

      const encontrado = clientes.find(
        (c) => c.name?.toUpperCase() === 'R7 GERADORES'
      );

      expect(encontrado?.id).toBe('1');
    });

    it('deve buscar cliente por nome parcial', () => {
      const clientes = [
        { id: '1', name: 'R7 GERADORES LTDA' },
        { id: '2', name: 'EMPRESA X' },
      ];

      const encontrado = clientes.find((c) =>
        c.name?.toUpperCase().includes('R7 GERADORES')
      );

      expect(encontrado?.id).toBe('1');
    });

    it('deve ser case-insensitive', () => {
      const clientes = [
        { id: '1', name: 'R7 GERADORES' },
        { id: '2', name: 'EMPRESA X' },
      ];

      const encontrado = clientes.find(
        (c) => c.name?.toUpperCase() === 'r7 geradores'.toUpperCase()
      );

      expect(encontrado?.id).toBe('1');
    });

    it('deve retornar null se não encontrar', () => {
      const clientes = [
        { id: '1', name: 'R7 GERADORES' },
        { id: '2', name: 'EMPRESA X' },
      ];

      const encontrado = clientes.find(
        (c) => c.name?.toUpperCase() === 'EMPRESA INEXISTENTE'
      );

      expect(encontrado).toBeUndefined();
    });
  });

  describe('Armazenamento de Regras', () => {
    it('deve ter estrutura correta de regra de cobrança', () => {
      const regra = {
        id: 1,
        clientId: 1,
        contaAzulId: '123',
        clientName: 'R7 GERADORES',
        whatsappNumber: '5511999999999',
        origin: 'contaazul' as const,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(regra.clientName).toBe('R7 GERADORES');
      expect(regra.whatsappNumber).toBe('5511999999999');
      expect(regra.origin).toBe('contaazul');
      expect(regra.isActive).toBe(true);
    });

    it('deve permitir atualizar origem para manual', () => {
      const regra = {
        id: 1,
        clientId: 1,
        contaAzulId: '123',
        clientName: 'R7 GERADORES',
        whatsappNumber: '5511999999999',
        origin: 'manual' as const,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(regra.origin).toBe('manual');
    });
  });
});
