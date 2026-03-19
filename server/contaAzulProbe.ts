/**
 * 🔍 Conta Azul Probe
 * Descobre automaticamente qual endpoint/prefixo está ativo na API
 * Testa rotas candidatas e retorna a primeira que responde != 404
 */

import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

interface ProbeResult {
  ok: boolean;
  endpoint?: string;
  status?: number;
  latencyMs?: number;
  baseUrl?: string;
  body?: any;
  error?: string;
  allAttempts?: Array<{
    endpoint: string;
    status: number | null;
    latencyMs: number;
    error?: string;
  }>;
}

/**
 * Candidatos de endpoints a testar
 * Ordenados por probabilidade (mais comuns primeiro)
 */
const ENDPOINT_CANDIDATES = [
  '/v1/pessoas',
  '/v1/clientes',
  '/v1/customers',
  '/v1/empresa',
  '/v1/organizacao',
  '/v1/me',
  '/v1/conta',
  '/v1/account',
  '/v2/pessoas',
  '/v2/clientes',
];

/**
 * Testar um endpoint específico
 */
async function testEndpoint(
  baseUrl: string,
  endpoint: string,
  accessToken: string
): Promise<{
  endpoint: string;
  status: number | null;
  latencyMs: number;
  error?: string;
  body?: any;
}> {
  const fullUrl = `${baseUrl}${endpoint}?limit=1`;
  const startTime = Date.now();

  try {
    console.log(`[ContaAzulProbe] Testing: GET ${fullUrl}`);

    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
      validateStatus: () => true, // Não throw em nenhum status
    });

    const latencyMs = Date.now() - startTime;
    const bodyPreview = JSON.stringify(response.data).substring(0, 200);

    console.log(`[ContaAzulProbe] ✅ ${endpoint} → Status ${response.status} (${latencyMs}ms)`);
    console.log(`[ContaAzulProbe]    Body: ${bodyPreview}...`);

    return {
      endpoint,
      status: response.status,
      latencyMs,
      body: response.data,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error?.message || 'Unknown error';

    console.log(`[ContaAzulProbe] ❌ ${endpoint} → Error: ${errorMsg} (${latencyMs}ms)`);

    return {
      endpoint,
      status: null,
      latencyMs,
      error: errorMsg,
    };
  }
}

/**
 * Executar probe em todos os endpoints candidatos
 * Retorna o primeiro que responder 200 ou 401 (não 404)
 */
export async function probeContaAzulEndpoints(): Promise<ProbeResult> {
  try {
    const accessToken = await getValidAccessToken();
    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';

    console.log(`[ContaAzulProbe] START: baseUrl=${baseUrl}`);
    console.log(`[ContaAzulProbe] Testing ${ENDPOINT_CANDIDATES.length} endpoint candidates...`);

    const allAttempts: ProbeResult['allAttempts'] = [];

    for (const endpoint of ENDPOINT_CANDIDATES) {
      const result = await testEndpoint(baseUrl, endpoint, accessToken);
      allAttempts.push({
        endpoint: result.endpoint,
        status: result.status,
        latencyMs: result.latencyMs,
        error: result.error,
      });

      // ❌ ABORT CEDO: Se detectar auth fail (401/403), não continuar testando
      if (result.status === 401 || result.status === 403) {
        const bodyStr = JSON.stringify(result.body || {});
        const isJWTError = bodyStr.includes('JWT') || bodyStr.includes('token');
        
        if (isJWTError) {
          console.log(`[ContaAzulProbe] ❌ AUTH FAIL DETECTED: ${result.status} (JWT error)`);
          return {
            ok: false,
            baseUrl,
            error: `Authentication failed: ${result.status}`,
            allAttempts,
          };
        }
      }

      // ✅ Retornar primeira rota que responde != 404 e != null
      if (result.status !== null && result.status !== 404) {
        console.log(`[ContaAzulProbe] ✅ FOUND: ${endpoint} (status=${result.status})`);

        return {
          ok: true,
          endpoint: result.endpoint,
          status: result.status,
          latencyMs: result.latencyMs,
          baseUrl,
          body: result.body,
          allAttempts,
        };
      }
    }

    // ❌ Nenhum endpoint funcionou
    console.log(`[ContaAzulProbe] ❌ FAILED: Nenhum endpoint respondeu != 404`);

    return {
      ok: false,
      baseUrl,
      error: 'Nenhum endpoint respondeu != 404',
      allAttempts,
    };
  } catch (error: any) {
    console.error(`[ContaAzulProbe] FATAL ERROR: ${error?.message}`);

    return {
      ok: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Testar especificamente o endpoint /pessoas
 * Retorna true se HTTP 200, false caso contrário
 */
export async function testPessoasEndpoint(): Promise<{
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  body?: any;
}> {
  try {
    const accessToken = await getValidAccessToken();
    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';
    const fullUrl = `${baseUrl}/v1/pessoas?limit=1`;

    console.log(`[ContaAzulPessoas] Testing: GET ${fullUrl}`);

    const startTime = Date.now();
    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    const latencyMs = Date.now() - startTime;
    const bodyPreview = JSON.stringify(response.data).substring(0, 300);

    console.log(`[ContaAzulPessoas] Status: ${response.status} (${latencyMs}ms)`);
    console.log(`[ContaAzulPessoas] Body: ${bodyPreview}...`);

    return {
      ok: response.status === 200,
      status: response.status,
      latencyMs,
      body: response.data,
    };
  } catch (error: any) {
    console.error(`[ContaAzulPessoas] Error: ${error?.message}`);

    return {
      ok: false,
      error: error?.message,
    };
  }
}
