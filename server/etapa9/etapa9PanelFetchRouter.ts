/**
 * ETAPA 9.1 — PASSO 9.1-B: PANEL FETCH (WEB SESSION)
 * 
 * Endpoint: GET /api/test/etapa9/r7/panel-fetch
 * 
 * Objetivo:
 *   Usar Playwright + storageState para fazer fetch do painel
 *   Extrair pdf_url/boleto_url do JSON de resposta
 */

import express from 'express';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const SERVICES_BASE = 'https://services.contaazul.com';
const STORAGE_DIR = path.join(process.cwd(), 'server', '.panel');
const STORAGE_STATE_PATH = path.join(STORAGE_DIR, 'contaazul.storageState.json');

/**
 * GET /api/test/etapa9/r7/panel-fetch
 * 
 * Fetch dados do painel usando Playwright + storageState
 */
router.get('/panel-fetch', async (req, res) => {
  try {
    console.log('[Etapa9-B] Iniciando panel-fetch...');

    // IDs da venda R7
    const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
    const chargeRequestId = '84f71eca-0a9d-11f1-b160-d71ec57e576b';

    console.log('[Etapa9-B] financialEventId:', financialEventId);
    console.log('[Etapa9-B] chargeRequestId:', chargeRequestId);

    // Endpoints do painel
    const summaryUrl = `${SERVICES_BASE}/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`;
    const chargeUrl = `${SERVICES_BASE}/finance-pro/v1/charge-requests/${chargeRequestId}`;

    console.log('[Etapa9-B] Summary URL:', summaryUrl);
    console.log('[Etapa9-B] Charge URL:', chargeUrl);

    // Carregar storageState do disco
    console.log('[Etapa9-B] Carregando storageState...');
    let storageState: any = null;

    if (!fs.existsSync(STORAGE_STATE_PATH)) {
      console.error('[Etapa9-B] StorageState não encontrado');

      return res.status(401).json({
        ok: false,
        error: 'Web session não gerada',
        decision: 'WEB_SESSION_EXPIRED',
        nextAction: 'RUN_PANEL_LOGIN_SESSION',
        message: 'Execute: GET /api/test/etapa9/r7/panel-login-session'
      });
    }

    try {
      const storageContent = fs.readFileSync(STORAGE_STATE_PATH, 'utf-8');
      storageState = JSON.parse(storageContent);
      console.log('[Etapa9-B] StorageState carregado:', storageState.cookies?.length, 'cookies');
    } catch (parseErr: any) {
      console.error('[Etapa9-B] Falha ao parsear storageState:', parseErr.message);

      return res.status(500).json({
        ok: false,
        error: 'StorageState inválido',
        decision: 'STORAGE_STATE_INVALID'
      });
    }

    // Importar Playwright
    let playwright: any;
    try {
      const mod = await import('playwright');
      playwright = mod.default || mod;
      console.log('[Etapa9-B] Playwright importado');
    } catch (err: any) {
      console.error('[Etapa9-B] Playwright não disponível:', err.message);

      return res.status(500).json({
        ok: false,
        error: 'Playwright não disponível',
        decision: 'PLAYWRIGHT_NOT_AVAILABLE'
      });
    }

    // Usar Playwright com storageState
    console.log('[Etapa9-B] Iniciando navegador com storageState...');
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    let summaryData: any = null;
    let chargeData: any = null;
    let pdfUrl: string | null = null;
    let keysFound: string[] = [];

    try {
      // Fetch Summary
      try {
        console.log('[Etapa9-B] Fazendo GET /summary...');
        const response = await page.goto(summaryUrl, { waitUntil: 'networkidle', timeout: 30000 });

        if (!response?.ok()) {
          throw new Error(`HTTP ${response?.status()}`);
        }

        // Extrair JSON da resposta
        const jsonText = await page.evaluate(() => document.body.innerText);
        summaryData = JSON.parse(jsonText);
        console.log('[Etapa9-B] Summary obtido (HTTP 200)');

        // Procurar por pdf_url
        if (summaryData?.pdf_url) {
          pdfUrl = summaryData.pdf_url;
          keysFound.push('summary.pdf_url');
          console.log('[Etapa9-B] Encontrado: pdf_url');
        }
        if (summaryData?.boleto_url && !pdfUrl) {
          pdfUrl = summaryData.boleto_url;
          keysFound.push('summary.boleto_url');
          console.log('[Etapa9-B] Encontrado: boleto_url');
        }
      } catch (summaryErr: any) {
        console.error('[Etapa9-B] Summary falhou:', summaryErr.message);

        if (summaryErr.message.includes('401') || summaryErr.message.includes('403')) {
          throw new Error('WEB_SESSION_EXPIRED');
        }
      }

      // Fetch Charge Request
      try {
        console.log('[Etapa9-B] Fazendo GET /charge-requests...');
        const response = await page.goto(chargeUrl, { waitUntil: 'networkidle', timeout: 30000 });

        if (!response?.ok()) {
          throw new Error(`HTTP ${response?.status()}`);
        }

        const jsonText = await page.evaluate(() => document.body.innerText);
        chargeData = JSON.parse(jsonText);
        console.log('[Etapa9-B] Charge obtido (HTTP 200)');

        // Procurar por pdf_url
        if (chargeData?.pdf_url && !pdfUrl) {
          pdfUrl = chargeData.pdf_url;
          keysFound.push('charge.pdf_url');
          console.log('[Etapa9-B] Encontrado: charge.pdf_url');
        }
        if (chargeData?.boleto_url && !pdfUrl) {
          pdfUrl = chargeData.boleto_url;
          keysFound.push('charge.boleto_url');
          console.log('[Etapa9-B] Encontrado: charge.boleto_url');
        }
      } catch (chargeErr: any) {
        console.error('[Etapa9-B] Charge falhou:', chargeErr.message);

        if (chargeErr.message.includes('401') || chargeErr.message.includes('403')) {
          throw new Error('WEB_SESSION_EXPIRED');
        }
      }

      // Validar se encontrou PDF URL
      if (!pdfUrl) {
        console.error('[Etapa9-B] Nenhuma URL de PDF encontrada');

        return res.status(404).json({
          ok: false,
          error: 'PDF URL não encontrada nos dados do painel',
          decision: 'PDF_URL_NOT_FOUND',
          keysFound,
          summaryDataKeys: Object.keys(summaryData || {}),
          chargeDataKeys: Object.keys(chargeData || {}),
        });
      }

      console.log('[Etapa9-B] PDF URL encontrada:', pdfUrl.substring(0, 50) + '...');

      return res.json({
        ok: true,
        pdfUrl,
        keysFound,
        decision: 'PDF_URL_FOUND',
        nextAction: 'DOWNLOAD_PDF',
        message: 'PDF URL extraída do painel. Próximo: panel-download-pdf'
      });
    } catch (error: any) {
      console.error('[Etapa9-B] Erro durante fetch:', error.message);

      if (error.message === 'WEB_SESSION_EXPIRED') {
        return res.status(401).json({
          ok: false,
          error: 'Web session expirada',
          decision: 'WEB_SESSION_EXPIRED',
          nextAction: 'RUN_PANEL_LOGIN_SESSION',
          message: 'Execute: GET /api/test/etapa9/r7/panel-login-session'
        });
      }

      return res.status(500).json({
        ok: false,
        error: error.message,
        decision: 'PANEL_FETCH_ERROR'
      });
    } finally {
      await browser.close();
      console.log('[Etapa9-B] Navegador fechado');
    }
  } catch (error: any) {
    console.error('[Etapa9-B] Erro geral:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message,
      decision: 'PANEL_FETCH_ERROR'
    });
  }
});

export default router;
