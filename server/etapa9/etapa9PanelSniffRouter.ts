/**
 * ETAPA 9.1 — PANEL SNIFF: INTERCEPTAR RESPONSES
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-sniff
 * 
 * Objetivo:
 *   Login via Playwright
 *   Navegar para área financeira
 *   Interceptar todas as responses contendo: financial, charge, boleto, pdf, etc
 *   Capturar URL, status, content-type, body preview
 *   Extrair qualquer URL contendo "pdf" ou "boleto"
 */

import express from 'express';

const router = express.Router();

const PANEL_EMAIL = process.env.CONTA_AZUL_PANEL_EMAIL;
const PANEL_PASSWORD = process.env.CONTA_AZUL_PANEL_PASSWORD;
const SERVICES_BASE = 'https://services.contaazul.com';

/**
 * GET /api/test/etapa9/r7/panel-sniff
 * 
 * Interceptar responses do painel
 */
router.get('/panel-sniff', async (req, res) => {
  try {
    console.log('[Etapa9-Sniff] Iniciando panel-sniff...');

    // Validar ENV vars
    if (!PANEL_EMAIL || !PANEL_PASSWORD) {
      console.error('[Etapa9-Sniff] ENV vars ausentes');

      const missing = [];
      if (!PANEL_EMAIL) missing.push('CONTA_AZUL_PANEL_EMAIL');
      if (!PANEL_PASSWORD) missing.push('CONTA_AZUL_PANEL_PASSWORD');

      return res.status(400).json({
        ok: false,
        decision: 'MISSING_PANEL_CREDS',
        missingEnvVars: missing
      });
    }

    // Importar Playwright
    let playwright: any;
    try {
      const mod = await import('playwright');
      playwright = mod.default || mod;
      console.log('[Etapa9-Sniff] Playwright importado');
    } catch (err: any) {
      console.error('[Etapa9-Sniff] Playwright não disponível');

      return res.status(500).json({
        ok: false,
        decision: 'PLAYWRIGHT_NOT_AVAILABLE',
        error: err.message
      });
    }

    // Iniciar navegador
    console.log('[Etapa9-Sniff] Iniciando navegador...');
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Array para armazenar responses interceptadas
    const hits: any[] = [];
    const pdfCandidates: string[] = [];

    // Interceptar responses
    page.on('response', (response: any) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || 'unknown';

      // Filtrar por keywords
      const keywords = ['financial', 'charge', 'boleto', 'pdf', 'contaazul-bff', 'finance-pro', 'document'];
      const matchesKeyword = keywords.some(kw => url.toLowerCase().includes(kw));

      if (matchesKeyword) {
        console.log(`[Etapa9-Sniff] 🔍 Interceptado: ${status} ${url.substring(0, 80)}`);

        // Extrair URL se contiver "pdf" ou "boleto"
        if (url.includes('pdf') || url.includes('boleto')) {
          pdfCandidates.push(url);
          console.log(`[Etapa9-Sniff] 📄 PDF Candidate: ${url}`);
        }

        hits.push({
          url,
          status,
          contentType,
          method: response.request().method()
        });
      }
    });

    try {
      // PASSO 1: Login
      console.log('[Etapa9-Sniff] PASSO 1: Login...');
      await page.goto('https://pro.contaazul.com', { waitUntil: 'networkidle', timeout: 30000 });

      // Preencher credenciais
      await page.fill('input[type="email"]', PANEL_EMAIL);
      await page.fill('input[type="password"]', PANEL_PASSWORD);
      await page.click('button[type="submit"]');

      // Aguardar redirecionamento
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      console.log('[Etapa9-Sniff] ✅ Login bem-sucedido');

      // PASSO 2: Navegar para área financeira
      const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
      const chargeRequestId = '84f71eca-0a9d-11f1-b160-d71ec57e576b';

      const summaryUrl = `${SERVICES_BASE}/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`;
      const chargeUrl = `${SERVICES_BASE}/finance-pro/v1/charge-requests/${chargeRequestId}`;

      console.log('[Etapa9-Sniff] PASSO 2: Navegando para Summary...');
      await page.goto(summaryUrl, { waitUntil: 'networkidle', timeout: 30000 });

      console.log('[Etapa9-Sniff] PASSO 3: Navegando para Charge...');
      await page.goto(chargeUrl, { waitUntil: 'networkidle', timeout: 30000 });

      console.log('[Etapa9-Sniff] ✅ Sniff concluído');
      console.log(`[Etapa9-Sniff] Total de hits: ${hits.length}`);
      console.log(`[Etapa9-Sniff] PDF candidates: ${pdfCandidates.length}`);

      return res.json({
        ok: true,
        hitsCount: hits.length,
        pdfCandidatesCount: pdfCandidates.length,
        pdfCandidates,
        hits
      });
    } catch (error: any) {
      console.error('[Etapa9-Sniff] Erro durante sniff:', error.message);

      return res.status(500).json({
        ok: false,
        decision: 'SNIFF_ERROR',
        error: error.message,
        hitsCount: hits.length,
        pdfCandidatesCount: pdfCandidates.length,
        hits,
        pdfCandidates
      });
    } finally {
      await browser.close();
      console.log('[Etapa9-Sniff] Navegador fechado');
    }
  } catch (error: any) {
    console.error('[Etapa9-Sniff] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      decision: 'PANEL_SNIFF_ERROR',
      error: error.message
    });
  }
});

export default router;
