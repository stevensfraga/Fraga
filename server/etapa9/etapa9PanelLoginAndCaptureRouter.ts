/**
 * ETAPA 9.1 — PANEL LOGIN AND CAPTURE (SINGLE SESSION)
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-login-and-capture
 * 
 * Objetivo:
 *   Fazer login no painel com credenciais ENV
 *   Navegar até Financeiro → Contas a Receber
 *   Buscar cliente (ex: R7)
 *   Clicar em Ações → Baixar Boleto
 *   Capturar download via Playwright
 *   Validar: sizeBytes >= 10240 (>10KB)
 */

import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

const router = express.Router();

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * GET /api/test/etapa9/r7/panel-login-and-capture
 * 
 * Fazer login + capturar PDF em uma única sessão
 */
router.get('/panel-login-and-capture', async (req, res) => {
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const targetCliente = (req.query.cliente as string) || 'R7';
  const outDir = path.resolve('server/.panel/downloads');
  const debugDir = path.resolve('server/.panel/debug');

  // Credenciais do painel
  const panelEmail = process.env.CONTA_AZUL_PANEL_EMAIL;
  const panelPassword = process.env.CONTA_AZUL_PANEL_PASSWORD;

  if (!panelEmail || !panelPassword) {
    return res.status(400).json({
      ok: false,
      decision: 'MISSING_PANEL_CREDS',
      correlationId,
      missingEnvVars: [
        !panelEmail ? 'CONTA_AZUL_PANEL_EMAIL' : null,
        !panelPassword ? 'CONTA_AZUL_PANEL_PASSWORD' : null
      ].filter(Boolean)
    });
  }

  console.log('[Etapa9-LoginCapture] Iniciando panel-login-and-capture...');
  console.log('[Etapa9-LoginCapture] Cliente:', targetCliente);
  console.log('[Etapa9-LoginCapture] CorrelationId:', correlationId);

  // Criar diretórios
  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(debugDir, { recursive: true });
  } catch (err: any) {
    console.error('[Etapa9-LoginCapture] Erro ao criar diretórios:', err.message);
  }

  // Importar Playwright
  let playwright: any;
  try {
    const mod = await import('playwright');
    playwright = mod.default || mod;
  } catch (err: any) {
    console.error('[Etapa9-LoginCapture] Playwright não disponível');
    return res.status(500).json({
      ok: false,
      decision: 'PLAYWRIGHT_NOT_AVAILABLE',
      correlationId,
      error: err.message
    });
  }

  let browser: any;
  const screenshots: string[] = [];

  try {
    console.log('[Etapa9-LoginCapture] Iniciando navegador...');
    browser = await playwright.chromium.launch({ headless: true });

    const context = await browser.newContext({
      acceptDownloads: true,
      locale: 'pt-BR'
    });

    const page = await context.newPage();

    // ETAPA 1: Abrir painel
    console.log('[Etapa9-LoginCapture] [ETAPA 1] Abrindo painel...');
    try {
      await page.goto('https://pro.contaazul.com', { waitUntil: 'networkidle', timeout: 30000 });
      console.log('[Etapa9-LoginCapture] ✅ Painel aberto');
      
      try {
        const screenshotPath1 = path.join(debugDir, 'lc-01-home.png');
        await page.screenshot({ path: screenshotPath1 });
        screenshots.push(screenshotPath1);
        console.log('[Etapa9-LoginCapture] Screenshot salvo:', screenshotPath1);
      } catch (err: any) {
        console.log('[Etapa9-LoginCapture] ⚠️ Screenshot não disponível');
      }
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao abrir painel:', err.message);
      return res.status(200).json({
        ok: false,
        decision: 'OPEN_PANEL_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 2: Fazer login
    console.log('[Etapa9-LoginCapture] [ETAPA 2] Fazendo login...');
    try {
      // Preencher email
      const emailInput = page.locator('input[type="email"], input[name*="email"], input[placeholder*="email"]').first();
      const emailCount = await emailInput.count();
      console.log('[Etapa9-LoginCapture] Campos de email encontrados:', emailCount);

      if (emailCount === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Campo de email não encontrado');
        const screenshotPath = path.join(debugDir, 'lc-02-email-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Email input',
          screenshots
        });
      }

      await emailInput.fill(panelEmail);
      console.log('[Etapa9-LoginCapture] ✅ Email preenchido');

      // Preencher senha
      const passwordInput = page.locator('input[type="password"]').first();
      const passwordCount = await passwordInput.count();
      console.log('[Etapa9-LoginCapture] Campos de senha encontrados:', passwordCount);

      if (passwordCount === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Campo de senha não encontrado');
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Password input',
          screenshots
        });
      }

      await passwordInput.fill(panelPassword);
      console.log('[Etapa9-LoginCapture] ✅ Senha preenchida');

      // Clicar em Entrar
      const enterBtn = page.locator('button:has-text("Entrar")').first()
        .or(page.getByRole('button', { name: /entrar|login/i }).first());
      
      const enterCount = await enterBtn.count();
      console.log('[Etapa9-LoginCapture] Botões de entrada encontrados:', enterCount);

      if (enterCount === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Botão Entrar não encontrado');
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Enter button',
          screenshots
        });
      }

      await enterBtn.click({ timeout: 15000 });
      console.log('[Etapa9-LoginCapture] ✅ Botão Entrar clicado');

      // Aguardar redirecionamento
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      console.log('[Etapa9-LoginCapture] ✅ Login realizado');
      console.log('[Etapa9-LoginCapture] URL após login:', page.url());

      try {
        const screenshotPath2 = path.join(debugDir, 'lc-02-logged-in.png');
        await page.screenshot({ path: screenshotPath2 });
        screenshots.push(screenshotPath2);
        console.log('[Etapa9-LoginCapture] Screenshot salvo:', screenshotPath2);
      } catch (err: any) {
        console.log('[Etapa9-LoginCapture] ⚠️ Screenshot não disponível');
      }
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao fazer login:', err.message);
      const screenshotPath = path.join(debugDir, 'lc-02-login-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'LOGIN_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 3: Navegar para Financeiro > Contas a Receber
    console.log('[Etapa9-LoginCapture] [ETAPA 3] Navegando para Financeiro...');
    try {
      const financeiro = page.locator('text=/Financeiro/i').first();
      const count = await financeiro.count();
      console.log('[Etapa9-LoginCapture] Elementos "Financeiro" encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-LoginCapture] ❌ "Financeiro" não encontrado');
        const screenshotPath = path.join(debugDir, 'lc-03-financeiro-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Financeiro',
          screenshots
        });
      }

      await financeiro.click({ timeout: 15000 });
      console.log('[Etapa9-LoginCapture] ✅ "Financeiro" clicado');
      await page.waitForTimeout(800);

      const contasReceber = page.locator('text=/Contas a receber/i').first();
      const contasCount = await contasReceber.count();
      console.log('[Etapa9-LoginCapture] Elementos "Contas a receber" encontrados:', contasCount);

      if (contasCount === 0) {
        console.error('[Etapa9-LoginCapture] ❌ "Contas a receber" não encontrado');
        const screenshotPath = path.join(debugDir, 'lc-03-contas-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Contas a receber',
          screenshots
        });
      }

      await contasReceber.click({ timeout: 15000 });
      console.log('[Etapa9-LoginCapture] ✅ "Contas a receber" clicado');
      await page.waitForTimeout(1500);

      try {
        const screenshotPath3 = path.join(debugDir, 'lc-03-contas-opened.png');
        await page.screenshot({ path: screenshotPath3 });
        screenshots.push(screenshotPath3);
        console.log('[Etapa9-LoginCapture] Screenshot salvo:', screenshotPath3);
      } catch (err: any) {
        console.log('[Etapa9-LoginCapture] ⚠️ Screenshot não disponível');
      }
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao navegar para Financeiro:', err.message);
      const screenshotPath = path.join(debugDir, 'lc-03-financeiro-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'NAVIGATION_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 4: Buscar cliente
    console.log('[Etapa9-LoginCapture] [ETAPA 4] Buscando cliente:', targetCliente);
    try {
      const searchInput = page.locator('input[placeholder*="Buscar"], input[aria-label*="Buscar"]').first();
      const count = await searchInput.count();
      console.log('[Etapa9-LoginCapture] Campos de busca encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Campo de busca não encontrado');
        const screenshotPath = path.join(debugDir, 'lc-04-search-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Search input',
          screenshots
        });
      }

      await searchInput.fill(targetCliente);
      await page.waitForTimeout(800);
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(1500);

      try {
        const screenshotPath4 = path.join(debugDir, 'lc-04-search-done.png');
        await page.screenshot({ path: screenshotPath4 });
        screenshots.push(screenshotPath4);
        console.log('[Etapa9-LoginCapture] Screenshot salvo:', screenshotPath4);
      } catch (err: any) {
        console.log('[Etapa9-LoginCapture] ⚠️ Screenshot não disponível');
      }
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao buscar cliente:', err.message);
      return res.status(200).json({
        ok: false,
        decision: 'SEARCH_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 5: Abrir primeiro item
    console.log('[Etapa9-LoginCapture] [ETAPA 5] Abrindo primeiro item...');
    try {
      const firstRow = page.locator('[role="row"]').nth(1);
      const count = await firstRow.count();
      console.log('[Etapa9-LoginCapture] Linhas encontradas:', count);

      if (count === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Primeira linha não encontrada');
        const screenshotPath = path.join(debugDir, 'lc-05-row-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'First row',
          screenshots
        });
      }

      await firstRow.click({ timeout: 15000 });
      console.log('[Etapa9-LoginCapture] ✅ Primeira linha clicada');
      await page.waitForTimeout(1000);

      try {
        const screenshotPath5 = path.join(debugDir, 'lc-05-row-opened.png');
        await page.screenshot({ path: screenshotPath5 });
        screenshots.push(screenshotPath5);
        console.log('[Etapa9-LoginCapture] Screenshot salvo:', screenshotPath5);
      } catch (err: any) {
        console.log('[Etapa9-LoginCapture] ⚠️ Screenshot não disponível');
      }
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao abrir item:', err.message);
      return res.status(200).json({
        ok: false,
        decision: 'ROW_CLICK_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 6: Abrir menu Ações
    console.log('[Etapa9-LoginCapture] [ETAPA 6] Abrindo menu Ações...');
    try {
      const actionsBtn = page.locator('button:has-text("Ações")').first()
        .or(page.getByRole('button', { name: /ações|mais ações|opções/i }).first());

      const count = await actionsBtn.count();
      console.log('[Etapa9-LoginCapture] Botões Ações encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Botão Ações não encontrado');
        const screenshotPath = path.join(debugDir, 'lc-06-actions-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Actions button',
          screenshots
        });
      }

      await actionsBtn.click({ timeout: 15000 });
      console.log('[Etapa9-LoginCapture] ✅ Botão Ações clicado');
      await page.waitForTimeout(500);

      try {
        const screenshotPath6 = path.join(debugDir, 'lc-06-actions-menu.png');
        await page.screenshot({ path: screenshotPath6 });
        screenshots.push(screenshotPath6);
        console.log('[Etapa9-LoginCapture] Screenshot salvo:', screenshotPath6);
      } catch (err: any) {
        console.log('[Etapa9-LoginCapture] ⚠️ Screenshot não disponível');
      }
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao abrir menu Ações:', err.message);
      return res.status(200).json({
        ok: false,
        decision: 'ACTIONS_CLICK_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 7: Capturar download de boleto
    console.log('[Etapa9-LoginCapture] [ETAPA 7] Capturando download...');
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 });

      const boletoItem = page.locator('text=/baixar boleto|imprimir boleto|boleto/i').first();
      const count = await boletoItem.count();
      console.log('[Etapa9-LoginCapture] Opções de boleto encontradas:', count);

      if (count === 0) {
        console.error('[Etapa9-LoginCapture] ❌ Opção de boleto não encontrada');
        const screenshotPath = path.join(debugDir, 'lc-07-boleto-not-found.png');
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
        
        return res.status(200).json({
          ok: false,
          decision: 'ELEMENT_NOT_FOUND',
          correlationId,
          element: 'Boleto option',
          screenshots
        });
      }

      await boletoItem.click({ timeout: 15000 });
      console.log('[Etapa9-LoginCapture] ✅ Opção de boleto clicada');

      const download = await downloadPromise;
      console.log('[Etapa9-LoginCapture] ✅ Download capturado');

      // Salvar arquivo
      const suggested = download.suggestedFilename();
      const finalName = suggested.toLowerCase().endsWith('.pdf') ? suggested : `${suggested}.pdf`;
      const savePath = path.join(outDir, `${Date.now()}_${finalName}`);

      await download.saveAs(savePath);
      console.log('[Etapa9-LoginCapture] ✅ Arquivo salvo:', savePath);

      // Validar PDF
      const buf = await fs.readFile(savePath);
      const sizeBytes = buf.length;
      const fileSha = sha256(buf);

      console.log('[Etapa9-LoginCapture] Tamanho:', sizeBytes, 'bytes');
      console.log('[Etapa9-LoginCapture] SHA256:', fileSha);

      if (sizeBytes < 10240) {
        console.error('[Etapa9-LoginCapture] ❌ PDF muito pequeno:', sizeBytes, 'bytes');
        return res.status(200).json({
          ok: false,
          decision: 'PDF_TOO_SMALL',
          correlationId,
          sizeBytes,
          sha256: fileSha,
          message: `PDF tem ${sizeBytes} bytes, precisa de >= 10240`,
          screenshots
        });
      }

      console.log('[Etapa9-LoginCapture] ✅ PDF CAPTURADO COM SUCESSO!');

      return res.status(200).json({
        ok: true,
        decision: 'PDF_CAPTURED_OK',
        correlationId,
        sizeBytes,
        sha256: fileSha,
        suggestedFilename: finalName,
        savedPathMasked: savePath.slice(0, 30) + '...',
        nextAction: 'SEND_VIA_ZAP',
        screenshots
      });
    } catch (error: any) {
      console.error('[Etapa9-LoginCapture] ❌ Erro ao capturar download:', error.message);
      const screenshotPath = path.join(debugDir, 'lc-07-download-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);

      return res.status(200).json({
        ok: false,
        decision: 'DOWNLOAD_FAILED',
        correlationId,
        error: error.message,
        screenshots
      });
    }
  } catch (error: any) {
    console.error('[Etapa9-LoginCapture] ❌ Erro geral:', error.message);

    return res.status(200).json({
      ok: false,
      decision: 'PANEL_LOGIN_CAPTURE_FAILED',
      correlationId,
      error: error.message,
      screenshots
    });
  } finally {
    try {
      if (browser) await browser.close();
      console.log('[Etapa9-LoginCapture] Navegador fechado');
    } catch (err: any) {
      console.error('[Etapa9-LoginCapture] Erro ao fechar navegador:', err.message);
    }
  }
});

export default router;
