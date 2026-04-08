import { describe, it, expect } from 'vitest';

describe('OAuth Credentials Validation', () => {
  it('should have valid CLIENT_ID and CLIENT_SECRET configured', () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;

    expect(clientId).toBeDefined();
    expect(clientSecret).toBeDefined();
    expect(clientId).toHaveLength(26); // Conta Azul CLIENT_ID format
    expect(clientSecret).toHaveLength(42); // Conta Azul CLIENT_SECRET format
  });

  it('should be able to call token endpoint with correct format', async () => {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
    const redirectUri = 'https://dashboard.fragacontabilidade.com.br/oauth/conta-azul/callback';

    const tokenPayload = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'invalid-code-for-testing',
      client_id: clientId || '',
      client_secret: clientSecret || '',
      redirect_uri: redirectUri
    });

    const response = await fetch('https://api.contaazul.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenPayload.toString()
    });

    // Expect JSON response (not HTML error page)
    const contentType = response.headers.get('content-type');
    expect(contentType).toContain('application/json');

    // Parse response
    const data = await response.json();
    
    // Should have error field (since code is invalid)
    expect(data).toHaveProperty('error');
    
    // Should NOT be "invalid_client" (which means credentials are wrong)
    // Valid credentials should return "invalid_grant" or "invalid_code" error
    console.log('Token endpoint response:', data);
    
    if (data.error === 'invalid_client') {
      throw new Error(`Invalid client credentials: ${data.error_description}`);
    }

    // If we got here, credentials are valid (even if the code is invalid)
    expect(data.error).toBeDefined();
  });
});
