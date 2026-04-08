/**
 * Capturar requisição REAL de upload do ZapContábil
 * Estratégia: Fazer login, tentar upload com logging detalhado de TODAS as requisições
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import generateLargePdf from './utils/pdfGenerator';

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_USERNAME = process.env.ZAP_CONTABIL_USER || 'fraga@contato.com.br';
const ZAP_PASSWORD = process.env.ZAP_CONTABIL_PASS || '';

interface RequestLog {
  method: string;
  url: string;
  headers: Record<string, any>;
  body?: any;
  responseStatus: number;
  responseHeaders: Record<string, any>;
  responseBody: any;
  timestamp: number;
}

const requestLogs: RequestLog[] = [];

export async function captureUploadNetwork(): Promise<{
  ok: boolean;
  realUploadEndpoint?: {
    url: string;
    method: string;
    headers: Record<string, any>;
    fieldName: string;
    response: any;
  };
  allRequests: RequestLog[];
  error?: string;
}> {
  try {
    // Criar axios instance com interceptors
    const instance = axios.create({
      baseURL: ZAP_BASE_URL,
      timeout: 30000,
      withCredentials: true,
    });

    // Interceptor para logar TODAS as requisições
    instance.interceptors.request.use((config) => {
      console.log(`[capture-network] REQUEST: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    // Interceptor para logar TODAS as respostas
    instance.interceptors.response.use(
      (response) => {
        const log: RequestLog = {
          method: response.config.method?.toUpperCase() || 'UNKNOWN',
          url: response.config.url || '',
          headers: response.config.headers as Record<string, any>,
          body: response.config.data,
          responseStatus: response.status,
          responseHeaders: response.headers as Record<string, any>,
          responseBody: response.data,
          timestamp: Date.now(),
        };
        requestLogs.push(log);
        console.log(`[capture-network] RESPONSE: ${response.status} from ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          const log: RequestLog = {
            method: error.config.method?.toUpperCase() || 'UNKNOWN',
            url: error.config.url || '',
            headers: error.config.headers as Record<string, any>,
            body: error.config.data,
            responseStatus: error.response.status,
            responseHeaders: error.response.headers as Record<string, any>,
            responseBody: error.response.data,
            timestamp: Date.now(),
          };
          requestLogs.push(log);
          console.log(`[capture-network] ERROR: ${error.response.status} from ${error.config.url}`);
        }
        return Promise.reject(error);
      }
    );

    // 1. Login
    console.log('[capture-network] Fazendo login...');
    const loginResponse = await instance.post('/auth/login', {
      email: ZAP_USERNAME,
      password: ZAP_PASSWORD,
    });

    const token = loginResponse.data?.token;
    if (!token) {
      throw new Error('Login failed: no token returned');
    }

    // Adicionar token aos headers
    instance.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    // 2. Gerar PDF > 5KB
    console.log('[capture-network] Gerando PDF...');
    const pdfBuffer = generateLargePdf();
    console.log(`[capture-network] PDF gerado: ${pdfBuffer.length} bytes`);

    // 3. Tentar upload em MÚLTIPLOS endpoints com logging detalhado
    const uploadEndpoints = [
      { path: '/storage/upload', method: 'POST', field: 'file' },
      { path: '/storage/upload', method: 'POST', field: 'medias' },
      { path: '/upload', method: 'POST', field: 'file' },
      { path: '/media/upload', method: 'POST', field: 'file' },
      { path: '/files/upload', method: 'POST', field: 'file' },
      { path: '/attachments/upload', method: 'POST', field: 'file' },
      { path: '/v1/storage/upload', method: 'POST', field: 'file' },
      { path: '/api/upload', method: 'POST', field: 'file' },
      { path: '/storage', method: 'POST', field: 'file' },
      { path: '/storage', method: 'PUT', field: 'file' },
    ];

    for (const endpoint of uploadEndpoints) {
      try {
        console.log(`[capture-network] Tentando upload em ${endpoint.path} (${endpoint.method})...`);

        // Construir multipart/form-data manualmente
        const boundary = '----' + Math.random().toString(36).substr(2);
        let uploadBody = '';
        uploadBody += `--${boundary}\r\n`;
        uploadBody += `Content-Disposition: form-data; name="${endpoint.field}"; filename="boleto-capture.pdf"\r\n`;
        uploadBody += `Content-Type: application/pdf\r\n\r\n`;

        const uploadBuffer = Buffer.concat([
          Buffer.from(uploadBody),
          pdfBuffer,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const response = await instance({
          method: endpoint.method as any,
          url: endpoint.path,
          data: uploadBuffer,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          validateStatus: () => true,
        });

        // Verificar se é upload real (não healthcheck)
        if (
          response.status >= 200 &&
          response.status < 300 &&
          response.data &&
          typeof response.data === 'object'
        ) {
          const hasRealSignals =
            response.data.filename ||
            response.data.fileName ||
            response.data.key ||
            response.data.path ||
            response.data.url ||
            response.data.location ||
            response.data.storageKey ||
            response.data.uploadUrl ||
            response.data.signedUrl ||
            JSON.stringify(response.data).includes('/storage/file/') ||
            (JSON.stringify(response.data).includes('signature=') && JSON.stringify(response.data).includes('expires='));

          if (hasRealSignals) {
            console.log(`[capture-network] ✅ UPLOAD REAL ENCONTRADO: ${endpoint.path}`);
            return {
              ok: true,
              realUploadEndpoint: {
                url: endpoint.path,
                method: endpoint.method,
                headers: {
                  'Content-Type': `multipart/form-data; boundary={boundary}`,
                  'Authorization': 'Bearer {token}',
                },
                fieldName: endpoint.field,
                response: response.data,
              },
              allRequests: requestLogs,
            };
          }
        }
      } catch (err) {
        console.log(`[capture-network] Erro em ${endpoint.path}: ${(err as any).message}`);
      }
    }

    // Se não encontrou upload real, retornar todos os logs
    return {
      ok: false,
      allRequests: requestLogs,
      error: 'No real upload endpoint found in tested candidates',
    };
  } catch (err) {
    console.error('[capture-network] Fatal error:', err);
    return {
      ok: false,
      allRequests: requestLogs,
      error: (err as any).message,
    };
  }
}

export default captureUploadNetwork;
