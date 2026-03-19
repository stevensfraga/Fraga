import { Router } from 'express';
import { chromium, Browser, BrowserContext } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const STORAGE_STATE_PATH = path.join(__dirname, '../panel.storageState.json');

/**
 * GET /api/test/panel/d1-proof
 * Testa acesso ao painel usando Playwright request context com storageState
 * 
 * CRITÉRIO DE ACEITE:
 * - httpStatus 200
 * - json parse OK
 * - sem 401/403
 */
router.get('/d1-proof', async (req, res) => {
  const correlationId = `d1-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  let browser: Browser | null = null;

  try {
    console.log(`[D1Proof] ${correlationId} Iniciando teste D1...`);

    // Verificar se storageState existe
    try {
      await fs.access(STORAGE_STATE_PATH);
      console.log(`[D1Proof] ${correlationId} storageState encontrado: ${STORAGE_STATE_PATH}`);
    } catch (error) {
      console.error(`[D1Proof] ${correlationId} storageState NÃO encontrado: ${STORAGE_STATE_PATH}`);
      return res.json({
        ok: false,
        httpStatus: 0,
        decision: 'NO_STORAGE_STATE',
        error: 'storageState.json não encontrado. Execute captura de sessão primeiro.',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }

    // Carregar storageState
    const storageStateData = await fs.readFile(STORAGE_STATE_PATH, 'utf8');
    const storageState = JSON.parse(storageStateData);

    console.log(`[D1Proof] ${correlationId} storageState carregado`);

    // Logar domínios
    const domainSet = new Set(storageState.cookies.map((c: any) => c.domain));
    const domains = Array.from(domainSet);
    console.log(`[D1Proof] ${correlationId} Domínios no storageState:`, domains);

    // Logar cookies para services.contaazul.com
    const servicesCookies = storageState.cookies.filter((c: any) => 
      c.domain.includes('contaazul.com')
    );
    console.log(`[D1Proof] ${correlationId} Cookies para contaazul.com:`, servicesCookies.length);
    console.log(`[D1Proof] ${correlationId} Nomes dos cookies:`, servicesCookies.map((c: any) => c.name));

    // Abrir browser com storageState
    console.log(`[D1Proof] ${correlationId} Abrindo browser...`);
    browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({ storageState: STORAGE_STATE_PATH });

    console.log(`[D1Proof] ${correlationId} Browser aberto com storageState`);

    // Criar request context
    const request = context.request;

    // Testar acesso ao painel
    const testUrl = 'https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/test/summary';

    console.log(`[D1Proof] ${correlationId} Testando acesso: ${testUrl}`);

    const response = await request.get(testUrl, {
      headers: {
        'Origin': 'https://pro.contaazul.com',
        'Referer': 'https://pro.contaazul.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
      },
      timeout: 30000,
    });

    const httpStatus = response.status();
    console.log(`[D1Proof] ${correlationId} HTTP Status: ${httpStatus}`);

    // Logar body (primeiros 200 chars)
    const bodyText = await response.text();
    console.log(`[D1Proof] ${correlationId} Body (200 chars):`, bodyText.substring(0, 200));

    // Verificar se houve redirect para login
    const finalUrl = response.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      console.warn(`[D1Proof] ${correlationId} REDIRECT para login detectado: ${finalUrl}`);
      await browser.close();
      return res.json({
        ok: false,
        httpStatus,
        decision: 'SESSION_EXPIRED',
        error: 'Sessão expirada - redirect para login',
        finalUrl,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }

    // Tentar parse JSON
    let responseJson: any = null;
    let responseKeys: string[] = [];
    try {
      responseJson = JSON.parse(bodyText);
      responseKeys = Object.keys(responseJson);
      console.log(`[D1Proof] ${correlationId} JSON parse OK, keys:`, responseKeys);
    } catch (error) {
      console.warn(`[D1Proof] ${correlationId} JSON parse FALHOU`);
    }

    await browser.close();

    // Critério de aceite
    if (httpStatus === 200) {
      return res.json({
        ok: true,
        httpStatus,
        responseKeys,
        session: 'storageState',
        notes: ['playwright_request_used'],
        decision: 'OK_PANEL_SESSION',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } else if (httpStatus === 401 || httpStatus === 403) {
      return res.json({
        ok: false,
        httpStatus,
        decision: 'SESSION_EXPIRED',
        error: `HTTP ${httpStatus} - Sessão inválida ou expirada`,
        bodyPreview: bodyText.substring(0, 200),
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.json({
        ok: false,
        httpStatus,
        decision: 'PANEL_AUTH_FAILED',
        error: `HTTP ${httpStatus} - Erro desconhecido`,
        bodyPreview: bodyText.substring(0, 200),
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    console.error(`[D1Proof] ${correlationId} Erro fatal:`, error.message);
    if (browser) {
      await browser.close();
    }
    return res.status(500).json({
      ok: false,
      decision: 'FATAL_ERROR',
      correlationId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
