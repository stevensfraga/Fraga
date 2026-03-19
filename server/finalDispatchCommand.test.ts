import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runFinalDispatchCommand } from './finalDispatchCommand';

describe('Final Dispatch Command - Ponta-a-Ponta', () => {
  it('deve validar todos os pré-requisitos', async () => {
    const result = await runFinalDispatchCommand();

    // Verificar que o resultado tem estrutura correta
    expect(result).toBeDefined();
    expect(result.prerequisites).toBeDefined();
    expect(Array.isArray(result.prerequisites)).toBe(true);
    expect(result.timestamp).toBeDefined();
  });

  it('deve conter verificações de OAuth', async () => {
    const result = await runFinalDispatchCommand();

    const oauthCheck = result.prerequisites.find((p) => p.name === 'OAuth Conta Azul');
    expect(oauthCheck).toBeDefined();
    expect(oauthCheck?.status).toMatch(/OK|ERRO/);
  });

  it('deve conter verificações de boleto', async () => {
    const result = await runFinalDispatchCommand();

    const boletoCheck = result.prerequisites.find((p) => p.name === 'Boleto OPEN/OVERDUE');
    expect(boletoCheck).toBeDefined();
    expect(boletoCheck?.status).toMatch(/OK|ERRO/);
  });

  it('deve conter verificações de WhatsApp', async () => {
    const result = await runFinalDispatchCommand();

    const whatsappCheck = result.prerequisites.find((p) => p.name === 'Cliente com WhatsApp');
    expect(whatsappCheck).toBeDefined();
    expect(whatsappCheck?.status).toMatch(/OK|ERRO/);
  });

  it('deve conter verificações de Dashboard', async () => {
    const result = await runFinalDispatchCommand();

    const dashboardCheck = result.prerequisites.find((p) => p.name === 'Dashboard');
    expect(dashboardCheck).toBeDefined();
    expect(dashboardCheck?.status).toBe('OK');
  });

  it('deve retornar resultado com estrutura correta', async () => {
    const result = await runFinalDispatchCommand();

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('prerequisites');
    expect(result).toHaveProperty('timestamp');
    expect(typeof result.success).toBe('boolean');
  });

  it('deve incluir mensagem de erro se falhar', async () => {
    const result = await runFinalDispatchCommand();

    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  });

  it('deve incluir detalhes de disparo se sucesso', async () => {
    const result = await runFinalDispatchCommand();

    if (result.success) {
      expect(result.dispatchResult).toBeDefined();
      expect(result.dispatchResult?.boletoId).toBeDefined();
      expect(result.dispatchResult?.clientName).toBeDefined();
      expect(result.dispatchResult?.whatsappNumber).toBeDefined();
      expect(result.dispatchResult?.valor).toBeDefined();
      expect(result.dispatchResult?.vencimento).toBeDefined();
      expect(result.dispatchResult?.messageId).toBeDefined();
    }
  });
});
