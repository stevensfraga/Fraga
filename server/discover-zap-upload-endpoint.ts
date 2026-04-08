/**
 * Script para descobrir endpoint REAL de upload do ZapContábil
 * Estratégia: tentar endpoints conhecidos com um PDF pequeno
 */

import axios, { AxiosError } from 'axios';
import { ZapAuthManager } from './zapcontabilAuthManager';
import crypto from 'crypto';

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_USERNAME = process.env.ZAP_CONTABIL_USER || 'fraga@contato.com.br';
const ZAP_PASSWORD = process.env.ZAP_CONTABIL_PASS || '';
const ZAP_JRT_COOKIE = process.env.ZAP_CONTABIL_JRT_COOKIE || '';

interface UploadEndpointTest {
  endpoint: string;
  method: string;
  formDataField: string;
  success: boolean;
  httpStatus?: number;
  response?: any;
  error?: string;
}

// Endpoints conhecidos a testar
const ENDPOINTS_TO_TEST: Array<{ endpoint: string; method: string; field: string }> = [
  { endpoint: '/storage/upload', method: 'POST', field: 'file' },
  { endpoint: '/files/upload', method: 'POST', field: 'file' },
  { endpoint: '/upload', method: 'POST', field: 'file' },
  { endpoint: '/v1/storage/upload', method: 'POST', field: 'file' },
  { endpoint: '/media/upload', method: 'POST', field: 'file' },
  { endpoint: '/attachments/upload', method: 'POST', field: 'file' },
  { endpoint: '/storage/upload', method: 'POST', field: 'media' },
  { endpoint: '/storage/upload', method: 'POST', field: 'attachment' },
  { endpoint: '/storage/upload', method: 'POST', field: 'medias' },
  { endpoint: '/storage/upload', method: 'POST', field: 'document' },
];

async function createTestPdf(): Promise<Buffer> {
  // Criar um PDF mínimo válido
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
(Teste de Upload) Tj
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
  authManager: ZapAuthManager,
  test: { endpoint: string; method: string; field: string }
): Promise<UploadEndpointTest> {
  const result: UploadEndpointTest = {
    endpoint: test.endpoint,
    method: test.method,
    formDataField: test.field,
    success: false,
  };

  try {
    console.log(`\n[Test] Tentando: ${test.method} ${test.endpoint} (field: ${test.field})`);

    const pdfBuffer = await createTestPdf();
    const fileName = `test-boleto-${Date.now()}.pdf`;

    // Usar multipart/form-data com Buffer
    const boundary = '----' + Math.random().toString(36).substr(2);
    let uploadBody = '';
    uploadBody += `--${boundary}\r\n`;
    uploadBody += `Content-Disposition: form-data; name="${test.field}"; filename="${fileName}"\r\n`;
    uploadBody += `Content-Type: application/pdf\r\n\r\n`;

    const uploadBuffer = Buffer.concat([
      Buffer.from(uploadBody),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    // Fazer requisição via axios
    const response = await axios.post(`${ZAP_BASE_URL}${test.endpoint}`, uploadBuffer, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${(authManager as any).tokenCache?.accessToken || ''}`,
      },
      timeout: 10000,
      validateStatus: () => true, // Aceitar qualquer status
    });

    result.httpStatus = response.status;
    result.response = response.data;

    // Verificar se é uma resposta válida de upload
    if (response.status >= 200 && response.status < 300) {
      // Procurar por campos que indicam sucesso
      if (
        response.data?.filename ||
        response.data?.key ||
        response.data?.id ||
        response.data?.url ||
        response.data?.path ||
        response.data?.file
      ) {
        result.success = true;
        console.log(`✅ SUCESSO! Endpoint encontrado:`);
        console.log(`   HTTP ${result.httpStatus}`);
        console.log(`   Response:`, JSON.stringify(result.response, null, 2));
      } else {
        console.log(`⚠️ HTTP ${result.httpStatus} mas resposta não parece ser upload:`);
        console.log(`   Response:`, JSON.stringify(result.response, null, 2));
      }
    } else {
      console.log(`❌ HTTP ${result.httpStatus}`);
      result.error = `HTTP ${result.httpStatus}`;
    }
  } catch (error: any) {
    result.error = error.message;
    console.log(`❌ Erro: ${error.message}`);
  }

  return result;
}

export async function discoverUploadEndpoint(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DESCOBRIR ENDPOINT DE UPLOAD DO ZAPCONTÁBIL');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Base URL: ${ZAP_BASE_URL}`);
  console.log(`Endpoints a testar: ${ENDPOINTS_TO_TEST.length}`);

  try {
    // Inicializar auth manager
    const authManager = new ZapAuthManager({
      baseUrl: ZAP_BASE_URL,
      username: ZAP_USERNAME,
      password: ZAP_PASSWORD,
      jrtCookie: ZAP_JRT_COOKIE,
    });

    // Fazer login/refresh
    console.log('\n[Auth] Autenticando...');
    await (authManager as any).refreshOrLogin();
    console.log('✅ Autenticado');

    // Testar cada endpoint
    const results: UploadEndpointTest[] = [];
    for (const test of ENDPOINTS_TO_TEST) {
      const result = await testUploadEndpoint(authManager, test);
      results.push(result);

      if (result.success) {
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('✅ ENDPOINT ENCONTRADO!');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(JSON.stringify(result, null, 2));
        return;
      }
    }

    // Se chegou aqui, nenhum endpoint funcionou
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('❌ NENHUM ENDPOINT FUNCIONOU');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\nResultados:');
    console.log(JSON.stringify(results, null, 2));
  } catch (error: any) {
    console.error('❌ Erro fatal:', error.message);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  discoverUploadEndpoint().catch(console.error);
}
