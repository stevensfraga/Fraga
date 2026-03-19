/**
 * nfsePlaywrightHealth.ts
 * Health check do runtime Playwright para o módulo NFS-e.
 *
 * Valida:
 *  1. Playwright instalado (importação do módulo)
 *  2. Chromium disponível (executablePath resolvido)
 *  3. Browser lança corretamente (chromium.launch + newPage + close)
 *
 * Retorno:
 *  - status: "PLAYWRIGHT_RUNTIME_OK" | "PLAYWRIGHT_RUNTIME_FAIL"
 *  - chromiumVersion: string | null
 *  - executablePath: string | null
 *  - error: string | null
 *  - durationMs: number
 */

export interface PlaywrightHealthResult {
  status: "PLAYWRIGHT_RUNTIME_OK" | "PLAYWRIGHT_RUNTIME_FAIL";
  chromiumVersion: string | null;
  executablePath: string | null;
  error: string | null;
  durationMs: number;
  checkedAt: string;
}

export async function checkPlaywrightRuntime(): Promise<PlaywrightHealthResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();

  // 1. Verificar se Playwright está instalado
  let playwright: any;
  try {
    playwright = await import("playwright-core");
  } catch (e: any) {
    // Playwright não instalado
    return {
      status: "PLAYWRIGHT_RUNTIME_FAIL",
      chromiumVersion: null,
      executablePath: null,
      error: `Playwright não instalado: ${e.message}. Execute: pnpm add playwright && npx playwright install chromium`,
      durationMs: Date.now() - start,
      checkedAt,
    };
  }

  // 2. Resolver o caminho do executável usando o resolver com fallbacks
  let execPath: string | null = null;
  let launchOptions: any = null;
  try {
    const { getChromiumLaunchOptions } = await import("./nfseChromiumResolver.js");
    launchOptions = await getChromiumLaunchOptions();
    execPath = launchOptions.executablePath;
  } catch (e: any) {
    return {
      status: "PLAYWRIGHT_RUNTIME_FAIL",
      chromiumVersion: null,
      executablePath: null,
      error: e.message,
      durationMs: Date.now() - start,
      checkedAt,
    };
  }

  // 3. Tentar lançar o browser com as opções resolvidas
  let browser: any = null;
  try {
    browser = await playwright.chromium.launch(launchOptions);

    const version = browser.version();

    // Abrir página em branco para confirmar que o contexto funciona
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto("about:blank");
    await ctx.close();
    await browser.close();

    return {
      status: "PLAYWRIGHT_RUNTIME_OK",
      chromiumVersion: version,
      executablePath: execPath,
      error: null,
      durationMs: Date.now() - start,
      checkedAt,
    };
  } catch (e: any) {
    if (browser) {
      try { await browser.close(); } catch { /* ignorar */ }
    }
    return {
      status: "PLAYWRIGHT_RUNTIME_FAIL",
      chromiumVersion: null,
      executablePath: execPath,
      error: `Falha ao lançar Chromium: ${e.message}`,
      durationMs: Date.now() - start,
      checkedAt,
    };
  }
}
