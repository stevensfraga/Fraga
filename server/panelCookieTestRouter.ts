import { Router } from 'express';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

/**
 * GET /api/test/panel/cookie-test
 * Testa acesso ao painel com cookies capturados
 */
router.get('/cookie-test', async (req, res) => {
  const correlationId = `cookie-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    console.log(`[CookieTest] ${correlationId} Carregando cookies...`);

    // Carregar cookies
    const cookiesPath = path.join(__dirname, '../.panel-cookies.json');
    const cookiesData = await fs.readFile(cookiesPath, 'utf8');
    const { cookies } = JSON.parse(cookiesData);

    // Montar cookie string
    const cookieString = cookies
      .map((c: any) => `${c.name}=${c.value}`)
      .join('; ');

    console.log(`[CookieTest] ${correlationId} Cookies carregados:`, cookies.map((c: any) => c.name));

    // Testar acesso ao painel
    const testUrl = 'https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/test/summary';

    console.log(`[CookieTest] ${correlationId} Testando acesso: ${testUrl}`);

    const response = await axios.get(testUrl, {
      headers: {
        'Cookie': cookieString,
        'Origin': 'https://pro.contaazul.com',
        'Referer': 'https://pro.contaazul.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log(`[CookieTest] ${correlationId} Acesso OK: ${response.status}`);

    return res.json({
      ok: true,
      httpStatus: response.status,
      usedCookies: cookies.map((c: any) => c.name),
      decision: 'OK_PANEL_SESSION',
      correlationId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const httpStatus = error.response?.status || 0;
    const errorMsg = error.response?.data?.message || error.message;

    console.error(`[CookieTest] ${correlationId} Acesso FALHOU: ${httpStatus}`);
    console.error(`[CookieTest] ${correlationId} Erro:`, errorMsg);

    // Logar 401 completo
    if (httpStatus === 401 || httpStatus === 403) {
      const headers = error.response?.headers || {};
      const data = error.response?.data || {};

      console.error(`[CookieTest] ${correlationId} Response Headers:`, JSON.stringify(headers, null, 2));
      console.error(`[CookieTest] ${correlationId} Response Data:`, JSON.stringify(data, null, 2));
    }

    return res.json({
      ok: false,
      httpStatus,
      usedCookies: [],
      decision: httpStatus === 401 || httpStatus === 403 ? 'SESSION_EXPIRED' : 'PANEL_AUTH_FAILED',
      error: errorMsg,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
