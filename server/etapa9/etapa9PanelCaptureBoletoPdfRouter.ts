/**
 * ETAPA 9.1 — PANEL CAPTURE BOLETO PDF (DEBUG VERSION)
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-capture-boleto-pdf
 * 
 * Objetivo:
 *   Abrir o painel usando storageState
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
 * GET /api/test/etapa9/r7/panel-capture-boleto-pdf
 * 
 * Capturar PDF do boleto do painel via download
 * Com debug visual e seletores robustos
 */
router.get('/panel-capture-boleto-pdf', async (req, res) => {
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const storagePath = path.resolve('server/.panel/contaazul.storageState.json');
  const targetCliente = (req.query.cliente as string) || 'R7';
  const outDir = path.resolve('server/.panel/downloads');
  const debugDir = path.resolve('server/.panel/debug');

  console.log('[Etapa9-Capture-DEBUG] Iniciando panel-capture-boleto-pdf...');
  console.log('[Etapa9-Capture-DEBUG] Cliente:', targetCliente);
  console.log('[Etapa9-Capture-DEBUG] CorrelationId:', correlationId);

  // Criar diretórios
  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(debugDir, { recursive: true });
  } catch (err: any) {
    console.error('[Etapa9-Capture-DEBUG] Erro ao criar diretórios:', err.message);
  }

  // Importar Playwright
  let playwright: any;
  try {
    const mod = await import('playwright');
    playwright = mod.default || mod;
  } catch (err: any) {
    console.error('[Etapa9-Capture-DEBUG] Playwright não disponível');
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
    console.log('[Etapa9-Capture-DEBUG] Iniciando navegador (headless: true, com logs detalhados)...');
    browser = await playwright.chromium.launch({
      headless: true
    });

    // Verificar se storageState existe
    let storageState: any = null;
    try {
      const storageContent = await fs.readFile(storagePath, 'utf-8');
      storageState = JSON.parse(storageContent);
      console.log('[Etapa9-Capture-DEBUG] StorageState carregado');
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] StorageState não encontrado ou inválido');
      return res.status(400).json({
        ok: false,
        decision: 'STORAGE_STATE_NOT_FOUND',
        correlationId,
        error: 'Execute primeiro: GET /api/test/etapa9/r7/panel-login-session'
      });
    }

    const context = await browser.newContext({
      storageState,
      acceptDownloads: true,
      locale: 'pt-BR'
    });

    const page = await context.newPage();

    // ETAPA 1: Abrir painel logado
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 1] Abrindo painel...');
    try {
      console.log('[Etapa9-Capture-DEBUG] Navegando para:', 'https://pro.contaazul.com');
      await page.goto('https://pro.contaazul.com', { waitUntil: 'networkidle', timeout: 30000 });
      console.log('[Etapa9-Capture-DEBUG] URL final:', page.url());
      console.log('[Etapa9-Capture-DEBUG] ✅ Painel aberto');
      
      try {
        const screenshotPath1 = path.join(debugDir, '01-home.png');
        await page.screenshot({ path: screenshotPath1 });
        screenshots.push(screenshotPath1);
        console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath1);
      } catch (err: any) {
        console.log('[Etapa9-Capture-DEBUG] ⚠️ Screenshot não disponível:', err.message);
      }
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao abrir painel:', err.message);
      return res.status(200).json({
        ok: false,
        decision: 'OPEN_PANEL_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 2: Clicar em Financeiro
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 2] Procurando "Financeiro"...');
    try {
      const financeiro = page.locator('text=/Financeiro/i').first();
      const count = await financeiro.count();
      console.log('[Etapa9-Capture-DEBUG] Elementos encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-Capture-DEBUG] ❌ "Financeiro" não encontrado');
        const screenshotPath = path.join(debugDir, '02-financeiro-not-found.png');
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
      console.log('[Etapa9-Capture-DEBUG] ✅ "Financeiro" clicado');
      await page.waitForTimeout(800);

      const screenshotPath2 = path.join(debugDir, '02-financeiro-clicked.png');
      await page.screenshot({ path: screenshotPath2 });
      screenshots.push(screenshotPath2);
      console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath2);
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao clicar em Financeiro:', err.message);
      const screenshotPath = path.join(debugDir, '02-financeiro-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'FINANCEIRO_CLICK_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 3: Clicar em Contas a Receber
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 3] Procurando "Contas a receber"...');
    try {
      const contasReceber = page.locator('text=/Contas a receber/i').first();
      const count = await contasReceber.count();
      console.log('[Etapa9-Capture-DEBUG] Elementos encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-Capture-DEBUG] ❌ "Contas a receber" não encontrado');
        const screenshotPath = path.join(debugDir, '03-contas-not-found.png');
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
      console.log('[Etapa9-Capture-DEBUG] ✅ "Contas a receber" clicado');
      await page.waitForTimeout(1500);

      const screenshotPath3 = path.join(debugDir, '03-contas-clicked.png');
      await page.screenshot({ path: screenshotPath3 });
      screenshots.push(screenshotPath3);
      console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath3);
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao clicar em Contas a Receber:', err.message);
      const screenshotPath = path.join(debugDir, '03-contas-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'CONTAS_CLICK_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 4: Buscar cliente (R7)
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 4] Buscando cliente:', targetCliente);
    try {
      const searchInput = page.locator('input[placeholder*="Buscar"], input[aria-label*="Buscar"]').first();
      const count = await searchInput.count();
      console.log('[Etapa9-Capture-DEBUG] Campos de busca encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-Capture-DEBUG] ❌ Campo de busca não encontrado');
        const screenshotPath = path.join(debugDir, '04-search-not-found.png');
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
      console.log('[Etapa9-Capture-DEBUG] ✅ Texto digitado:', targetCliente);
      await page.waitForTimeout(800);
      
      await page.keyboard.press('Enter').catch(() => {
        console.log('[Etapa9-Capture-DEBUG] ⚠️ Enter não respondeu');
      });
      
      await page.waitForTimeout(1500);

      const screenshotPath4 = path.join(debugDir, '04-search-done.png');
      await page.screenshot({ path: screenshotPath4 });
      screenshots.push(screenshotPath4);
      console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath4);
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao buscar cliente:', err.message);
      const screenshotPath = path.join(debugDir, '04-search-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'SEARCH_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 5: Abrir primeiro item da lista
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 5] Procurando primeiro item da lista...');
    try {
      const firstRow = page.locator('[role="row"]').nth(1);
      const count = await firstRow.count();
      console.log('[Etapa9-Capture-DEBUG] Linhas encontradas:', count);

      if (count === 0) {
        console.error('[Etapa9-Capture-DEBUG] ❌ Primeira linha não encontrada');
        const screenshotPath = path.join(debugDir, '05-row-not-found.png');
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
      console.log('[Etapa9-Capture-DEBUG] ✅ Primeira linha clicada');
      await page.waitForTimeout(1000);

      const screenshotPath5 = path.join(debugDir, '05-row-clicked.png');
      await page.screenshot({ path: screenshotPath5 });
      screenshots.push(screenshotPath5);
      console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath5);
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao abrir item:', err.message);
      const screenshotPath = path.join(debugDir, '05-row-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'ROW_CLICK_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 6: Abrir menu Ações
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 6] Procurando botão Ações...');
    try {
      const actionsBtn = page.locator('button:has-text("Ações")').first()
        .or(page.getByRole('button', { name: /ações|mais ações|opções/i }).first())
        .or(page.locator('button[aria-label*="Ações"], button[aria-label*="Mais"]').first());

      const count = await actionsBtn.count();
      console.log('[Etapa9-Capture-DEBUG] Botões Ações encontrados:', count);

      if (count === 0) {
        console.error('[Etapa9-Capture-DEBUG] ❌ Botão Ações não encontrado');
        const screenshotPath = path.join(debugDir, '06-actions-not-found.png');
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
      console.log('[Etapa9-Capture-DEBUG] ✅ Botão Ações clicado');
      await page.waitForTimeout(500);

      const screenshotPath6 = path.join(debugDir, '06-actions-clicked.png');
      await page.screenshot({ path: screenshotPath6 });
      screenshots.push(screenshotPath6);
      console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath6);
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao abrir menu Ações:', err.message);
      const screenshotPath = path.join(debugDir, '06-actions-error.png');
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
      
      return res.status(200).json({
        ok: false,
        decision: 'ACTIONS_CLICK_FAILED',
        correlationId,
        error: err.message,
        screenshots
      });
    }

    // ETAPA 7: Esperar por download e clicar em Boleto
    console.log('[Etapa9-Capture-DEBUG] [ETAPA 7] Aguardando download...');
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 });

      const boletoItem = page.locator('text=/baixar boleto|imprimir boleto|boleto/i').first();
      const count = await boletoItem.count();
      console.log('[Etapa9-Capture-DEBUG] Opções de boleto encontradas:', count);

      if (count === 0) {
        console.error('[Etapa9-Capture-DEBUG] ❌ Opção de boleto não encontrada');
        const screenshotPath = path.join(debugDir, '07-boleto-not-found.png');
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
      console.log('[Etapa9-Capture-DEBUG] ✅ Opção de boleto clicada');

      const download = await downloadPromise;
      console.log('[Etapa9-Capture-DEBUG] ✅ Download capturado');

      const screenshotPath7 = path.join(debugDir, '07-download-captured.png');
      await page.screenshot({ path: screenshotPath7 });
      screenshots.push(screenshotPath7);
      console.log('[Etapa9-Capture-DEBUG] Screenshot salvo:', screenshotPath7);

      // ETAPA 8: Salvar arquivo
      console.log('[Etapa9-Capture-DEBUG] [ETAPA 8] Salvando arquivo...');
      const suggested = download.suggestedFilename();
      const finalName = suggested.toLowerCase().endsWith('.pdf') ? suggested : `${suggested}.pdf`;
      const savePath = path.join(outDir, `${Date.now()}_${finalName}`);

      try {
        await download.saveAs(savePath);
        console.log('[Etapa9-Capture-DEBUG] ✅ Arquivo salvo:', savePath);
      } catch (err: any) {
        console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao salvar arquivo:', err.message);
        return res.status(200).json({
          ok: false,
          decision: 'SAVE_FAILED',
          correlationId,
          error: err.message,
          screenshots
        });
      }

      // ETAPA 9: Validar tamanho + SHA256
      console.log('[Etapa9-Capture-DEBUG] [ETAPA 9] Validando PDF...');
      let buf: Buffer;
      try {
        buf = await fs.readFile(savePath);
      } catch (err: any) {
        console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao ler arquivo:', err.message);
        return res.status(200).json({
          ok: false,
          decision: 'READ_FAILED',
          correlationId,
          error: err.message,
          screenshots
        });
      }

      const sizeBytes = buf.length;
      const fileSha = sha256(buf);

      console.log('[Etapa9-Capture-DEBUG] Tamanho:', sizeBytes, 'bytes');
      console.log('[Etapa9-Capture-DEBUG] SHA256:', fileSha);

      if (sizeBytes < 10240) {
        console.error('[Etapa9-Capture-DEBUG] ❌ PDF muito pequeno:', sizeBytes, 'bytes');
        return res.status(200).json({
          ok: false,
          decision: 'PDF_TOO_SMALL',
          correlationId,
          sizeBytes,
          sha256: fileSha,
          savedPathMasked: savePath.slice(0, 30) + '...',
          message: `PDF tem ${sizeBytes} bytes, precisa de >= 10240`,
          screenshots
        });
      }

      console.log('[Etapa9-Capture-DEBUG] ✅ PDF válido!');

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
      console.error('[Etapa9-Capture-DEBUG] ❌ Erro ao capturar download:', error.message);
      const screenshotPath = path.join(debugDir, '07-download-error.png');
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
    console.error('[Etapa9-Capture-DEBUG] ❌ Erro geral:', error.message);

    return res.status(200).json({
      ok: false,
      decision: 'PANEL_CAPTURE_FAILED',
      correlationId,
      error: error.message,
      screenshots
    });
  } finally {
    try {
      if (browser) await browser.close();
      console.log('[Etapa9-Capture-DEBUG] Navegador fechado');
    } catch (err: any) {
      console.error('[Etapa9-Capture-DEBUG] Erro ao fechar navegador:', err.message);
    }
  }
});

export default router;
