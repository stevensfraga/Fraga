/**
 * 🚀 Upload de Boletos via Cloudflare Worker
 * Integração com boletos-upload-proxy Worker
 * Alternativa otimizada ao upload direto via R2 SDK
 */

import axios, { AxiosError } from 'axios';
import { recordUploadMetric } from './upload-metrics';

const WORKER_URL = process.env.WORKER_UPLOAD_URL || 'https://boletos-upload-proxy.contato-676.workers.dev';
const WORKER_TIMEOUT = parseInt(process.env.WORKER_TIMEOUT || '30000', 10);
const WORKER_UPLOAD_TOKEN = process.env.WORKER_UPLOAD_TOKEN || 'default-dev-token';
const WORKER_RETRY_COUNT = 1;
const WORKER_RETRY_DELAY_MS = 300;

export interface WorkerUploadResult {
  success: boolean;
  key: string;
  publicUrl: string;
  error?: string;
  duration?: number;
  provider?: 'worker' | 'r2';
}

/**
 * Upload PDF via Cloudflare Worker
 * Vantagens:
 * - Sem credenciais AWS no backend
 * - Bypass de rate limits locais
 * - Compressão automática
 * - CDN integrado
 * 
 * @param receivableId - ID do receivable
 * @param pdfBuffer - Buffer contendo o PDF
 * @returns Resultado do upload com URL pública
 */
export async function uploadPdfViaWorker(
  receivableId: string | number,
  pdfBuffer: Buffer
): Promise<WorkerUploadResult> {
  const startTime = Date.now();
  
  try {
    const key = `boletos/${receivableId}.pdf`;
    
    console.log(
      '[WorkerUpload] START ' +
      `receivableId=${receivableId} ` +
      `key=${key} ` +
      `size=${pdfBuffer.length} ` +
      `worker=${WORKER_URL}`
    );

    // Criar FormData com arquivo e key
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
    formData.append('file', blob, `${receivableId}.pdf`);
    formData.append('key', key);

    // Fazer upload via Worker com retry
    let response;
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= WORKER_RETRY_COUNT; attempt++) {
      try {
        response = await axios.post(
          `${WORKER_URL}/upload`,
          formData,
          {
            timeout: WORKER_TIMEOUT,
            headers: {
              'Content-Type': 'multipart/form-data',
              'x-upload-token': WORKER_UPLOAD_TOKEN,
            },
          }
        );
        break; // Sucesso, sair do loop
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status || 'unknown';
        const isRetryable = status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
        
        console.warn(
          `[WorkerUpload] RETRY attempt=${attempt} ` +
          `status=${status} ` +
          `retryable=${isRetryable} ` +
          `error=${error.message}`
        );
        
        if (!isRetryable || attempt >= WORKER_RETRY_COUNT) {
          throw error;
        }
        
        // Aguardar antes de retry
        await new Promise(resolve => setTimeout(resolve, WORKER_RETRY_DELAY_MS));
      }
    }
    
    if (!response) {
      throw lastError || new Error('No response from Worker');
    }

    const duration = Date.now() - startTime;
    const { success, publicUrl, error, size } = response.data;

    if (!success) {
      console.error(
        '[WorkerUpload] FAILED ' +
        `receivableId=${receivableId} ` +
        `error=${error} ` +
        `duration=${duration}ms`
      );
      return {
        success: false,
        key: '',
        publicUrl: '',
        error: error || 'Unknown error',
        duration,
      };
    }

    console.log(
      '[WorkerUpload] SUCCESS ' +
      `receivableId=${receivableId} ` +
      `url=${publicUrl} ` +
      `duration=${duration}ms`
    );

    recordUploadMetric(receivableId, 'worker', true, duration, pdfBuffer.length, undefined, publicUrl, key);
    
    return {
      success: true,
      key,
      publicUrl,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMsg = error.message || String(error);
    const status = error.response?.status || 'unknown';

    console.error(
      '[WorkerUpload] ERROR ' +
      `receivableId=${receivableId} ` +
      `status=${status} ` +
      `error=${errorMsg} ` +
      `duration=${duration}ms`
    );

    recordUploadMetric(receivableId, 'worker', false, duration, pdfBuffer.length, errorMsg);
    
    return {
      success: false,
      key: '',
      publicUrl: '',
      error: errorMsg,
      duration,
    };
  }
}

/**
 * Health check do Worker
 * Verifica se o Worker está online e responsivo
 */
export async function checkWorkerHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${WORKER_URL}/health`, {
      timeout: 5000,
    });

    const { status } = response.data;
    const isHealthy = status === 'ok';

    console.log(
      '[WorkerHealth] ' +
      `status=${status} ` +
      `healthy=${isHealthy}`
    );

    return isHealthy;
  } catch (error: any) {
    console.error(
      '[WorkerHealth] ERROR ' +
      `error=${error.message}`
    );
    return false;
  }
}

/**
 * Fallback para upload via R2 SDK (se Worker falhar)
 * Importa dinamicamente para evitar dependência circular
 */
export async function uploadPdfWithFallback(
  receivableId: string | number,
  pdfBuffer: Buffer
): Promise<WorkerUploadResult> {
  // Tentar Worker primeiro
  const workerResult = await uploadPdfViaWorker(receivableId, pdfBuffer);
  
  if (workerResult.success) {
    return { ...workerResult, provider: 'worker' };
  }

  // Fallback para R2 direto (se disponível)
  try {
    const { uploadPdfToR2 } = await import('./r2-storage');
    const r2Result = await uploadPdfToR2(receivableId, pdfBuffer);
    
    if (r2Result.success) {
      console.log(
        '[WorkerUpload] FALLBACK_SUCCESS ' +
        `receivableId=${receivableId} ` +
        `method=r2-direct`
      );
      return { ...r2Result, provider: 'r2' } as WorkerUploadResult;
    }
  } catch (e) {
    console.error('[WorkerUpload] FALLBACK_ERROR', e);
  }

  // Se tudo falhar, retornar erro
  return {
    success: false,
    key: '',
    publicUrl: '',
    error: 'Both Worker and R2 uploads failed',
  };
}
