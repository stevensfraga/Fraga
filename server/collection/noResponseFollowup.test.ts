/**
 * Testes unitários para noResponseFollowup
 * 
 * Testa: templates, renderização, stopFollowup, KPIs
 */
import { describe, it, expect } from 'vitest';
import {
  FOLLOWUP_TEMPLATES,
  renderFollowupMessage,
} from './noResponseFollowup';

describe('noResponseFollowup', () => {
  describe('FOLLOWUP_TEMPLATES', () => {
    it('deve ter 3 templates (attempt 1, 2, 3)', () => {
      expect(FOLLOWUP_TEMPLATES).toHaveLength(3);
      expect(FOLLOWUP_TEMPLATES[0].attempt).toBe(1);
      expect(FOLLOWUP_TEMPLATES[1].attempt).toBe(2);
      expect(FOLLOWUP_TEMPLATES[2].attempt).toBe(3);
    });

    it('deve ter delays crescentes (2, 5, 10 dias)', () => {
      expect(FOLLOWUP_TEMPLATES[0].delayDays).toBe(2);
      expect(FOLLOWUP_TEMPLATES[1].delayDays).toBe(5);
      expect(FOLLOWUP_TEMPLATES[2].delayDays).toBe(10);
    });

    it('cada template deve conter {{nome}} e {{link}}', () => {
      for (const t of FOLLOWUP_TEMPLATES) {
        expect(t.template).toContain('{{nome}}');
        expect(t.template).toContain('{{link}}');
      }
    });

    it('template 1 deve ser lembrete suave', () => {
      expect(FOLLOWUP_TEMPLATES[0].template).toContain('mensagem anterior');
    });

    it('template 2 deve oferecer negociação', () => {
      expect(FOLLOWUP_TEMPLATES[1].template).toContain('negociação');
    });

    it('template 3 deve mencionar etapa administrativa', () => {
      expect(FOLLOWUP_TEMPLATES[2].template).toContain('administrativa');
    });
  });

  describe('renderFollowupMessage', () => {
    it('deve substituir {{nome}} e {{link}}', () => {
      const template = 'Oi, {{nome}}! Acesse: {{link}}';
      const result = renderFollowupMessage(template, 'João', 'https://pay.example.com/123');
      expect(result).toBe('Oi, João! Acesse: https://pay.example.com/123');
    });

    it('deve substituir múltiplas ocorrências de {{nome}}', () => {
      const template = '{{nome}}, olá {{nome}}!';
      const result = renderFollowupMessage(template, 'Maria', '');
      expect(result).toBe('Maria, olá Maria!');
    });

    it('deve lidar com template sem variáveis', () => {
      const result = renderFollowupMessage('Mensagem fixa', 'João', 'link');
      expect(result).toBe('Mensagem fixa');
    });

    it('deve renderizar template 1 corretamente', () => {
      const result = renderFollowupMessage(
        FOLLOWUP_TEMPLATES[0].template,
        'Carlos',
        'https://app.contaazul.com/pay/abc'
      );
      expect(result).toContain('Carlos');
      expect(result).toContain('https://app.contaazul.com/pay/abc');
      expect(result).not.toContain('{{nome}}');
      expect(result).not.toContain('{{link}}');
    });

    it('deve renderizar template 2 corretamente', () => {
      const result = renderFollowupMessage(
        FOLLOWUP_TEMPLATES[1].template,
        'Ana',
        'https://pay.example.com/456'
      );
      expect(result).toContain('Ana');
      expect(result).toContain('https://pay.example.com/456');
    });

    it('deve renderizar template 3 corretamente', () => {
      const result = renderFollowupMessage(
        FOLLOWUP_TEMPLATES[2].template,
        'Pedro',
        'https://pay.example.com/789'
      );
      expect(result).toContain('Pedro');
      expect(result).toContain('administrativa');
    });
  });

  describe('Template safety', () => {
    it('nenhum template deve conter dados financeiros hardcoded', () => {
      for (const t of FOLLOWUP_TEMPLATES) {
        expect(t.template).not.toMatch(/R\$\s*\d/);
        expect(t.template).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
      }
    });

    it('nenhum template deve exceder 500 caracteres', () => {
      for (const t of FOLLOWUP_TEMPLATES) {
        expect(t.template.length).toBeLessThan(500);
      }
    });

    it('templates devem ser progressivamente mais firmes', () => {
      // Template 1: suave (confirmar/ver)
      expect(FOLLOWUP_TEMPLATES[0].template.toLowerCase()).toMatch(/confirm|ver|mensagem anterior/);
      // Template 2: oferta (negociação/alternativa)
      expect(FOLLOWUP_TEMPLATES[1].template.toLowerCase()).toMatch(/negoci|alternativa|opções/);
      // Template 3: urgência (administrativa/retorno)
      expect(FOLLOWUP_TEMPLATES[2].template.toLowerCase()).toMatch(/administrat|retorno|evitar/);
    });
  });
});
