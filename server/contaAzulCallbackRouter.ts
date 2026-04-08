import { Router } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';

const router = Router();

/**
 * OAuth 2.0 Callback Handler para Conta Azul
 * Recebe authorization code, troca por access_token e salva no banco
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    console.log('[ContaAzulCallback] Recebido callback');
    console.log('[ContaAzulCallback] ===== DIAGNOSTICO CALLBACK ====');
    console.log('[ContaAzulCallback] codeReceived:', code ? String(code).substring(0, 12) + '...' : 'undefined');
    console.log('[ContaAzulCallback] stateReceived:', state);
    console.log('[ContaAzulCallback] error:', error);
    console.log('[ContaAzulCallback] error_description:', error_description);
    console.log('[ContaAzulCallback] ===== FIM DIAGNOSTICO ====');

    // Validar se houve erro na autorização
    if (error) {
      console.error('[ContaAzulCallback] ERRO na autorização:', error, error_description);
      return res.status(400).json({
        success: false,
        error: String(error),
        message: String(error_description),
      });
    }

    // Validar state (anti-CSRF)
    if (!state || state === 'ESTADO') {
      console.error('[ContaAzulCallback] State inválido:', state);
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Erro de Autorização</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
            .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
            h1 { color: #333; margin: 0 0 10px 0; }
            .error { color: #dc2626; font-size: 48px; margin: 20px 0; }
            p { color: #666; margin: 10px 0; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Erro de Autorização</h1>
            <div class="error">❌</div>
            <p><strong>State inválido ou expirado</strong></p>
            <p>Por favor, tente novamente gerando uma nova URL de autorização.</p>
          </div>
        </body>
        </html>
      `;
      return res.status(400).type('text/html').send(errorHtml);
    }

    // Validar se recebeu o code
    if (!code) {
      console.error('[ContaAzulCallback] Code não recebido');
      return res.status(400).json({
        success: false,
        error: 'MISSING_CODE',
        message: 'Authorization code não foi recebido',
      });
    }

    // Configuração OAuth
    const clientId = process.env.CONTA_AZUL_CLIENT_ID || '6gsibk3vp3fd4lk4m70hb39vf3';
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET || '1eckb5tl92dq7udsdjmi2i97m471c6h0ab8e2tk26mehb7qcpkb8';
    const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI || 'https://dashboard.fragacontabilidade.com.br/api/callback';
    const tokenUrl = 'https://auth.contaazul.com/oauth2/token';

    console.log('[ContaAzulCallback] redirectUriUsedInTokenExchange:', redirectUri);

    // Criar Basic Auth header
    const credentials = `${clientId}:${clientSecret}`;
    const b64 = Buffer.from(credentials).toString('base64');
    const basicAuth = `Basic ${b64}`;

    console.log('[ContaAzulCallback] Trocando code por access_token...');

    // Trocar code por access_token
    const tokenResponse = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          'Authorization': basicAuth,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    const tokenData = tokenResponse.data;
    console.log('[ContaAzulCallback] ✅ Token recebido');
    console.log('[ContaAzulCallback] access_token (últimos 6):', tokenData.access_token.substring(tokenData.access_token.length - 6));
    console.log('[ContaAzulCallback] expires_in:', tokenData.expires_in);

    // Salvar no banco de dados
    console.log('[ContaAzulCallback] Salvando token no banco...');

    const db = await getDb();
    if (!db) {
      throw new Error('Database connection failed');
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Inserir ou atualizar token para userId 1 (admin/default)
    // TODO: Extrair userId do token JWT ou da sessão
    const userId = 1; // Default para agora

    await db
      .insert(contaAzulTokens)
      .values({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    console.log('[ContaAzulCallback] ✅ Token salvo no banco');
    console.log('[ContaAzulCallback] userId: 1');
    console.log('[ContaAzulCallback] expiresAt:', expiresAt.toISOString());
    console.log('[ContaAzulCallback] scope:', 'customers:read receivables:read');
    console.log('[ContaAzulCallback] token_type:', tokenData.token_type);

    // Redirecionar para página de sucesso
    const successHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conta Azul Conectado</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
          .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
          h1 { color: #333; margin: 0 0 10px 0; }
          .success { color: #10b981; font-size: 48px; margin: 20px 0; }
          p { color: #666; margin: 10px 0; font-size: 14px; }
          .details { background: #f3f4f6; padding: 15px; border-radius: 4px; margin: 20px 0; text-align: left; font-size: 12px; color: #555; }
          .redirect { color: #667eea; margin-top: 20px; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Conta Azul Conectado</h1>
          <div class="success">✅</div>
          <p>Sua integração com Conta Azul foi autorizada com sucesso!</p>
          <div class="details">
            <strong>Informações do Token:</strong><br>
            Expires at: ${expiresAt.toISOString()}<br>
            Scope: customers:read receivables:read<br>
            Client ID: 30004
          </div>
          <p class="redirect">Redirecionando em 3 segundos...</p>
          <script>
            setTimeout(() => {
              window.location.href = '/integrations/conta-azul?connected=1';
            }, 3000);
          </script>
        </div>
      </body>
      </html>
    `;
    return res.status(200).type('text/html').send(successHtml);
  } catch (error: any) {
    console.error('[ContaAzulCallback] ❌ ERRO:', error.message);
    console.error('[ContaAzulCallback] Status:', error.response?.status);
    console.error('[ContaAzulCallback] Details:', error.response?.data);
    console.error('[ContaAzulCallback] Full error.response.data:', JSON.stringify(error.response?.data, null, 2));

    const { code, state } = req.query;

    // Página de diagnóstico com estado esperado vs recebido
    const diagnosticHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erro no Callback OAuth</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
          .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); text-align: left; max-width: 600px; }
          h1 { color: #dc2626; margin: 0 0 20px 0; }
          .error-box { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 15px 0; border-radius: 4px; }
          .error-box strong { color: #991b1b; }
          .error-box p { margin: 5px 0; color: #7f1d1d; font-size: 14px; }
          .code { background: #f3f4f6; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; word-break: break-all; margin: 10px 0; }
          .diagnostic { background: #f9fafb; border: 1px solid #e5e7eb; padding: 15px; border-radius: 4px; margin: 15px 0; }
          .diagnostic-row { display: flex; margin: 8px 0; }
          .diagnostic-label { font-weight: bold; width: 200px; color: #374151; }
          .diagnostic-value { flex: 1; color: #6b7280; font-family: monospace; font-size: 12px; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Erro no Callback OAuth</h1>
          <div class="error-box">
            <strong>Erro:</strong>
            <p>${error.response?.data?.error || 'TOKEN_EXCHANGE_FAILED'}</p>
            <strong>Mensagem:</strong>
            <p>${error.message}</p>
          </div>
          <div class="diagnostic">
            <strong>Diagnostico:</strong>
            <div class="diagnostic-row">
              <div class="diagnostic-label">Code Recebido:</div>
              <div class="diagnostic-value">${code ? String(code).substring(0, 12) + '...' : 'undefined'}</div>
            </div>
            <div class="diagnostic-row">
              <div class="diagnostic-label">State Recebido:</div>
              <div class="diagnostic-value">${state || 'undefined'}</div>
            </div>
            <div class="diagnostic-row">
              <div class="diagnostic-label">Redirect URI Usado:</div>
              <div class="diagnostic-value">${process.env.CONTA_AZUL_REDIRECT_URI || 'https://dashboard.fragacontabilidade.com.br/api/callback'}</div>
            </div>
            <div class="diagnostic-row">
              <div class="diagnostic-label">Status HTTP:</div>
              <div class="diagnostic-value">${error.response?.status || 'N/A'}</div>
            </div>
          </div>
          <div class="error-box">
            <strong>Detalhes da Resposta:</strong>
            <div class="code">${JSON.stringify(error.response?.data, null, 2)}</div>
          </div>
        </div>
      </body>
      </html>
    `;
    return res.status(500).type('text/html').send(diagnosticHtml);
  }
});

export default router;
