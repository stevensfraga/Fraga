import { describe, it, expect } from 'vitest';
import axios from 'axios';

describe('Conta Azul OAuth Credentials', () => {
  it('should have valid client credentials', () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
    const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI;

    expect(clientId).toBeDefined();
    expect(clientSecret).toBeDefined();
    expect(redirectUri).toBeDefined();
    expect(clientId).toBe('257avpstqjjkr4vtl3c5simi5j');
    expect(redirectUri).toContain('/api/callback');
  });

  it('should generate valid Basic Auth header', () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing credentials');
    }

    const credentials = `${clientId}:${clientSecret}`;
    const b64 = Buffer.from(credentials).toString('base64');
    const header = `Basic ${b64}`;

    expect(header).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    expect(header.length).toBeGreaterThan(10);
  });

  it('should validate authorization URL format', () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error('Missing credentials');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: 'ESTADO',
      scope: 'openid profile aws.cognito.signin.user.admin',
    });

    const authUrl = `https://auth.contaazul.com/login?${params.toString()}`;

    expect(authUrl).toContain('response_type=code');
    expect(authUrl).toContain(`client_id=${clientId}`);
    expect(authUrl).toContain('state=ESTADO');
    expect(authUrl).toContain('scope=openid');
  });
});
