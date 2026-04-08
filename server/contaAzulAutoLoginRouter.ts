/**
 * 🔐 Endpoint de Login Automático Conta Azul
 * 
 * Faz login automaticamente usando credenciais de teste
 * e salva o token no banco de dados para uso posterior
 */

import express from 'express';
import { exchangeCodeForToken, saveToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';

const router = express.Router();

/**
 * POST /api/test/conta-azul/login-auto
 * 
 * Faz login automaticamente usando authorization code
 * Requer: authorizationCode (obtido via /api/test/conta-azul/auth-url)
 */
router.post('/login-auto', async (req, res) => {
  try {
    const { authorizationCode } = req.body;

    if (!authorizationCode) {
      return res.status(400).json({
        success: false,
        error: 'authorizationCode é obrigatório',
        hint: 'Obtenha o code via /api/test/conta-azul/auth-url'
      });
    }

    console.log('[ContaAzulAutoLogin] Iniciando login automático...');
    console.log('[ContaAzulAutoLogin] Authorization code:', authorizationCode.substring(0, 20) + '...');

    // 1) Trocar authorization code por token
    const tokenData = await exchangeCodeForToken(authorizationCode);

    console.log('[ContaAzulAutoLogin] Token obtido com sucesso');
    console.log('[ContaAzulAutoLogin] access_token:', tokenData.access_token.substring(0, 20) + '...');
    console.log('[ContaAzulAutoLogin] expires_in:', tokenData.expires_in);

    // 2) Salvar token no banco
    await saveToken(
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_in,
      1 // userId = 1 (padrão)
    );

    console.log('[ContaAzulAutoLogin] Token salvo no banco com sucesso');

    // 3) Verificar se token foi salvo
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    const savedTokens = await db
      .select()
      .from(contaAzulTokens)
      .limit(1);

    return res.json({
      success: true,
      message: 'Login automático realizado com sucesso',
      tokenSaved: savedTokens.length > 0,
      expiresIn: tokenData.expires_in,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      nextStep: 'Agora você pode usar POST /api/test/conta-azul/sync-now para sincronizar receivables'
    });
  } catch (error) {
    console.error('[ContaAzulAutoLogin] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      hint: 'Verifique se o authorization code é válido e não expirou'
    });
  }
});

export default router;
