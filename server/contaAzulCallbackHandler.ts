/**
 * Handler para processar callback OAuth do Conta Azul
 * Troca o authorization code por access_token e salva no banco de dados
 * 
 * Recebe: GET /api/callback?code=...&state=...
 * 
 * IMPORTANTE: redirect_uri DEVE ser /api/callback (NÃO /api/oauth/callback)
 * porque /api/oauth/callback é interceptado pelo Manus OAuth.
 */

import { Request, Response } from 'express';
import { exchangeCodeForToken, saveToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { validateAndConsumeState } from './contaAzulAuthUrlRouter';
import { resetReauthFlag } from './contaAzulTokenRefreshCron';

// Track consumed codes to prevent replay (in-memory, resets on restart)
const consumedCodes = new Set<string>();

// Limpar codes antigos a cada 10 minutos (manter últimos 100)
setInterval(() => {
  if (consumedCodes.size > 100) {
    const arr = Array.from(consumedCodes);
    arr.slice(0, arr.length - 100).forEach(c => consumedCodes.delete(c));
  }
}, 10 * 60 * 1000);

/**
 * Redirect URI FIXO — DEVE ser /api/oauth/callback
 * Este é o URI cadastrado no app OAuth do Conta Azul no painel deles.
 * Agora interceptamos /api/oauth/callback ANTES do Manus OAuth (ver index.ts),
 * detectando pelo state hex de 64 chars.
 */
const FIXED_REDIRECT_URI = process.env.CONTA_AZUL_REDIRECT_URI ;

/**
 * Gerar página HTML de resultado (sucesso ou erro)
 */
function renderResultPage(success: boolean, title: string, message: string, details?: string): string {
  const color = success ? '#16a34a' : '#dc2626';
  const icon = success ? '✅' : '❌';
  const bgColor = success ? '#f0fdf4' : '#fef2f2';
  const borderColor = success ? '#bbf7d0' : '#fecaca';
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Fraga Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,.1); max-width: 480px; width: 100%; padding: 32px; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; color: #1e293b; margin-bottom: 8px; }
    .message { font-size: 14px; color: #64748b; margin-bottom: 16px; line-height: 1.5; }
    .details { background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 12px; font-size: 12px; color: ${color}; margin-bottom: 16px; text-align: left; word-break: break-all; }
    .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; text-decoration: none; cursor: pointer; border: none; transition: all .15s; }
    .btn-primary { background: #1e40af; color: white; }
    .btn-primary:hover { background: #1e3a8a; }
    .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .btn-secondary:hover { background: #e2e8f0; }
    .countdown { font-size: 12px; color: #94a3b8; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    ${details ? `<div class="details">${details}</div>` : ''}
    <div class="actions">
      ${success 
        ? `<a href="/" class="btn btn-primary">Ir para o Dashboard</a>`
        : `<a href="/" class="btn btn-primary">Voltar ao Dashboard</a>
           <button onclick="window.close()" class="btn btn-secondary">Fechar aba</button>`
      }
    </div>
    ${success ? '<p class="countdown" id="cd">Redirecionando em 5 segundos...</p><script>let s=5;const i=setInterval(()=>{s--;document.getElementById("cd").textContent="Redirecionando em "+s+" segundos...";if(s<=0){clearInterval(i);window.location.href="/?oauth=success";}},1000);</script>' : ''}
  </div>
</body>
</html>`;
}

/**
 * Processar callback OAuth do Conta Azul
 * GET /api/callback?code=...&state=...
 */
export async function handleContaAzulCallback(req: Request, res: Response) {
  const timestamp = new Date().toISOString();
  
  try {
    // ─── LOG: Callback recebido ───────────────────────────────────────
    console.log('[OAuth] ═══════════════════════════════════════════');
    console.log('[OAuth] CALLBACK_RECEIVED');
    console.log('[OAuth] timestamp:', timestamp);
    console.log('[OAuth] path:', req.path);
    console.log('[OAuth] URL completa:', req.url);
    console.log('[OAuth] Query params:', JSON.stringify(req.query));
    console.log('[OAuth] User-Agent:', req.headers['user-agent']?.substring(0, 80));
    
    // Ler params do querystring
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;
    const error_description = req.query.error_description as string | undefined;

    // ─── Erro do provider ─────────────────────────────────────────────
    if (error) {
      console.error('[OAuth Callback] PROVIDER_ERROR:', error, error_description);
      return res.status(400).send(renderResultPage(
        false,
        'Erro na Autorização',
        `O Conta Azul retornou um erro durante a autorização.`,
        `Erro: ${error_description || error}`
      ));
    }

    // ─── Validar code ─────────────────────────────────────────────────
    if (!code) {
      console.error('[OAuth Callback] CODE_MISSING');
      return res.status(400).send(renderResultPage(
        false,
        'Código Ausente',
        'O authorization code não foi recebido. Tente reconectar novamente pelo dashboard.',
        'Parâmetro "code" ausente na URL de callback.'
      ));
    }

    // ─── Verificar replay de code ─────────────────────────────────────
    const codeHash = code.substring(0, 20); // Usar prefixo como hash
    if (consumedCodes.has(codeHash)) {
      console.error('[OAuth Callback] CODE_REPLAY_DETECTED:', codeHash);
      return res.status(400).send(renderResultPage(
        false,
        'Código Já Utilizado',
        'Este authorization code já foi processado. Gere um novo link de reconexão no dashboard.',
        'O code OAuth só pode ser usado uma vez. Clique em "Reconectar Conta Azul" na aba Técnica para gerar um novo.'
      ));
    }

    // ─── Validar state (CSRF protection) ──────────────────────────────
    if (state) {
      const stateResult = validateAndConsumeState(state);
      if (!stateResult.valid) {
        console.warn('[OAuth Callback] STATE_INVALID:', stateResult.reason);
        // Não bloquear por state inválido — pode ser restart do servidor
        // Apenas logar como warning
        console.warn('[OAuth Callback] Continuando mesmo com state inválido (pode ser restart do servidor)');
      } else {
        console.log('[OAuth Callback] STATE_VALID ✓');
      }
    } else {
      console.warn('[OAuth Callback] STATE_MISSING — continuando sem validação de state');
    }

    // ─── LOG: Dados do exchange ───────────────────────────────────────
    console.log('[OAuth Callback] CODE_RECEIVED:', code.substring(0, 12) + '...');
    console.log('[OAuth Callback] STATE_RECEIVED:', state?.substring(0, 12) + '...');
    console.log('[OAuth Callback] REDIRECT_URI:', FIXED_REDIRECT_URI);
    
    // ─── Token Exchange ───────────────────────────────────────────────
    console.log('[OAuth] TOKEN_EXCHANGE_START');
    console.log('[OAuth] tokenEndpoint: https://auth.contaazul.com/oauth2/token');
    console.log('[OAuth] redirectUri:', FIXED_REDIRECT_URI);
    console.log('[OAuth] codePrefix:', code.substring(0, 12));
    
    const tokenData = await exchangeCodeForToken(code, FIXED_REDIRECT_URI);

    // Marcar code como consumido APÓS exchange bem-sucedido
    consumedCodes.add(codeHash);

    if (!tokenData.access_token) {
      throw new Error('Token exchange retornou sem access_token');
    }

    // ─── LOG: Exchange bem-sucedido ───────────────────────────────────
    console.log('[OAuth] TOKEN_EXCHANGE_SUCCESS');
    console.log('[OAuth] tokenType:', tokenData.token_type);
    console.log('[OAuth] expiresIn:', tokenData.expires_in, 'segundos');
    console.log('[OAuth] refreshToken:', tokenData.refresh_token ? 'PRESENTE' : 'AUSENTE');
    console.log('[OAuth] accessTokenPrefix:', tokenData.access_token.substring(0, 8) + '...');

    // ─── Salvar token ─────────────────────────────────────────────────
    console.log('[OAuth] TOKEN_SAVE_START');
    await saveToken(
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_in
    );

    // Verificar persistência
    const db = await getDb();
    if (db) {
      const { desc } = await import('drizzle-orm');
      const saved = await db
        .select()
        .from(contaAzulTokens)
        .orderBy((t: any) => t.updatedAt ? desc(t.updatedAt) : desc(t.createdAt))
        .limit(1);
      
      if (saved.length > 0) {
        console.log('[OAuth] TOKEN_SAVED ✅');
        console.log('[OAuth] dbId:', saved[0].id);
        console.log('[OAuth] expiresAt:', saved[0].expiresAt);
      } else {
        console.error('[OAuth] TOKEN_SAVE_FAILED — não encontrado no DB após insert');
      }
    }

    // Resetar flag de reautorização (permite refresh automático retomar)
    await resetReauthFlag();
    console.log('[OAuth] needsReauth resetado — refresh automático retomado');

    console.log('[OAuth] ═══════════════════════════════════════════');
    console.log('[OAuth] OAUTH_FLOW_COMPLETE ✅');
    console.log('[OAuth] ═══════════════════════════════════════════');

    // ─── Retornar página de sucesso ───────────────────────────────────
    return res.status(200).send(renderResultPage(
      true,
      'Conta Azul Conectada!',
      'O token OAuth foi renovado com sucesso. O sync de pagamentos será retomado automaticamente na próxima execução.',
      `Token válido por ${Math.round((tokenData.expires_in || 3600) / 60)} minutos. Refresh token ${tokenData.refresh_token ? 'disponível' : 'ausente'}.`
    ));

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    const isInvalidCode = errorMessage.includes('invalid') || errorMessage.includes('expired') || errorMessage.includes('authorization');
    
    console.error('[OAuth] ═══════════════════════════════════════════');
    console.error('[OAuth] CALLBACK_ERROR');
    console.error('[OAuth] timestamp:', timestamp);
    console.error('[OAuth] error:', errorMessage);
    console.error('[OAuth] isInvalidCode:', isInvalidCode);
    if (error instanceof Error && error.stack) {
      console.error('[OAuth] stack:', error.stack.substring(0, 300));
    }
    console.error('[OAuth] ═══════════════════════════════════════════');

    if (isInvalidCode) {
      return res.status(400).send(renderResultPage(
        false,
        'Código Expirado ou Inválido',
        'O authorization code expirou ou já foi utilizado. Isso pode acontecer se você demorou para completar o login ou se a página foi recarregada.',
        'Solução: Volte ao dashboard → aba Técnica → clique em "Reconectar Conta Azul" para gerar um novo link. Complete o login rapidamente após clicar.'
      ));
    }

    return res.status(500).send(renderResultPage(
      false,
      'Erro na Autorização',
      'Ocorreu um erro ao processar a autorização do Conta Azul.',
      `Detalhes: ${errorMessage}. Tente novamente clicando em "Reconectar Conta Azul" na aba Técnica.`
    ));
  }
}
