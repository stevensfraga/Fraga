/**
 * ETAPA 9.1 — PASSO 9.1-B2: PANEL LOGIN SESSION (PLAYWRIGHT)
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-login-session
 * 
 * Objetivo:
 *   Gerar web session válida do painel usando Playwright
 *   Salvar storageState.json no servidor
 *   Sem pedir nada pro usuário
 */

import express from 'express';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const PANEL_EMAIL = process.env.CONTA_AZUL_PANEL_EMAIL;
const PANEL_PASSWORD = process.env.CONTA_AZUL_PANEL_PASSWORD;
const STORAGE_DIR = path.join(process.cwd(), 'server', '.panel');

/**
 * GET /api/test/etapa9/r7/panel-login-session
 * 
 * Gera web session do painel via Playwright
 */
router.get('/panel-login-session', async (req, res) => {
  try {
    console.log('[Etapa9-B2] Iniciando panel-login-session...');

    // Validar ENV vars
    if (!PANEL_EMAIL || !PANEL_PASSWORD) {
      console.error('[Etapa9-B2] ❌ ENV vars ausentes');

      const missing = [];
      if (!PANEL_EMAIL) missing.push('CONTA_AZUL_PANEL_EMAIL');
      if (!PANEL_PASSWORD) missing.push('CONTA_AZUL_PANEL_PASSWORD');

      return res.status(400).json({
        ok: false,
        decision: 'MISSING_PANEL_CREDS',
        missingEnvVars: missing,
        message: `Credenciais do painel não configuradas. Configure: ${missing.join(', ')}`
      });
    }

    console.log('[Etapa9-B2] Email:', PANEL_EMAIL.substring(0, 5) + '...');

    // Criar diretório se não existir
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
      console.log('[Etapa9-B2] Diretório criado:', STORAGE_DIR);
    }

    // Tentar importar Playwright
    let playwright: any;
    try {
      // Usar dynamic require para evitar problemas de tipo
      const mod = await import('playwright');
      playwright = mod.default || mod;
      console.log('[Etapa9-B2] Playwright importado');
    } catch (err: any) {
      console.error('[Etapa9-B2] ❌ Playwright não instalado:', err.message);

      return res.status(500).json({
        ok: false,
        decision: 'PLAYWRIGHT_NOT_INSTALLED',
        error: 'Playwright não está instalado. Execute: pnpm add -D playwright',
        message: 'Instale Playwright para usar este endpoint'
      });
    }

    // Iniciar navegador
    console.log('[Etapa9-B2] Iniciando navegador...');
    const browser = await playwright.chromium.launch({
      headless: true, // headless=true por padrão
    });

    // Criar contexto e página
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Navegar para painel
      console.log('[Etapa9-B2] Navegando para https://pro.contaazul.com...');
      await page.goto('https://pro.contaazul.com', { waitUntil: 'networkidle' });

      // Fazer login
      console.log('[Etapa9-B2] Fazendo login...');
      await page.fill('input[type="email"]', PANEL_EMAIL);
      await page.fill('input[type="password"]', PANEL_PASSWORD);
      await page.click('button[type="submit"]');

      // Aguardar redirecionamento
      console.log('[Etapa9-B2] Aguardando redirecionamento...');
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });

      console.log('[Etapa9-B2] ✅ Login bem-sucedido');

      // Salvar storageState
      const storageStatePath = path.join(STORAGE_DIR, 'contaazul.storageState.json');
      let storageState: any = { cookies: [] };
      
      try {
        storageState = await context.storageState();
        fs.writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));
        console.log('[Etapa9-B2] ✅ StorageState salvo:', storageStatePath);
      } catch (storageErr: any) {
        console.error('[Etapa9-B2] ⚠️ Falha ao salvar storageState:', storageErr.message);
      }

      // Contar cookies
      const cookiesCount = storageState.cookies?.length || 0;
      console.log('[Etapa9-B2] Cookies salvos:', cookiesCount);

      return res.json({
        ok: true,
        decision: 'WEB_SESSION_READY',
        cookiesCount,
        savedPathMasked: storageStatePath.substring(0, 30) + '...',
        message: 'Web session gerada com sucesso. Próximo: panel-fetch'
      });
    } catch (loginErr: any) {
      console.error('[Etapa9-B2] ❌ Login falhou:', loginErr.message);

      return res.status(500).json({
        ok: false,
        decision: 'LOGIN_FAILED',
        error: loginErr.message,
        message: 'Falha ao fazer login no painel'
      });
    } finally {
      try {
        await context.close();
        await browser.close();
        console.log('[Etapa9-B2] Navegador e contexto fechados');
      } catch (closeErr: any) {
        console.error('[Etapa9-B2] ⚠️ Erro ao fechar navegador:', closeErr.message);
      }
    }
  } catch (error: any) {
    console.error('[Etapa9-B2] ❌ Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      decision: 'PANEL_LOGIN_ERROR',
      error: error.message
    });
  }
});

export default router;
