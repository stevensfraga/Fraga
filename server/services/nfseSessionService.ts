/**
 * nfseSessionService.ts
 * Gerencia sessões persistentes do portal NFS-e de Vila Velha.
 *
 * Fluxo:
 * 1. captureSession(portalId): abre browser visível, usuário faz login manual → cookies salvos no banco
 * 2. getActiveSession(portalId): retorna cookies válidos para reutilização
 * 3. testSession(portalId): verifica se a sessão ainda é válida (acessa página protegida)
 * 4. invalidateSession(portalId): marca sessão como inválida
 */

import { chromium, type Browser, type BrowserContext, type Cookie } from "playwright";
import mysql from "mysql2/promise";

const PORTAL_URL = "https://tributacao.vilavelha.es.gov.br/tbw/loginCNPJContribuinte.jsp";
// Página protegida que só aparece após login — usada para testar sessão
const PORTAL_HOME_URL = "https://tributacao.vilavelha.es.gov.br/tbw/home.jsp";
// Tempo de expiração padrão: 30 dias
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionTestResult {
  ok: boolean;
  log: string[];
  screenshotBase64?: string;
  sessionId?: number;
  expiresAt?: number;
}

function getDb() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/**
 * Retorna a sessão ativa mais recente para o portal.
 * Retorna null se não houver sessão válida.
 */
export async function getActiveSession(portalId: number): Promise<{ id: number; cookies: Cookie[]; expiresAt: number } | null> {
  const conn = await getDb();
  try {
    const [rows] = await conn.execute<any[]>(
      `SELECT id, cookies_json, expires_at FROM nfse_sessions
       WHERE portal_id = ? AND is_valid = 1 AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY captured_at DESC LIMIT 1`,
      [portalId, Date.now()]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      cookies: JSON.parse(row.cookies_json) as Cookie[],
      expiresAt: row.expires_at || Date.now() + SESSION_TTL_MS,
    };
  } finally {
    await conn.end();
  }
}

/**
 * Salva cookies de sessão no banco.
 */
export async function saveSession(
  portalId: number,
  cookies: Cookie[],
  capturedBy?: string
): Promise<number> {
  const conn = await getDb();
  try {
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    // Invalida sessões anteriores
    await conn.execute(
      `UPDATE nfse_sessions SET is_valid = 0, updated_at = ? WHERE portal_id = ? AND is_valid = 1`,
      [now, portalId]
    );
    // Insere nova sessão
    const [result] = await conn.execute<any>(
      `INSERT INTO nfse_sessions (portal_id, cookies_json, captured_at, expires_at, captured_by, is_valid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [portalId, JSON.stringify(cookies), now, expiresAt, capturedBy || null, now, now]
    );
    return result.insertId;
  } finally {
    await conn.end();
  }
}

/**
 * Marca uma sessão como inválida (ex: após erro 401 ou redirect para login).
 */
export async function invalidateSession(sessionId: number): Promise<void> {
  const conn = await getDb();
  try {
    await conn.execute(
      `UPDATE nfse_sessions SET is_valid = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), sessionId]
    );
  } finally {
    await conn.end();
  }
}

/**
 * Aplica cookies de sessão em um contexto Playwright existente.
 */
export async function applySessionCookies(context: BrowserContext, cookies: Cookie[]): Promise<void> {
  await context.addCookies(cookies);
}

/**
 * Testa se a sessão atual ainda é válida navegando para uma página protegida.
 * Retorna log estruturado e screenshot.
 */
