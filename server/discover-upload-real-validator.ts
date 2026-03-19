/**
 * Scanner para descobrir endpoint REAL de upload do ZapContábil
 * Valida contrato: rejeita healthcheck, aceita apenas upload real
 */

import axios from 'axios';
import { ZapAuthManager } from './zapcontabilAuthManager';
import generateLargePdf from './utils/pdfGenerator';

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';

// Endpoints a testar
const ENDPOINTS_TO_TEST = [
  '/storage/upload',
  '/storage/file',
  '/storage',
  '/media/upload',
  '/medias/upload',
  '/attachments/upload',
  '/files',
  '/files/upload',
  '/upload',
  '/api/upload',
];

// Field names a testar
const FIELD_NAMES = ['file', 'medias', 'attachment'];

// Sinais de upload real (validação de contrato)
function isUploadRealResponse(response: any): boolean {
  if (!response || typeof response !== 'object') return false;
  
  // Rejeitar healthcheck
  if (response.status !== undefined && response.version !== undefined && Object.keys(response).length <= 2) {
    return false;
  }
  
  // Aceitar se contém sinais de upload real
  const responseStr = JSON.stringify(response);
  
  // Sinal 1: Contém filename/key/path/url/location/storageKey
  if (
    response.filename ||
    response.fileName ||
    response.key ||
    response.path ||
    response.url ||
    response.location ||
    response.storageKey ||
    response.id
  ) {
    return true;
  }
  
  // Sinal 2: Contém string /storage/file/
  if (responseStr.includes('/storage/file/')) {
    return true;
  }
  
  // Sinal 3: Contém URL assinada com signature e expires
  if (responseStr.includes('signature=') && responseStr.includes('expires=')) {
    return true;
  }
  
  return false;
}

interface UploadTestResult {
  endpoint: string;
  fieldName: string;
  httpStatus: number;
  responseKeys: string[];
  response: any;
  isRealUpload: boolean;
  error?: string;
}

export async function discoverUploadEndpointReal(): Promise<{
  ok: boolean;
  uploadEndpoint?: string;
  fieldName?: string;
  results: UploadTestResult[];
  error?: string;
}> {
  const results: UploadTestResult[] = [];
  
  try {
    // Autenticar
    const authManager = new ZapAuthManager({
      baseUrl: ZAP_BASE_URL,
      username: process.env.ZAP_CONTABIL_USER || 'fraga@contato.com.br',
      password: process.env.ZAP_CONTABIL_PASS || '',
      jrtCookie: process.env.ZAP_CONTABIL_JRT_COOKIE,
    });
    await authManager.refreshOrLogin();
    const token = (authManager as any).tokenCache?.accessToken;
    
    if (!token) {
      throw new Error('Failed to obtain access token');
    }
    
    // Gerar PDF > 5KB
    const pdfBuffer = generateLargePdf();
    console.log(`[discover-upload] Generated PDF: ${pdfBuffer.length} bytes`);
    
    // Testar cada combinação
    for (const endpoint of ENDPOINTS_TO_TEST) {
      for (const fieldName of FIELD_NAMES) {
        try {
          // Construir multipart/form-data manualmente
          const boundary = '----' + Math.random().toString(36).substr(2);
          let uploadBody = '';
          uploadBody += `--${boundary}\r\n`;
          uploadBody += `Content-Disposition: form-data; name="${fieldName}"; filename="boleto-test.pdf"\r\n`;
          uploadBody += `Content-Type: application/pdf\r\n\r\n`;
          
          const uploadBuffer = Buffer.concat([
            Buffer.from(uploadBody),
            pdfBuffer,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]);
          
          // Fazer requisição
          const response = await axios.post(`${ZAP_BASE_URL}${endpoint}`, uploadBuffer, {
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Authorization': `Bearer ${token}`,
              'Origin': 'https://fraga.zapcontabil.chat',
              'Referer': 'https://fraga.zapcontabil.chat/',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            timeout: 10000,
            validateStatus: () => true,
          });
          
          const isReal = isUploadRealResponse(response.data);
          
          const result: UploadTestResult = {
            endpoint,
            fieldName,
            httpStatus: response.status,
            responseKeys: Object.keys(response.data || {}),
            response: response.data,
            isRealUpload: isReal,
          };
          
          results.push(result);
          
          console.log(`[discover-upload] ${endpoint} + ${fieldName}: HTTP ${response.status}, isReal=${isReal}`);
          
          // Se encontrou upload real, retornar imediatamente
          if (isReal && response.status >= 200 && response.status < 300) {
            return {
              ok: true,
              uploadEndpoint: endpoint,
              fieldName,
              results,
            };
          }
        } catch (err) {
          const result: UploadTestResult = {
            endpoint,
            fieldName,
            httpStatus: 0,
            responseKeys: [],
            response: null,
            isRealUpload: false,
            error: (err as any).message,
          };
          results.push(result);
          console.log(`[discover-upload] ${endpoint} + ${fieldName}: ERROR - ${(err as any).message}`);
        }
      }
    }
    
    // Se não encontrou, retornar lista de tentativas
    return {
      ok: false,
      results,
      error: 'No valid upload endpoint found',
    };
  } catch (err) {
    return {
      ok: false,
      results,
      error: (err as any).message,
    };
  }
}

export default discoverUploadEndpointReal;
