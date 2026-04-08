/**
 * NFS-e StorageState Service
 *
 * Gerencia o storageState do Playwright para sessões persistentes no portal de Vila Velha.
 * O storageState inclui cookies + localStorage, sendo mais robusto que cookies isolados.
 *
 * Fluxo:
 * 1. Usuário faz login manual no portal (via browser exposto ou extensão)
 * 2. O storageState é capturado e salvo criptografado no banco
 * 3. O motor de emissão carrega o storageState e navega direto para a área logada
 * 4. Se a sessão expirar, o sistema notifica para nova captura
 */

import mysql from "mysql2/promise";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";

const ENCRYPTION_KEY = process.env.JWT_SECRET?.substring(0, 32).padEnd(32, "0") || "fraga-nfse-secret-key-32chars!!!";

// Diretório para storageState em disco (backup/fallback)
const STORAGE_STATE_DIR = path.join(process.cwd(), "storage", "nfse");

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

async function rawExec(sql: string, params: any[] = []): Promise<any> {
  const conn = await getConn();
  try {
    const [result] = await conn.execute(sql, params);
    return result;
  } finally {
    await conn.end();
  }
}

function encryptData(data: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function decryptData(ciphertext: string): string {
  try {
    if (!ciphertext || !ciphertext.includes(":")) return ciphertext;
    const [ivHex, encrypted] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return ciphertext;
  }
}

export interface StorageStateData {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }>;
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

// ─── Salvar storageState no banco ─────────────────────────────────

export async function saveStorageState(
  portalId: number,
  storageState: StorageStateData,
  capturedBy: string = "manual"
): Promise<void> {
  const now = Date.now();
  // Sessão válida por 30 dias
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

  // Criptografar o storageState completo
  const stateJson = JSON.stringify(storageState);
  const encryptedState = encryptData(stateJson);

  // Extrair cookies para referência rápida (sem criptografar)
  const cookieNames = storageState.cookies.map(c => c.name).join(", ");
  const sessionCookie = storageState.cookies.find(c =>
    c.name.toLowerCase().includes("session") ||
    c.name.toLowerCase().includes("jsession") ||
    c.name.toLowerCase().includes("phpsessid") ||
    c.name.toLowerCase().includes("token")
  );

  // Verificar se já existe sessão para este portal
  const existing = await rawQuery(
    "SELECT id FROM nfse_sessions WHERE portal_id = ? LIMIT 1",
    [portalId]
  );

  if (existing.length > 0) {
    // Atualizar sessão existente
    await rawExec(
      `UPDATE nfse_sessions SET 
         storage_state = ?, cookies_json = ?, captured_at = ?, expires_at = ?,
         last_test_ok = 1, last_test_at = ?, is_valid = 1, updated_at = ?
       WHERE portal_id = ?`,
      [encryptedState, encryptedState, now, expiresAt, now, now, portalId]
    );
  } else {
    // Inserir nova sessão
    await rawExec(
      `INSERT INTO nfse_sessions (portal_id, storage_state, cookies_json, captured_at, expires_at, last_test_ok, last_test_at, is_valid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`,
      [portalId, encryptedState, encryptedState, now, expiresAt, now, now, now]
    );
  }

  // Salvar também em disco como backup (não criptografado, apenas para debug local)
  try {
    await fs.mkdir(STORAGE_STATE_DIR, { recursive: true });
    const filePath = path.join(STORAGE_STATE_DIR, `vilavelha-state-${portalId}.json`);
    await fs.writeFile(filePath, stateJson, "utf8");
    console.log(`[NfseStorageState] StorageState salvo em disco: ${filePath}`);
  } catch (err: any) {
    console.warn(`[NfseStorageState] Aviso: não foi possível salvar em disco: ${err.message}`);
  }

  console.log(`[NfseStorageState] Sessão salva para portal ${portalId}. Cookies: ${cookieNames}. Expira em: ${new Date(expiresAt).toLocaleDateString("pt-BR")}`);
}

// ─── Carregar storageState do banco ───────────────────────────────

export async function loadStorageState(portalId: number): Promise<StorageStateData | null> {
  const now = Date.now();
  const rows = await rawQuery(
    `SELECT * FROM nfse_sessions WHERE portal_id = ? AND is_valid = 1 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [portalId, now]
  );

  if (rows.length === 0) {
    // Tentar carregar do disco como fallback
    try {
      const filePath = path.join(STORAGE_STATE_DIR, `vilavelha-state-${portalId}.json`);
      const content = await fs.readFile(filePath, "utf8");
      const state = JSON.parse(content) as StorageStateData;
      console.log(`[NfseStorageState] StorageState carregado do disco (fallback)`);
      return state;
    } catch {
      return null;
    }
  }

  const row = rows[0] as any;
  try {
    // Tentar ler da coluna storage_state primeiro, depois cookies_json como fallback
    const rawData = row.storage_state || row.cookies_json || row.cookies;
    if (!rawData) {
      console.error(`[NfseStorageState] Nenhum dado de sessão encontrado nas colunas`);
      return null;
    }
    // Tentar descriptografar (pode estar criptografado ou em plain JSON)
    let stateJson: string;
    if (rawData.includes(':') && !rawData.startsWith('{')) {
      // Parece estar criptografado
      stateJson = decryptData(rawData);
    } else {
      // Plain JSON (salvo pelo script de captura)
      stateJson = rawData;
    }
    const state = JSON.parse(stateJson) as StorageStateData;
    return state;
  } catch (err: any) {
    console.error(`[NfseStorageState] Erro ao carregar storageState:`, err.message);
    return null;
  }
}

// ─── Aplicar storageState no contexto Playwright ──────────────────

export async function applyStorageState(context: any, state: StorageStateData): Promise<void> {
  // Adicionar cookies
  if (state.cookies && state.cookies.length > 0) {
    await context.addCookies(state.cookies);
  }

  // Adicionar localStorage (se disponível)
  if (state.origins && state.origins.length > 0) {
    for (const origin of state.origins) {
      if (origin.localStorage && origin.localStorage.length > 0) {
        try {
          const page = await context.newPage();
          await page.goto(origin.origin, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
          await page.evaluate((items: Array<{ name: string; value: string }>) => {
            for (const item of items) {
              try { localStorage.setItem(item.name, item.value); } catch {}
            }
          }, origin.localStorage);
          await page.close();
        } catch { /* ignora erros de localStorage */ }
      }
    }
  }
}

// ─── Capturar storageState via Playwright (headful) ───────────────

export async function captureStorageStateViaPlaywright(
  portalId: number,
  portalUrl: string,
  usuario: string,
  senha: string
): Promise<{ success: boolean; error?: string; screenshotBase64?: string }> {
  let browser: any = null;

  try {
    const playwright = await import("playwright");

    browser = await playwright.chromium.launch({
      headless: false, // HEADFUL para mostrar ao usuário
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "pt-BR",
    });

    const page = await context.newPage();
    await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Preencher usuário e senha (mas não o CAPTCHA — usuário precisa resolver)
    await page.fill("#usuario", usuario).catch(() => {});
    await page.fill("#senha", senha).catch(() => {});

    // Aguardar até 5 minutos para o usuário resolver o CAPTCHA e fazer login
    console.log(`[NfseStorageState] Aguardando login manual (CAPTCHA). Usuário: ${usuario}`);

    // Detectar quando o usuário fez login (URL muda para fora do login)
    await page.waitForFunction(
      () => !window.location.href.includes("login") && !window.location.href.includes("Login"),
      { timeout: 5 * 60 * 1000 } // 5 minutos
    );

    // Capturar storageState
    const state = await context.storageState();

    await saveStorageState(portalId, state as StorageStateData, "playwright-capture");

    return { success: true };

  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// ─── Verificar validade da sessão ─────────────────────────────────

export async function getSessionStatus(portalId: number): Promise<{
  hasSession: boolean;
  expiresAt?: number;
  daysRemaining?: number;
  capturedBy?: string;
  capturedAt?: number;
}> {
  const now = Date.now();
  const rows = await rawQuery(
    `SELECT * FROM nfse_sessions WHERE portal_id = ? AND is_valid = 1 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [portalId, now]
  );

  if (rows.length === 0) {
    return { hasSession: false };
  }

  const row = rows[0] as any;
  const daysRemaining = Math.floor((row.expires_at - now) / (1000 * 60 * 60 * 24));

  return {
    hasSession: true,
    expiresAt: row.expires_at,
    daysRemaining,
    capturedBy: row.captured_by,
    capturedAt: row.created_at,
  };
}

// ─── Invalidar sessão ─────────────────────────────────────────────

export async function invalidateStorageState(portalId: number): Promise<void> {
  await rawExec(
    "UPDATE nfse_sessions SET is_valid = 0 WHERE portal_id = ?",
    [portalId]
  );

  // Remover arquivo em disco
  try {
    const filePath = path.join(STORAGE_STATE_DIR, `vilavelha-state-${portalId}.json`);
    await fs.unlink(filePath).catch(() => {});
  } catch {}
}