export async function testSession(portalId: number): Promise<SessionTestResult> {
  const log: string[] = [];
  const session = await getActiveSession(portalId);

  if (!session) {
    log.push("SESSION_NOT_FOUND: Nenhuma sessão ativa encontrada para este portal");
    return { ok: false, log };
  }

  log.push(`SESSION_FOUND: id=${session.id}, expires=${new Date(session.expiresAt).toISOString()}`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await applySessionCookies(context, session.cookies);
    const page = await context.newPage();

    log.push("BROWSER_OPEN: Browser aberto com cookies da sessão");

    // Navega para página protegida
    await page.goto(PORTAL_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    log.push(`NAVIGATE_OK: Navegou para ${PORTAL_HOME_URL}`);

    const currentUrl = page.url();
    log.push(`CURRENT_URL: ${currentUrl}`);

    // Verifica se foi redirecionado para login (sessão expirada)
    const isOnLoginPage =
      currentUrl.includes("login") ||
      currentUrl.includes("Login") ||
      (await page.$("input#usuario")) !== null;

    if (isOnLoginPage) {
      log.push("SESSION_EXPIRED: Redirecionado para página de login — sessão expirada");
      await invalidateSession(session.id);
      const screenshot = await page.screenshot({ type: "png" });
      await browser.close();
      return {
        ok: false,
        log,
        screenshotBase64: screenshot.toString("base64"),
        sessionId: session.id,
      };
    }

    // Verifica elementos que indicam login bem-sucedido
    const logoutLink = await page.$("a[href*='logout'], a[href*='Logout'], a[onclick*='logout']");
    const userMenu = await page.$(".user-name, .username, #usuario-logado, #nomeUsuario");
    const menuNfse = await page.$("a[href*='nfse'], a[href*='NFSE'], a[href*='NotaFiscal']");

    if (logoutLink || userMenu || menuNfse) {
      log.push("LOGIN_OK: Sessão válida — elementos de usuário logado detectados");
      if (userMenu) {
        const userName = await userMenu.textContent();
        log.push(`USER_DETECTED: ${userName?.trim()}`);
      }
    } else {
      // Tenta detectar pelo título da página ou conteúdo
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
      log.push(`PAGE_TITLE: ${title}`);
      log.push(`PAGE_CONTENT_PREVIEW: ${bodyText?.replace(/\n/g, " ")?.substring(0, 200)}`);

      // Se não está na página de login e tem conteúdo, considera válido
      if (!isOnLoginPage && bodyText && bodyText.length > 100) {
        log.push("SESSION_LIKELY_OK: Página carregada sem redirect para login");
      } else {
        log.push("SESSION_UNCERTAIN: Não foi possível confirmar estado da sessão");
      }
    }

    // Atualiza last_test_at
    const conn = await getDb();
    await conn.execute(
      `UPDATE nfse_sessions SET last_test_at = ?, last_test_ok = 1, last_used_at = ?, updated_at = ? WHERE id = ?`,
      [Date.now(), Date.now(), Date.now(), session.id]
    );
    await conn.end();

    const screenshot = await page.screenshot({ type: "png" });
    await browser.close();

    return {
      ok: true,
      log,
      screenshotBase64: screenshot.toString("base64"),
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  } catch (err: any) {
    log.push(`ERROR: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return { ok: false, log, sessionId: session?.id };
  }
}

/**
 * Abre o portal em modo HEADLESS=false (visível) para captura manual de sessão.
 * O usuário faz login, resolve o CAPTCHA, e os cookies são capturados automaticamente.
 *
 * NOTA: Este método requer que o servidor tenha display (ou use xvfb).
 * Para uso em servidor headless, use o modo de "captura remota" via endpoint dedicado.
 */
export async function captureSessionHeaded(
  portalId: number,
  capturedBy?: string,
  timeoutMs = 120000
): Promise<{ ok: boolean; sessionId?: number; log: string[] }> {
  const log: string[] = [];
  log.push("CAPTURE_START: Abrindo browser para captura manual de sessão");

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    log.push(`PORTAL_OPEN: Portal aberto em ${PORTAL_URL}`);
    log.push("WAITING_LOGIN: Aguardando login manual do usuário...");

    // Aguarda o usuário fazer login (detecta quando sai da página de login)
    await page.waitForFunction(
      () => !window.location.href.includes("login") && !window.location.href.includes("Login"),
      { timeout: timeoutMs }
    );

    log.push("LOGIN_DETECTED: Login detectado — capturando cookies");

    const cookies = await context.cookies();
    const sessionId = await saveSession(portalId, cookies, capturedBy);

    log.push(`SESSION_SAVED: id=${sessionId}, cookies=${cookies.length}`);
    await browser.close();

    return { ok: true, sessionId, log };
  } catch (err: any) {
    log.push(`ERROR: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return { ok: false, log };
  }
}

/**
 * Captura sessão via cookies fornecidos manualmente (para uso em servidor headless).
 * O usuário exporta os cookies do browser e os fornece via API.
 */
export async function captureSessionFromCookies(
  portalId: number,
  cookies: Cookie[],
  capturedBy?: string
): Promise<{ ok: boolean; sessionId: number; log: string[] }> {
  const log: string[] = [];
  log.push(`CAPTURE_FROM_COOKIES: Salvando ${cookies.length} cookies fornecidos manualmente`);

  const sessionId = await saveSession(portalId, cookies, capturedBy);
  log.push(`SESSION_SAVED: id=${sessionId}`);

  // Testa imediatamente a sessão
  const testResult = await testSession(portalId);
  log.push(...testResult.log.map((l) => `TEST_${l}`));

  return { ok: testResult.ok, sessionId, log };
}

/**
 * Retorna o status de todas as sessões de um portal.
 */
export async function getSessionStatus(portalId: number): Promise<{
  hasActiveSession: boolean;
  sessionId?: number;
  capturedAt?: number;
  expiresAt?: number;
  lastTestOk?: boolean;
  lastTestAt?: number;
  daysUntilExpiry?: number;
}> {
  const conn = await getDb();
  try {
    const [rows] = await conn.execute<any[]>(
      `SELECT id, captured_at, expires_at, last_test_ok, last_test_at
       FROM nfse_sessions
       WHERE portal_id = ? AND is_valid = 1 AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY captured_at DESC LIMIT 1`,
      [portalId, Date.now()]
    );

    if (!rows.length) {
      return { hasActiveSession: false };
    }

    const row = rows[0];
    const daysUntilExpiry = row.expires_at
      ? Math.floor((row.expires_at - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      hasActiveSession: true,
      sessionId: row.id,
      capturedAt: row.captured_at,
      expiresAt: row.expires_at,
      lastTestOk: row.last_test_ok === 1,
      lastTestAt: row.last_test_at,
      daysUntilExpiry: daysUntilExpiry ?? undefined,
    };
  } finally {
    await conn.end();
  }
}
