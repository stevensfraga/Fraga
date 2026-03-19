/**
 * Scanner Programático - Descobrir endpoint REAL de upload do ZapContábil
 * Usa ZapAuthManager + varredura controlada de endpoints
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ZapAuthManager } from './zapcontabilAuthManager';
import crypto from 'crypto';

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_USERNAME = process.env.ZAP_CONTABIL_USER || 'Stevensfraga@gmail.com';
const ZAP_PASSWORD = process.env.ZAP_CONTABIL_PASS || 'Fraga@123';
const ZAP_JRT_COOKIE = process.env.ZAP_CONTABIL_JRT_COOKIE || '';
const TICKET_ID = '8019';

interface UploadTest {
  endpoint: string;
  fieldName: string;
  httpStatus?: number;
  response?: any;
  isValid: boolean;
  error?: string;
}

interface ScanResult {
  timestamp: string;
  uploadEndpointFound: boolean;
  uploadEndpoint?: string;
  uploadFieldName?: string;
  uploadResponse?: any;
  uploadHttpStatus?: number;
  signedUrlHttpStatus?: number;
  signedUrl?: string;
  sendHttpStatus?: number;
  sendResponse?: any;
  correlationId?: string;
  allTests: UploadTest[];
  summary: {
    success: boolean;
    message: string;
  };
}

// Endpoints a testar
const ENDPOINTS_TO_TEST = [
  '/files',
  '/files/upload',
  '/upload',
  '/media',
  '/attachments',
  `/tickets/${TICKET_ID}/attachments`,
  `/tickets/${TICKET_ID}/upload`,
  `/messages/${TICKET_ID}/media`,
  `/messages/${TICKET_ID}/attachments`,
  '/v1/files/upload',
  '/v1/storage/upload',
];

// Field names possíveis
const FIELD_NAMES = ['file', 'media', 'attachment', 'medias', 'medias[]', 'document'];

async function createTestPdf(): Promise<Buffer> {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Teste) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
308
%%EOF`;

  return Buffer.from(pdfContent);
}

async function testUploadEndpoint(
  axiosInstance: AxiosInstance,
  endpoint: string,
  fieldName: string,
  pdfBuffer: Buffer
): Promise<UploadTest> {
  const result: UploadTest = {
    endpoint,
    fieldName,
    isValid: false,
  };

  try {
    // Usar FormData nativo do Node (sem require)
    const fileName = `test-boleto-${Date.now()}.pdf`;
    
    // Criar FormData manualmente com boundary
    const boundary = '----' + Math.random().toString(36).substr(2);
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n`;
    body += `Content-Type: application/pdf\r\n\r\n`;
    
    const bodyBuffer = Buffer.concat([
      Buffer.from(body),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const response = await axiosInstance.post(endpoint, bodyBuffer, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    result.httpStatus = response.status;
    result.response = response.data;

    // Critério de sucesso: retornar algo além de {status, version}
    if (response.status >= 200 && response.status < 300) {
      const hasFilename = response.data?.filename || response.data?.key || response.data?.id || response.data?.url;
      const isNotHealthCheck = !(response.data?.status && response.data?.version && !hasFilename);

      if (hasFilename && isNotHealthCheck) {
        result.isValid = true;
        console.log(`✅ VÁLIDO: ${endpoint} (field: ${fieldName})`);
        console.log(`   Resposta:`, JSON.stringify(response.data, null, 2));
      } else {
        console.log(`⚠️ HTTP ${response.status} mas não é upload real: ${endpoint}`);
      }
    } else {
      console.log(`❌ HTTP ${result.httpStatus}: ${endpoint}`);
    }
  } catch (error: any) {
    result.error = error.message;
    console.log(`❌ Erro em ${endpoint}: ${error.message}`);
  }

  return result;
}

async function getSignedUrl(
  axiosInstance: AxiosInstance,
  filename: string
): Promise<{ httpStatus?: number; url?: string; error?: string }> {
  try {
    const response = await axiosInstance.get(`/storage/signedUrl/${filename}?expiresInSeconds=900`, {
      timeout: 10000,
      validateStatus: () => true,
    });

    if (response.status === 200 && response.data?.url) {
      console.log(`✅ SignedUrl obtida`);
      return {
        httpStatus: response.status,
        url: response.data.url,
      };
    } else {
      return {
        httpStatus: response.status,
        error: `Resposta inválida: ${JSON.stringify(response.data)}`,
      };
    }
  } catch (error: any) {
    return {
      error: error.message,
    };
  }
}

async function sendMessage(
  axiosInstance: AxiosInstance,
  signedUrl: string,
  correlationId: string
): Promise<{ httpStatus?: number; response?: any; error?: string }> {
  try {
    const payload = {
      read: true,
      fromMe: true,
      mediaUrl: signedUrl,
      mediaType: 'application/pdf',
      fileName: 'boleto-r7-14464.pdf',
      body: `R7 - Segue boleto em anexo.\n${correlationId}`,
      quotedMsg: null,
    };

    const response = await axiosInstance.post(`/messages/${TICKET_ID}`, payload, {
      timeout: 10000,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ Mensagem enviada com HTTP ${response.status}`);
      return {
        httpStatus: response.status,
        response: response.data,
      };
    } else {
      return {
        httpStatus: response.status,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error: any) {
    return {
      error: error.message,
    };
  }
}

export async function discoverUploadEndpointAuto(): Promise<ScanResult> {
  const result: ScanResult = {
    timestamp: new Date().toISOString(),
    uploadEndpointFound: false,
    allTests: [],
    summary: {
      success: false,
      message: 'Iniciando varredura...',
    },
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SCANNER PROGRAMÁTICO - DESCOBRIR UPLOAD DO ZAPCONTÁBIL');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Base URL: ${ZAP_BASE_URL}`);

  try {
    // Passo 1: Autenticar com ZapAuthManager
    console.log('\n[1] Autenticando com ZapAuthManager...');
    const authManager = new ZapAuthManager({
      baseUrl: ZAP_BASE_URL,
      username: ZAP_USERNAME,
      password: ZAP_PASSWORD,
      jrtCookie: ZAP_JRT_COOKIE,
    });

    await (authManager as any).refreshOrLogin();
    console.log('✅ Autenticado');

    // Obter token e criar axios instance
    const token = (authManager as any).tokenCache?.accessToken;
    if (!token) {
      throw new Error('Token não obtido');
    }

    const axiosInstance = axios.create({
      baseURL: ZAP_BASE_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
      timeout: 10000,
      withCredentials: true,
    });

    // Passo 2: Criar PDF de teste
    console.log('\n[2] Criando PDF de teste...');
    const pdfBuffer = await createTestPdf();
    console.log(`✅ PDF criado: ${pdfBuffer.length} bytes`);

    // Passo 3: Varredura de endpoints
    console.log(`\n[3] Testando ${ENDPOINTS_TO_TEST.length} endpoints...`);
    let uploadFound = false;
    let bestResult: UploadTest | null = null;

    for (const endpoint of ENDPOINTS_TO_TEST) {
      for (const fieldName of FIELD_NAMES) {
        if (uploadFound) break;

        console.log(`\n   Testando: POST ${endpoint} (field: ${fieldName})`);
        const test = await testUploadEndpoint(axiosInstance, endpoint, fieldName, pdfBuffer);
        result.allTests.push(test);

        if (test.isValid) {
          uploadFound = true;
          bestResult = test;
          result.uploadEndpointFound = true;
          result.uploadEndpoint = endpoint;
          result.uploadFieldName = fieldName;
          result.uploadResponse = test.response;
          result.uploadHttpStatus = test.httpStatus;
          break;
        }
      }

      if (uploadFound) break;
    }

    if (!uploadFound) {
      result.summary.success = false;
      result.summary.message = 'Nenhum endpoint de upload válido encontrado';
      console.log('\n❌ Nenhum endpoint válido encontrado');
      return result;
    }

    // Passo 4: Obter signedUrl
    console.log('\n[4] Obtendo signedUrl...');
    const filename = bestResult!.response?.filename || bestResult!.response?.key || bestResult!.response?.id;

    if (!filename) {
      result.summary.success = false;
      result.summary.message = 'Não conseguiu extrair filename do upload';
      return result;
    }

    const signedUrlResult = await getSignedUrl(axiosInstance, filename);
    result.signedUrlHttpStatus = signedUrlResult.httpStatus;
    result.signedUrl = signedUrlResult.url;

    if (!result.signedUrl) {
      result.summary.success = false;
      result.summary.message = `Erro ao obter signedUrl: ${signedUrlResult.error}`;
      return result;
    }

    // Passo 5: Enviar mensagem com anexo
    console.log('\n[5] Enviando mensagem com anexo...');
    result.correlationId = `[#FRAGA:${TICKET_ID}:30004:14464:${Date.now()}]`;

    const sendResult = await sendMessage(axiosInstance, result.signedUrl, result.correlationId);
    result.sendHttpStatus = sendResult.httpStatus;
    result.sendResponse = sendResult.response;

    if (sendResult.error) {
      result.summary.success = false;
      result.summary.message = `Erro ao enviar mensagem: ${sendResult.error}`;
      return result;
    }

    result.summary.success = true;
    result.summary.message = '✅ SUCESSO! Upload, signedUrl e envio funcionando!';

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(result.summary.message);
    console.log('═══════════════════════════════════════════════════════════════');

    return result;
  } catch (error: any) {
    result.summary.success = false;
    result.summary.message = `Erro fatal: ${error.message}`;
    console.error('❌ Erro:', error.message);
    return result;
  }
}

// Executar se chamado diretamente
// if (require.main === module) {
//   discoverUploadEndpointAuto()
//     .then((result) => {
//       console.log('\n\nRESULTADO FINAL:');
//       console.log(JSON.stringify(result, null, 2));
//     })
//     .catch(console.error);
// }
