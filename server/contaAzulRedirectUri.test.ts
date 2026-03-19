/**
 * Test to validate Conta Azul Redirect URI configuration
 */

import { describe, it, expect } from 'vitest';

describe('Conta Azul Redirect URI Configuration', () => {
  it('should have valid redirect URI in environment', () => {
    const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI;
    
    expect(redirectUri).toBeDefined();
    expect(redirectUri).toMatch(/^https:\/\//);
    expect(redirectUri).toContain('/oauth/conta-azul/callback');
  });

  it('should have correct domain format', () => {
    const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI;
    
    // Should be a valid URL
    expect(() => new URL(redirectUri!)).not.toThrow();
    
    // Should contain manus.computer domain
    expect(redirectUri).toContain('manus.computer');
  });

  it('should match OAuth callback path', () => {
    const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI;
    
    // Extract path from URL
    const url = new URL(redirectUri!);
    expect(url.pathname).toBe('/oauth/conta-azul/callback');
  });
});
