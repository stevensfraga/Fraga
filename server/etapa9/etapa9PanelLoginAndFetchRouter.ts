/**
 * ETAPA 9.1 — PASSO 9.1-B3: PANEL LOGIN AND FETCH (INSTRUMENTADO)
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-login-and-fetch
 * 
 * Objetivo:
 *   Login + Fetch em uma única sessão Playwright
 *   Extrair pdf_url/boleto_url
 *   INSTRUMENTADO: Logar status, content-type, body preview, detecção de HTML
 */

import express from 'express';

const router = express.Router();

const PANEL_EMAIL = process.env.CONTA_AZUL_PANEL_EMAIL;
const PANEL_PASSWORD = process.env.CONTA_AZUL_PANEL_PASSWORD;
const SERVICES_BASE = 'https://services.contaazul.com';

/**
 * GET /api/test/etapa9/r7/panel-login-and-fetch
 * 
 * Login + Fetch em uma sessão Playwright (INSTRUMENTADO)
 */
router.get('/panel-login-and-fetch', async (req, res) => {
  try {
    console.log('[Etapa9-B3] Iniciando panel-login-and-fetch (INSTRUMENTADO)...');

    // Validar ENV vars
    if (!PANEL_EMAIL || !PANEL_PASSWORD) {
      console.error('[Etapa9-B3] ENV vars ausentes');

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
      console.log('[Etapa9-B3] Playwright importado');
    } catch (err: any) {
      console.error('[Etapa9-B3] Playwright não disponível');

      return res.status(500).json({
        ok: false,
        decision: 'PLAYWRIGHT_NOT_AVAILABLE',
        error: err.message
      });
    }

    // Iniciar navegador
    console.log('[Etapa9-B3] Iniciando navegador...');
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // PASSO 1: Login
      console.log('[Etapa9-B3] PASSO 1: Login...');
      await page.goto('https://pro.contaazul.com', { waitUntil: 'networkidle', timeout: 30000 });

      // Preencher credenciais
      await page.fill('input[type="email"]', PANEL_EMAIL);
      await page.fill('input[type="password"]', PANEL_PASSWORD);
      await page.click('button[type="submit"]');

      // Aguardar redirecionamento
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      console.log('[Etapa9-B3] ✅ Login bem-sucedido');

      // PASSO 2: Fetch Summary (INSTRUMENTADO)
      const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
      const chargeRequestId = '84f71eca-0a9d-11f1-b160-d71ec57e576b';

      const summaryUrl = `${SERVICES_BASE}/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`;
      const chargeUrl = `${SERVICES_BASE}/finance-pro/v1/charge-requests/${chargeRequestId}`;

      console.log('[Etapa9-B3] PASSO 2: Fetch Summary...');
      let summaryData: any = null;
      let chargeData: any = null;
      let pdfUrl: string | null = null;
      let keysFound: string[] = [];

      // Debug object
      const debug: any = {
        summary: { status: null, contentType: null, finalUrl: null, size: 0, bodyPreview: '', isHtml: false },
        charge: { status: null, contentType: null, finalUrl: null, size: 0, bodyPreview: '', isHtml: false }
      };

      try {
        console.log('[Etapa9-B3] Navegando para Summary...');
        const response = await page.goto(summaryUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Capturar informações de debug
        debug.summary.status = response?.status();
        debug.summary.finalUrl = page.url();
        
        const contentType = response?.headers()['content-type'] || 'unknown';
        debug.summary.contentType = contentType;

        const bodyText = await page.evaluate(() => document.body.innerText);
        debug.summary.size = bodyText.length;
        debug.summary.bodyPreview = bodyText.substring(0, 300);

        // Detectar HTML
        if (bodyText.toLowerCase().includes('<html') || 
            bodyText.toLowerCase().includes('<!doctype') ||
            bodyText.toLowerCase().includes('login') ||
            contentType.includes('text/html')) {
          debug.summary.isHtml = true;
          console.error('[Etapa9-B3] ⚠️ Summary retornou HTML (possível redirect/login)');
        }

        if (response?.ok() && contentType.includes('application/json')) {
          try {
            summaryData = JSON.parse(bodyText);
            console.log('[Etapa9-B3] ✅ Summary obtido (JSON válido)');
            console.log('[Etapa9-B3] Summary keys:', Object.keys(summaryData));

            if (summaryData?.pdf_url) {
              pdfUrl = summaryData.pdf_url;
              keysFound.push('summary.pdf_url');
              console.log('[Etapa9-B3] ✅ Encontrado: summary.pdf_url');
            }
            if (summaryData?.boleto_url && !pdfUrl) {
              pdfUrl = summaryData.boleto_url;
              keysFound.push('summary.boleto_url');
              console.log('[Etapa9-B3] ✅ Encontrado: summary.boleto_url');
            }
            if (summaryData?.document_url && !pdfUrl) {
              pdfUrl = summaryData.document_url;
              keysFound.push('summary.document_url');
              console.log('[Etapa9-B3] ✅ Encontrado: summary.document_url');
            }
          } catch (parseErr: any) {
            console.error('[Etapa9-B3] Falha ao parsear Summary JSON:', parseErr.message);
          }
        } else {
          console.error('[Etapa9-B3] Summary não é JSON válido. Status:', response?.status(), 'ContentType:', contentType);
        }
      } catch (err: any) {
        console.error('[Etapa9-B3] Summary erro:', err.message);
        debug.summary.status = 'ERROR';
      }

      // PASSO 3: Fetch Charge Request (INSTRUMENTADO)
      console.log('[Etapa9-B3] PASSO 3: Fetch Charge Request...');
      try {
        console.log('[Etapa9-B3] Navegando para Charge...');
        const response = await page.goto(chargeUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Capturar informações de debug
        debug.charge.status = response?.status();
        debug.charge.finalUrl = page.url();
        
        const contentType = response?.headers()['content-type'] || 'unknown';
        debug.charge.contentType = contentType;

        const bodyText = await page.evaluate(() => document.body.innerText);
        debug.charge.size = bodyText.length;
        debug.charge.bodyPreview = bodyText.substring(0, 300);

        // Detectar HTML
        if (bodyText.toLowerCase().includes('<html') || 
            bodyText.toLowerCase().includes('<!doctype') ||
            bodyText.toLowerCase().includes('login') ||
            contentType.includes('text/html')) {
          debug.charge.isHtml = true;
          console.error('[Etapa9-B3] ⚠️ Charge retornou HTML (possível redirect/login)');
        }

        if (response?.ok() && contentType.includes('application/json')) {
          try {
            chargeData = JSON.parse(bodyText);
            console.log('[Etapa9-B3] ✅ Charge obtido (JSON válido)');
            console.log('[Etapa9-B3] Charge keys:', Object.keys(chargeData));

            if (chargeData?.pdf_url && !pdfUrl) {
              pdfUrl = chargeData.pdf_url;
              keysFound.push('charge.pdf_url');
              console.log('[Etapa9-B3] ✅ Encontrado: charge.pdf_url');
            }
            if (chargeData?.boleto_url && !pdfUrl) {
              pdfUrl = chargeData.boleto_url;
              keysFound.push('charge.boleto_url');
              console.log('[Etapa9-B3] ✅ Encontrado: charge.boleto_url');
            }
            if (chargeData?.document_url && !pdfUrl) {
              pdfUrl = chargeData.document_url;
              keysFound.push('charge.document_url');
              console.log('[Etapa9-B3] ✅ Encontrado: charge.document_url');
            }
          } catch (parseErr: any) {
            console.error('[Etapa9-B3] Falha ao parsear Charge JSON:', parseErr.message);
          }
        } else {
          console.error('[Etapa9-B3] Charge não é JSON válido. Status:', response?.status(), 'ContentType:', contentType);
        }
      } catch (err: any) {
        console.error('[Etapa9-B3] Charge erro:', err.message);
        debug.charge.status = 'ERROR';
      }

      // Determinar decision
      let decision = 'PDF_URL_NOT_FOUND';
      
      if (debug.summary.isHtml || debug.charge.isHtml) {
        decision = 'BFF_RETURNED_HTML_OR_LOGIN';
      } else if (pdfUrl) {
        decision = 'PDF_URL_FOUND';
      } else if (debug.summary.size === 0 && debug.charge.size === 0) {
        decision = 'JSON_EMPTY_OR_WRONG_IDS';
      }

      console.log('[Etapa9-B3] Decision:', decision);

      return res.json({
        ok: pdfUrl ? true : false,
        pdfUrl,
        keysFound,
        decision,
        debug
      });
    } catch (error: any) {
      console.error('[Etapa9-B3] Erro durante login/fetch:', error.message);

      return res.status(500).json({
        ok: false,
        decision: 'LOGIN_AND_FETCH_ERROR',
        error: error.message
      });
    } finally {
      await browser.close();
      console.log('[Etapa9-B3] Navegador fechado');
    }
  } catch (error: any) {
    console.error('[Etapa9-B3] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      decision: 'PANEL_LOGIN_AND_FETCH_ERROR',
      error: error.message
    });
  }
});

export default router;
