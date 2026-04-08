import mysql from 'mysql2/promise';
import { storagePut } from '../storage';

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export interface EmissionLogEntry {
  emissaoId: number;
  step: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  payload?: any;
  screenshot_url?: string;
  html_url?: string;
  error_details?: string;
}

/**
 * Registra log detalhado de uma etapa da emissão NFS-e
 */
export async function logEmissionStep(entry: EmissionLogEntry): Promise<void> {
  const conn = await getConn();
  try {
    await conn.execute(
      `INSERT INTO nfse_emissao_logs (
        emissaoId, step, status, message, payload, screenshot_url, html_url, error_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.emissaoId,
        entry.step,
        entry.status,
        entry.message,
        entry.payload ? JSON.stringify(entry.payload) : null,
        entry.screenshot_url || null,
        entry.html_url || null,
        entry.error_details || null
      ]
    );
    
    console.log(`[NfseLogger] Step logged: ${entry.step} (${entry.status})`);
  } catch (err: any) {
    console.error(`[NfseLogger] Erro ao registrar log: ${err.message}`);
  } finally {
    await conn.end();
  }
}

/**
 * Captura screenshot e salva no S3, retornando a URL
 */
export async function captureAndSaveScreenshot(
  page: any,
  emissaoId: number,
  step: string
): Promise<string | undefined> {
  try {
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const suffix = Math.random().toString(36).substring(2, 8);
    const fileKey = `nfse-debug/emissao-${emissaoId}-${step}-${suffix}.png`;
    const { url } = await storagePut(fileKey, screenshotBuffer, 'image/png');
    console.log(`[NfseLogger] Screenshot salvo: ${url}`);
    return url;
  } catch (err: any) {
    console.warn(`[NfseLogger] Erro ao salvar screenshot: ${err.message}`);
    return undefined;
  }
}

/**
 * Captura HTML da página e salva no S3, retornando a URL
 */
export async function captureAndSaveHtml(
  page: any,
  emissaoId: number,
  step: string
): Promise<string | undefined> {
  try {
    const htmlContent = await page.content();
    const htmlBuffer = Buffer.from(htmlContent, 'utf-8');
    const suffix = Math.random().toString(36).substring(2, 8);
    const fileKey = `nfse-debug/emissao-${emissaoId}-${step}-${suffix}.html`;
    const { url } = await storagePut(fileKey, htmlBuffer, 'text/html');
    console.log(`[NfseLogger] HTML salvo: ${url}`);
    return url;
  } catch (err: any) {
    console.warn(`[NfseLogger] Erro ao salvar HTML: ${err.message}`);
    return undefined;
  }
}

/**
 * Extrai todas as mensagens visíveis da página
 */
export async function extractPageMessages(page: any): Promise<string[]> {
  try {
    const messages = await page.evaluate(() => {
      const elements = document.querySelectorAll(
        '[role="alert"], .alert, .error, .warning, .success, .message, .msg, ' +
        '[class*="error"], [class*="warning"], [class*="alert"], [class*="message"]'
      );
      return Array.from(elements)
        .map((el: any) => el.textContent?.trim())
        .filter((text: string) => text && text.length > 0);
    });
    return messages;
  } catch (err: any) {
    console.warn(`[NfseLogger] Erro ao extrair mensagens: ${err.message}`);
    return [];
  }
}

/**
 * Extrai valores do formulário
 */
export async function extractFormValues(page: any): Promise<Record<string, any>> {
  try {
    const formData = await page.evaluate(() => {
      const data: Record<string, any> = {};
      const inputs = document.querySelectorAll('input, select, textarea');
      inputs.forEach((el: any) => {
        if (el.name) {
          if (el.type === 'checkbox' || el.type === 'radio') {
            data[el.name] = el.checked;
          } else {
            data[el.name] = el.value;
          }
        }
      });
      return data;
    });
    return formData;
  } catch (err: any) {
    console.warn(`[NfseLogger] Erro ao extrair valores do formulário: ${err.message}`);
    return {};
  }
}

/**
 * Registra log completo de uma etapa com todos os detalhes
 */
export async function logEmissionStepComplete(
  emissaoId: number,
  step: string,
  status: 'ok' | 'error' | 'warning',
  message: string,
  page?: any,
  payload?: any,
  errorDetails?: string
): Promise<void> {
  let screenshotUrl: string | undefined;
  let htmlUrl: string | undefined;
  let formValues: Record<string, any> = {};
  let pageMessages: string[] = [];

  // Capturar dados adicionais em caso de erro
  if (status !== 'ok' && page) {
    screenshotUrl = await captureAndSaveScreenshot(page, emissaoId, step);
    htmlUrl = await captureAndSaveHtml(page, emissaoId, step);
    formValues = await extractFormValues(page);
    pageMessages = await extractPageMessages(page);
  }

  // Preparar payload completo
  const fullPayload = {
    ...payload,
    formValues,
    pageMessages,
    timestamp: new Date().toISOString()
  };

  // Registrar log
  await logEmissionStep({
    emissaoId,
    step,
    status,
    message,
    payload: fullPayload,
    screenshot_url: screenshotUrl,
    html_url: htmlUrl,
    error_details: errorDetails
  });
}

/**
 * Busca todos os logs de uma emissão
 */
export async function getEmissionLogs(emissaoId: number): Promise<EmissionLogEntry[]> {
  const conn = await getConn();
  try {
    const [logs] = await conn.execute(
      `SELECT id, emissaoId, step, status, message, payload, screenshot_url, html_url, error_details, timestamp
       FROM nfse_emissao_logs
       WHERE emissaoId = ?
       ORDER BY timestamp ASC`,
      [emissaoId]
    );
    return logs as EmissionLogEntry[];
  } catch (err: any) {
    console.error(`[NfseLogger] Erro ao buscar logs: ${err.message}`);
    return [];
  } finally {
    await conn.end();
  }
}

/**
 * Busca o último log de uma emissão
 */
export async function getLastEmissionLog(emissaoId: number): Promise<EmissionLogEntry | null> {
  const conn = await getConn();
  try {
    const [logs] = await conn.execute(
      `SELECT id, emissaoId, step, status, message, payload, screenshot_url, html_url, error_details, timestamp
       FROM nfse_emissao_logs
       WHERE emissaoId = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [emissaoId]
    );
    return (logs as EmissionLogEntry[])[0] || null;
  } catch (err: any) {
    console.error(`[NfseLogger] Erro ao buscar último log: ${err.message}`);
    return null;
  } finally {
    await conn.end();
  }
}
