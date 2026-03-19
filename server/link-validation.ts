/**
 * 🔗 Validação de Link Público com Retry
 * Valida que o PDF está acessível antes de enviar no WhatsApp
 */

import axios from 'axios';

const HEAD_TIMEOUT = 5000;
const HEAD_RETRY_COUNT = 2;
const HEAD_RETRY_DELAY_MS = 250;

/**
 * Validar se URL é publicamente acessível com retry
 * Faz HEAD request sem Authorization
 * Retorna true se status 200/302, false caso contrário
 */
export async function validatePublicUrlWithRetry(url: string): Promise<boolean> {
  if (!url || typeof url !== 'string') {
    console.log(`[LinkValidation] URL inválida: ${url}`);
    return false;
  }

  let lastError: any = null;

  for (let attempt = 0; attempt <= HEAD_RETRY_COUNT; attempt++) {
    try {
      const response = await axios.head(url, {
        timeout: HEAD_TIMEOUT,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      console.log(
        `[LinkValidation] ✅ URL acessível: ${url} ` +
        `(status=${response.status} attempt=${attempt})`
      );

      return true;
    } catch (error: any) {
      lastError = error;
      const status = error?.response?.status;

      console.warn(
        `[LinkValidation] RETRY attempt=${attempt} ` +
        `url=${url} ` +
        `status=${status || 'timeout'} ` +
        `error=${error.message}`
      );

      if (attempt < HEAD_RETRY_COUNT) {
        // Aguardar antes de retry
        await new Promise(resolve => setTimeout(resolve, HEAD_RETRY_DELAY_MS));
      }
    }
  }

  console.error(
    `[LinkValidation] ❌ URL inacessível após ${HEAD_RETRY_COUNT + 1} tentativas: ${url}`
  );

  return false;
}

/**
 * Validar se URL é um PDF válido
 * Verifica Content-Type e tamanho
 */
export async function validatePdfUrl(url: string): Promise<{
  valid: boolean;
  contentType?: string;
  contentLength?: number;
  error?: string;
}> {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Invalid URL' };
  }

  try {
    const response = await axios.head(url, {
      timeout: HEAD_TIMEOUT,
      maxRedirects: 5,
    });

    const contentType = response.headers['content-type'] || '';
    const contentLength = parseInt(response.headers['content-length'] || '0', 10);

    // Validar Content-Type
    if (!contentType.includes('pdf') && !contentType.includes('application/octet-stream')) {
      return {
        valid: false,
        contentType,
        error: `Invalid Content-Type: ${contentType}`,
      };
    }

    // Validar tamanho (mínimo 1KB, máximo 20MB)
    if (contentLength < 1024 || contentLength > 20 * 1024 * 1024) {
      return {
        valid: false,
        contentLength,
        error: `Invalid file size: ${contentLength} bytes`,
      };
    }

    console.log(
      `[LinkValidation] ✅ PDF válido: ${url} ` +
      `(type=${contentType} size=${contentLength})`
    );

    return {
      valid: true,
      contentType,
      contentLength,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message,
    };
  }
}
