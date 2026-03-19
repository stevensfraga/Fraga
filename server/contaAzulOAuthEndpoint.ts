import { Router } from 'express';

const router = Router();

// Armazenar tokens em memória (em produção, usar banco de dados)
// ⚠️ DEPRECATED: Use contaAzulOAuthManager.ts para gerenciar tokens
let cachedToken: any = null;

/**
 * GET /oauth/conta-azul/authorize
 * Redireciona para o Conta Azul para autorização
 */
router.get('/oauth/conta-azul/authorize', (req, res) => {
  const state = Math.random().toString(36).substring(7);
  
  // Obter domínio dinamicamente do header Host
  // Forçar HTTPS em produção (sandbox sempre usa HTTPS)
  const protocol = 'https';
  const host = req.get('host') || 'localhost:3000';
  const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI || `${protocol}://${host}/api/oauth/conta-azul/callback`;
  
  // Construir URL de autorização OAuth
  // Endpoint correto: https://api.contaazul.com/oauth2/authorize
  // Parâmetros OBRIGATÓRIOS: response_type, client_id, redirect_uri, scope, state
  const authUrl = new URL('https://api.contaazul.com/oauth2/authorize');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', process.env.CONTA_AZUL_CLIENT_ID || '');
  authUrl.searchParams.append('redirect_uri', redirectUri);
  // Scope OBRIGATÓRIO - especifica quais permissões a aplicação solicita
  // Escopos válidos do Conta Azul: customers:read (ler clientes), receivables:read (ler recebíveis)
  authUrl.searchParams.append('scope', 'customers:read receivables:read');
  authUrl.searchParams.append('state', state);

  res.redirect(authUrl.toString());
});

// ⚠️ CALLBACK REMOVIDO: Use handleContaAzulCallback em server/_core/index.ts em vez disso
// O callback está registrado em /api/callback e /api/oauth/conta-azul/callback
// e usa exchangeCodeForToken() do contaAzulOAuthManager.ts

/**
 * GET /api/conta-azul/token
 * Retorna o token de acesso válido (renova se necessário)
 */
router.get('/api/conta-azul/token', async (req, res) => {
  try {
    // Se não há token ou expirou, retornar erro
    if (!cachedToken || Date.now() >= cachedToken.expiresAt) {
      return res.status(401).json({ 
        error: 'Token expirado ou não autorizado',
        authUrl: '/oauth/conta-azul/authorize',
      });
    }

    res.json({ 
      accessToken: cachedToken.accessToken,
      expiresAt: cachedToken.expiresAt,
    });
  } catch (error) {
    console.error('[Token] Erro:', error);
    res.status(500).json({ error: 'Erro ao obter token' });
  }
});

/**
 * GET /api/conta-azul/boletos
 * Busca boletos do Conta Azul
 */
router.get('/api/conta-azul/boletos', async (req, res) => {
  try {
    if (!cachedToken || Date.now() >= cachedToken.expiresAt) {
      return res.status(401).json({ 
        error: 'Não autorizado. Faça login primeiro.',
        authUrl: '/oauth/conta-azul/authorize',
      });
    }

    const boletoResponse = await fetch('https://api.contaazul.com/v1/contas_receber', {
      headers: {
        'Authorization': `Bearer ${cachedToken.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const boletoData = await boletoResponse.json();

    if (!boletoResponse.ok) {
      throw new Error(`Erro ao buscar boletos: ${boletoData.message || boletoResponse.statusText}`);
    }

    res.json(boletoData);
  } catch (error) {
    console.error('[Boletos] Erro:', error);
    res.status(500).json({ error: `Erro ao buscar boletos: ${error instanceof Error ? error.message : 'Desconhecido'}` });
  }
});

export default router;
