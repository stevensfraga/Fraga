import { Router, Request, Response } from 'express';
import { getValidAccessToken, getAuthorizationUrl, saveToken, exchangeCodeForToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import crypto from 'crypto';

const router = Router();

/**
 * GET /api/oauth/auth-url
 * Gera URL de autorização OAuth com state dinâmico
 */
router.get('/auth-url', async (req: Request, res: Response) => {
  try {
    // Gerar state aleatório para CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Salvar state em sessão ou cache (simplificado: usando memória)
    // Em produção, usar Redis ou banco de dados com TTL
    (global as any).oauthStates = (global as any).oauthStates || {};
    (global as any).oauthStates[state] = {
      timestamp: Date.now(),
      ttl: 10 * 60 * 1000, // 10 minutos
    };

    const authUrl = getAuthorizationUrl(state);

    res.json({
      success: true,
      authUrl,
      url: authUrl, // Alias para compatibilidade
      state,
      expiresIn: 600, // 10 minutos
    });
  } catch (error: any) {
    console.error('[OAuth Management] Erro ao gerar auth-url:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/oauth/token-status
 * Retorna status do token atual
 */
router.get('/token-status', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    // Buscar token mais recente
    const tokens = await db.select().from(contaAzulTokens).limit(1);

    if (!tokens || tokens.length === 0) {
      return res.json({
        hasToken: false,
        isExpired: true,
      });
    }

    const token = tokens[0];
    const now = new Date();
    const expiresAt = new Date(token.expiresAt);
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    const minutesUntilExpiry = Math.round(timeUntilExpiry / 60000);
    const isExpired = timeUntilExpiry < 0;

    res.json({
      hasToken: true,
      isExpired,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      minutesUntilExpiry: Math.max(0, minutesUntilExpiry),
      timeUntilExpiryMs: Math.max(0, timeUntilExpiry),
    });
  } catch (error: any) {
    console.error('[OAuth Management] Erro ao obter token-status:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/oauth/refresh-token
 * Renova o token manualmente
 */
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    // Buscar token atual
    const tokens = await db.select().from(contaAzulTokens).limit(1);
    if (!tokens || tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No token found. Please authorize first.',
      });
    }

    const token = tokens[0];

    // Tentar renovar
    try {
      const newTokenData = await exchangeCodeForToken(token.refreshToken);
      await saveToken(
        newTokenData.access_token,
        newTokenData.refresh_token,
        newTokenData.expires_in,
        token.userId || undefined
      );

      res.json({
        success: true,
        message: 'Token renovado com sucesso',
        expiresIn: newTokenData.expires_in,
      });
    } catch (refreshError: any) {
      console.error('[OAuth Management] Erro ao renovar token:', refreshError.message);
      res.status(400).json({
        success: false,
        error: 'Falha ao renovar token. Faça login novamente.',
        details: refreshError.message,
      });
    }
  } catch (error: any) {
    console.error('[OAuth Management] Erro ao fazer refresh:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/oauth/callback
 * Callback de autorização OAuth
 * Recebe authorization_code e troca por access_token
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;

    console.log('[OAuth Callback] Recebido callback');
    console.log('[OAuth Callback] code:', code ? String(code).substring(0, 12) + '...' : 'undefined');
    console.log('[OAuth Callback] state:', state);
    console.log('[OAuth Callback] error:', error);

    // Validar se houve erro na autorização
    if (error) {
      console.error('[OAuth Callback] ERRO na autorização:', error, error_description);
      return res.status(400).json({
        success: false,
        error: String(error),
        message: String(error_description),
      });
    }

    // Validar code
    if (!code) {
      console.error('[OAuth Callback] Code não recebido');
      return res.status(400).json({
        success: false,
        error: 'MISSING_CODE',
        message: 'Authorization code não foi recebido',
      });
    }

    // Validar state (anti-CSRF)
    if (!state) {
      console.error('[OAuth Callback] State não recebido');
      return res.status(400).json({
        success: false,
        error: 'MISSING_STATE',
        message: 'State não foi recebido',
      });
    }

    // Verificar se state é válido (salvo em memória)
    const oauthStates = (global as any).oauthStates || {};
    const stateData = oauthStates[String(state)];

    if (!stateData) {
      console.error('[OAuth Callback] State inválido ou expirado:', state);
      return res.status(400).json({
        success: false,
        error: 'INVALID_STATE',
        message: 'State inválido ou expirado',
      });
    }

    // Verificar se state expirou (TTL 10 minutos)
    if (Date.now() - stateData.timestamp > stateData.ttl) {
      console.error('[OAuth Callback] State expirado');
      delete oauthStates[String(state)];
      return res.status(400).json({
        success: false,
        error: 'STATE_EXPIRED',
        message: 'State expirado',
      });
    }

    // Trocar code por access_token
    console.log('[OAuth Callback] Trocando code por access_token...');
    const tokenData = await exchangeCodeForToken(String(code));

    // Salvar token no banco
    await saveToken(
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_in
    );

    // Limpar state
    delete oauthStates[String(state)];

    console.log('[OAuth Callback] ✅ Token salvo com sucesso');

    // Retornar sucesso com HTML
    const successHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Autorização Bem-sucedida</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
          }
          h1 {
            color: #333;
            margin: 0 0 10px 0;
          }
          .success {
            color: #10b981;
            font-size: 48px;
            margin: 20px 0;
          }
          p {
            color: #666;
            margin: 10px 0;
            font-size: 14px;
          }
          .info {
            background: #f0f9ff;
            border: 1px solid #bfdbfe;
            border-radius: 4px;
            padding: 12px;
            margin: 20px 0;
            font-size: 13px;
            color: #1e40af;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            text-decoration: none;
            margin-top: 20px;
            font-weight: 600;
          }
          .button:hover {
            background: #5568d3;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Autorização Bem-sucedida! ✅</h1>
          <div class="success">✓</div>
          <p><strong>Token salvo com sucesso</strong></p>
          <div class="info">
            <p>Sua autorização foi concluída. O sistema agora tem acesso aos dados do Conta Azul.</p>
            <p>Token será renovado automaticamente antes de expirar.</p>
          </div>
          <p>Você pode fechar esta aba e voltar ao dashboard.</p>
          <a href="/" class="button">Voltar ao Dashboard</a>
        </div>
        <script>
          // Fechar aba após 3 segundos
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `;

    res.type('text/html').send(successHtml);
  } catch (error: any) {
    console.error('[OAuth Callback] ❌ Erro:', error.message);

    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erro de Autorização</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
          }
          h1 {
            color: #333;
            margin: 0 0 10px 0;
          }
          .error {
            color: #dc2626;
            font-size: 48px;
            margin: 20px 0;
          }
          p {
            color: #666;
            margin: 10px 0;
            font-size: 14px;
          }
          .details {
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 4px;
            padding: 12px;
            margin: 20px 0;
            font-size: 12px;
            color: #991b1b;
            text-align: left;
            word-break: break-all;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            text-decoration: none;
            margin-top: 20px;
            font-weight: 600;
          }
          .button:hover {
            background: #5568d3;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Erro de Autorização</h1>
          <div class="error">❌</div>
          <p><strong>Falha ao autorizar</strong></p>
          <div class="details">${error.message}</div>
          <p>Por favor, tente novamente ou entre em contato com o suporte.</p>
          <a href="/" class="button">Voltar</a>
        </div>
      </body>
      </html>
    `;

    res.status(400).type('text/html').send(errorHtml);
  }
});

/**
 * GET /api/oauth/clear-token
 * Remove token (logout)
 */
router.get('/clear-token', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
      });
    }

    await db.execute('DELETE FROM contaAzulTokens');

    res.json({
      success: true,
      message: 'Token removido com sucesso',
    });
  } catch (error: any) {
    console.error('[OAuth Management] Erro ao remover token:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
