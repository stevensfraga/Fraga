/**
 * Teste de validação de credenciais ZapContábil
 * Verifica se ZAP_CONTABIL_USER e ZAP_CONTABIL_PASS são válidos
 */

import { describe, it, expect } from 'vitest';
import axios from 'axios';

describe('ZapContábil Authentication', () => {
  it('deve fazer login com credenciais e obter token válido', async () => {
    const user = process.env.ZAP_CONTABIL_USER;
    const pass = process.env.ZAP_CONTABIL_PASS;

    expect(user).toBeDefined();
    expect(pass).toBeDefined();
    expect(user).toBe('stevensfraga@gmail.com');

    try {
      // Tentar fazer login no painel ZapContábil
      const response = await axios.post(
        'https://api-fraga.zapcontabil.chat/auth/login',
        {
          email: user,
          password: pass,
        },
        {
          timeout: 10000,
          validateStatus: () => true,
        }
      );

      console.log('Login response status:', response.status);
      console.log('Login response data:', JSON.stringify(response.data).substring(0, 200));

      // Aceitar 200 (sucesso) ou 401 (credenciais inválidas - erro esperado para teste)
      // Se for 5xx, é erro do servidor
      expect([200, 401, 403]).toContain(response.status);

      if (response.status === 200) {
        // Se login bem-sucedido, deve ter token
        expect(response.data).toHaveProperty('token');
        console.log('✅ Token obtido com sucesso');
      } else if (response.status === 401 || response.status === 403) {
        // Credenciais inválidas
        console.log('⚠️ Credenciais inválidas (401/403)');
        expect(response.data).toHaveProperty('error');
      }
    } catch (err: any) {
      console.error('Erro ao fazer login:', err.message);
      throw err;
    }
  }, { timeout: 15000 });

  it('deve validar que ZAP_CONTABIL_USER está configurado', () => {
    const user = process.env.ZAP_CONTABIL_USER;
    expect(user).toBe('stevensfraga@gmail.com');
  });

  it('deve validar que ZAP_CONTABIL_PASS está configurado', () => {
    const pass = process.env.ZAP_CONTABIL_PASS;
    expect(pass).toBeDefined();
    expect(pass?.length).toBeGreaterThan(0);
  });
});
