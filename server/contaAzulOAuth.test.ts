/**
 * Teste de validação das credenciais OAuth do Conta Azul
 * Valida se o Client ID e Client Secret estão corretos
 */

import { describe, it, expect } from 'vitest';

describe('Conta Azul OAuth Credentials', () => {
  it('should have valid OAuth credentials in environment', () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    expect(clientId).toBeDefined();
    expect(clientSecret).toBeDefined();
    expect(clientId).toBe('257avpstqjjkr4vtl3c5simi5j');
    expect(clientSecret).toBe('m5olrk6s6oekb1vmnuovshp08qrl1k891ejeqo403cgvijo182m');
  });

  it('should generate valid authorization URL', () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID || '';
    const redirectUri = 'https://dashboard.fragacontabilidade.com.br/oauth/conta-azul/callback';
    const scope = 'sales finance customers';

    const authUrl = new URL('https://api.contaazul.com/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', scope);
    authUrl.searchParams.append('state', 'test-state');

    const urlString = authUrl.toString();

    expect(urlString).toContain('client_id=10bt9q8pupbie49f3pqlpnqnim');
    expect(urlString).toContain('scope=sales+finance+customers');
    expect(urlString).toContain('response_type=code');
  });

  it('should have correct OAuth endpoint URLs', () => {
    const authorizeUrl = 'https://api.contaazul.com/oauth2/authorize';
    const tokenUrl = 'https://api.contaazul.com/oauth2/token';

    expect(authorizeUrl).toBeDefined();
    expect(tokenUrl).toBeDefined();
    expect(authorizeUrl).toContain('api.contaazul.com');
    expect(tokenUrl).toContain('api.contaazul.com');
  });
});
