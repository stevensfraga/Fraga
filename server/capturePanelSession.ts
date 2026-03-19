/**
 * Script de Captura de Sessão do Painel Conta Azul
 * 
 * Fluxo:
 * 1. Abrir https://pro.contaazul.com (headful para login manual)
 * 2. Usuário faz login manualmente
 * 3. Após login, salvar cookies e storageState
 * 4. Extrair cookies do domínio services.contaazul.com
 * 5. Detectar Authorization Bearer se existir
 * 6. Salvar storageState.json criptografado
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORAGE_STATE_PATH = path.join(__dirname, '../.panel-session.json');
const ENCRYPTION_KEY = process.env.PANEL_SESSION_KEY || 'default-key-change-me';

interface PanelSessionData {
  cookies: any[];
  origins: any[];
  timestamp: number;
  expiresAt: number;
}

/**
 * Criptografar dados da sessão
 */
function encryptSession(data: PanelSessionData): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Descriptografar dados da sessão
 */
export function decryptSession(encrypted: string): PanelSessionData | null {
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[PanelSession] Erro ao descriptografar sessão:', error);
    return null;
  }
}

/**
 * Capturar sessão do painel com login manual assistido
 */
export async function capturePanelSession(): Promise<void> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    console.log('[PanelSession] Iniciando captura de sessão do painel...');
    console.log('[PanelSession] Abrindo navegador (headful para login manual)...');

    // Abrir navegador em modo headful
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Navegar para o painel
    console.log('[PanelSession] Navegando para https://pro.contaazul.com...');
    await page.goto('https://pro.contaazul.com', { waitUntil: 'networkidle' });

    console.log('[PanelSession] ========================================');
    console.log('[PanelSession] POR FAVOR, FAÇA LOGIN MANUALMENTE');
    console.log('[PanelSession] Após o login, pressione ENTER aqui no terminal');
    console.log('[PanelSession] ========================================');

    // Aguardar usuário pressionar ENTER
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });

    console.log('[PanelSession] Login confirmado! Capturando sessão...');

    // Salvar storageState
    const storageState = await context.storageState();

    // Extrair cookies
    const allCookies = storageState.cookies;
    const servicesCookies = allCookies.filter((c) =>
      c.domain.includes('contaazul.com')
    );

    console.log('[PanelSession] Cookies capturados:');
    console.log('[PanelSession] Total de cookies:', allCookies.length);
    console.log('[PanelSession] Cookies do domínio contaazul.com:', servicesCookies.length);
    console.log('[PanelSession] Nomes dos cookies:');
    servicesCookies.forEach((c) => {
      console.log(`[PanelSession]   - ${c.name} (domain: ${c.domain}, secure: ${c.secure}, httpOnly: ${c.httpOnly})`);
    });

    // Detectar Authorization Bearer
    let hasAuthorizationBearer = false;
    page.on('request', (request) => {
      const authHeader = request.headers()['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        hasAuthorizationBearer = true;
        console.log('[PanelSession] Detectado Authorization Bearer:', authHeader.substring(0, 30) + '...');
      }
    });

    // Fazer uma request de teste para capturar headers
    try {
      console.log('[PanelSession] Fazendo request de teste para capturar headers...');
      await page.goto('https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/test/summary', {
        waitUntil: 'networkidle',
        timeout: 10000,
      });
    } catch (e) {
      console.log('[PanelSession] Request de teste falhou (esperado), mas headers foram capturados');
    }

    // Preparar dados da sessão
    const sessionData: PanelSessionData = {
      cookies: servicesCookies,
      origins: storageState.origins,
      timestamp: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hora
    };

    // Criptografar e salvar
    const encrypted = encryptSession(sessionData);
    await fs.writeFile(STORAGE_STATE_PATH, encrypted, 'utf8');

    console.log('[PanelSession] ========================================');
    console.log('[PanelSession] SESSÃO CAPTURADA COM SUCESSO!');
    console.log('[PanelSession] Arquivo salvo em:', STORAGE_STATE_PATH);
    console.log('[PanelSession] Authorization Bearer detectado:', hasAuthorizationBearer);
    console.log('[PanelSession] Cookies salvos:', servicesCookies.length);
    console.log('[PanelSession] Expira em: 1 hora');
    console.log('[PanelSession] ========================================');

    await browser.close();
  } catch (error: any) {
    console.error('[PanelSession] Erro ao capturar sessão:', error.message);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

/**
 * Carregar sessão salva
 */
export async function loadPanelSession(): Promise<PanelSessionData | null> {
  try {
    const encrypted = await fs.readFile(STORAGE_STATE_PATH, 'utf8');
    const sessionData = decryptSession(encrypted);

    if (!sessionData) {
      console.error('[PanelSession] Falha ao descriptografar sessão');
      return null;
    }

    // Verificar se expirou
    if (sessionData.expiresAt < Date.now()) {
      console.warn('[PanelSession] Sessão expirada');
      return null;
    }

    console.log('[PanelSession] Sessão carregada com sucesso');
    console.log('[PanelSession] Cookies:', sessionData.cookies.length);
    console.log('[PanelSession] Expira em:', new Date(sessionData.expiresAt).toISOString());

    return sessionData;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn('[PanelSession] Arquivo de sessão não encontrado');
    } else {
      console.error('[PanelSession] Erro ao carregar sessão:', error.message);
    }
    return null;
  }
}

/**
 * Invalidar sessão
 */
export async function invalidatePanelSession(): Promise<void> {
  try {
    await fs.unlink(STORAGE_STATE_PATH);
    console.log('[PanelSession] Sessão invalidada');
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error('[PanelSession] Erro ao invalidar sessão:', error.message);
    }
  }
}

// Auto-execução removida — causava crash em produção (Playwright sem X Server)
// Para executar manualmente: npx tsx server/capturePanelSession.ts
