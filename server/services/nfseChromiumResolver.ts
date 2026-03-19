// nfseChromiumResolver.ts
//
// Resolve o executablePath do Chromium com multiplos fallbacks:
//  1. @sparticuz/chromium (estatico, sem shared libs — funciona em qualquer container)
//  2. Playwright cache: ~/.cache/ms-playwright/chromium-[versao]/chrome-linux64/chrome
//  3. Candidatos do sistema: /usr/bin/chromium-browser, etc.
//
// A prioridade e para @sparticuz/chromium porque ele NAO depende de
// libglib-2.0.so.0, libnss3, libatk, etc. — funciona em containers serverless.

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import os from "os";

// ── @sparticuz/chromium (fonte primaria) ──────────────────────────
let sparticuzChromium: any = null;
try {
  sparticuzChromium = require("@sparticuz/chromium");
} catch {
  // Pacote nao instalado — continuar com fallbacks
}

const SYSTEM_CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/local/bin/chromium",
  "/snap/bin/chromium",
];

function findPlaywrightChromium(): string | null {
  try {
    const cacheDir = join(os.homedir(), ".cache", "ms-playwright");
    if (!existsSync(cacheDir)) return null;

    const entries = readdirSync(cacheDir)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse();

    for (const entry of entries) {
      const candidate = join(cacheDir, entry, "chrome-linux64", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // ignorar erros de leitura de diretorio
  }
  return null;
}

/**
 * Resolve o executablePath do Chromium.
 * Prioridade: @sparticuz/chromium > Playwright cache > sistema
 *
 * @sparticuz/chromium retorna uma Promise — por isso esta funcao e async.
 */
export async function resolveChromiumExecutable(): Promise<string> {
  // 1. @sparticuz/chromium (estatico, sem shared libs)
  if (sparticuzChromium) {
    try {
      const execPath = await sparticuzChromium.executablePath();
      if (execPath && existsSync(execPath)) {
        console.log(`[ChromiumResolver] Usando @sparticuz/chromium: ${execPath}`);
        return execPath;
      }
    } catch (err: any) {
      console.warn(`[ChromiumResolver] @sparticuz/chromium falhou: ${err.message}`);
    }
  }

  // 2. Playwright cache
  const playwrightPath = findPlaywrightChromium();
  if (playwrightPath) {
    console.log(`[ChromiumResolver] Usando Playwright cache: ${playwrightPath}`);
    return playwrightPath;
  }

  // 3. Candidatos do sistema
  for (const candidate of SYSTEM_CANDIDATES) {
    if (existsSync(candidate)) {
      console.log(`[ChromiumResolver] Usando sistema: ${candidate}`);
      return candidate;
    }
  }

  const tried = ["@sparticuz/chromium", "Playwright cache", ...SYSTEM_CANDIDATES].join(", ");
  throw new Error(
    `Chromium nao encontrado. Tentados: ${tried}. ` +
    `Instale: pnpm add @sparticuz/chromium`
  );
}

/**
 * Retorna as opcoes de launch para o Playwright.
 * Usa @sparticuz/chromium.args quando disponivel (otimizado para serverless).
 */
export async function getChromiumLaunchOptions(): Promise<{
  executablePath: string;
  headless: boolean;
  args: string[];
}> {
  const executablePath = await resolveChromiumExecutable();

  // @sparticuz/chromium fornece args otimizados para serverless
  const sparticuzArgs = sparticuzChromium?.args || [];

  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--single-process",
  ];

  // Mesclar args: sparticuz args + base args (sem duplicatas)
  const allArgs = Array.from(new Set([...sparticuzArgs, ...baseArgs]));

  return {
    executablePath,
    headless: true,
    args: allArgs,
  };
}

/**
 * Retorna informacoes de diagnostico do runtime Chromium.
 */
export async function getChromiumDiagnostics(): Promise<{
  source: string;
  executablePath: string;
  sparticuzAvailable: boolean;
  sparticuzVersion: string | null;
  playwrightCachePath: string | null;
  systemCandidates: Array<{ path: string; exists: boolean }>;
}> {
  let source = "none";
  let execPath = "";
  let sparticuzVersion: string | null = null;

  // Check @sparticuz/chromium
  if (sparticuzChromium) {
    try {
      execPath = await sparticuzChromium.executablePath();
      source = "@sparticuz/chromium";
      try {
        const pkg = require("@sparticuz/chromium/package.json");
        sparticuzVersion = pkg.version || null;
      } catch {}
    } catch {}
  }

  // Check Playwright cache
  const playwrightCachePath = findPlaywrightChromium();
  if (!execPath && playwrightCachePath) {
    execPath = playwrightCachePath;
    source = "playwright-cache";
  }

  // Check system
  if (!execPath) {
    for (const candidate of SYSTEM_CANDIDATES) {
      if (existsSync(candidate)) {
        execPath = candidate;
        source = "system";
        break;
      }
    }
  }

  return {
    source,
    executablePath: execPath,
    sparticuzAvailable: !!sparticuzChromium,
    sparticuzVersion,
    playwrightCachePath,
    systemCandidates: SYSTEM_CANDIDATES.map((p) => ({ path: p, exists: existsSync(p) })),
  };
}
