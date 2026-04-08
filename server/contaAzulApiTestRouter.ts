/**
 * BLOCO 2 - Validação de API Conta Azul
 * Testa endpoints reais e retorna dados para diagnóstico
 */

import { Router } from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  const headerSecret = req.headers['x-dev-secret'];
  
  if (!devSecret || devSecret !== headerSecret) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  return true;
}

/**
 * GET /api-test
 * Testa endpoints reais da API Conta Azul
 * Retorna dados para diagnóstico
 */
router.get('/api-test', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[ContaAzulApiTest] Iniciando teste de API`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED suffix=${accessToken.substring(0, 8)}...`);

    const results: any = {
      timestamp: new Date().toISOString(),
      tests: [],
    };

    // Teste 1: /v1/clientes (pessoas)
    try {
      console.log(`[ContaAzulApiTest] Testando GET /v1/clientes?limit=1`);
      const response1 = await axios.get('https://api-v2.contaazul.com/v1/clientes?limit=1', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data1 = response1.data?.data || response1.data;
      console.log(`[ContaAzulApiTest] GET /v1/clientes httpStatus=${response1.status} itemCount=${Array.isArray(data1) ? data1.length : 0}`);

      results.tests.push({
        endpoint: '/v1/clientes?limit=1',
        httpStatus: response1.status,
        itemCount: Array.isArray(data1) ? data1.length : 0,
        firstItem: Array.isArray(data1) && data1.length > 0 ? data1[0] : null,
        keys: Array.isArray(data1) && data1.length > 0 ? Object.keys(data1[0]) : [],
      });
    } catch (error: any) {
      console.error(`[ContaAzulApiTest] GET /v1/clientes failed: ${error?.message}`);
      results.tests.push({
        endpoint: '/v1/clientes?limit=1',
        error: error?.message,
        httpStatus: error.response?.status,
      });
    }

    // Teste 2: /v1/pessoas (pessoas)
    try {
      console.log(`[ContaAzulApiTest] Testando GET /v1/pessoas?limit=1`);
      const response2 = await axios.get('https://api-v2.contaazul.com/v1/pessoas?limit=1', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data2 = response2.data?.data || response2.data;
      console.log(`[ContaAzulApiTest] GET /v1/pessoas httpStatus=${response2.status} itemCount=${Array.isArray(data2) ? data2.length : 0}`);

      results.tests.push({
        endpoint: '/v1/pessoas?limit=1',
        httpStatus: response2.status,
        itemCount: Array.isArray(data2) ? data2.length : 0,
        firstItem: Array.isArray(data2) && data2.length > 0 ? data2[0] : null,
        keys: Array.isArray(data2) && data2.length > 0 ? Object.keys(data2[0]) : [],
      });
    } catch (error: any) {
      console.error(`[ContaAzulApiTest] GET /v1/pessoas failed: ${error?.message}`);
      results.tests.push({
        endpoint: '/v1/pessoas?limit=1',
        error: error?.message,
        httpStatus: error.response?.status,
      });
    }

    // Teste 3: /v1/pessoas com filtro name
    try {
      console.log(`[ContaAzulApiTest] Testando GET /v1/pessoas?name=*`);
      const response3 = await axios.get('https://api-v2.contaazul.com/v1/pessoas?name=*', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data3 = response3.data?.data || response3.data;
      console.log(`[ContaAzulApiTest] GET /v1/pessoas?name=* httpStatus=${response3.status} itemCount=${Array.isArray(data3) ? data3.length : 0}`);

      results.tests.push({
        endpoint: '/v1/pessoas?name=*',
        httpStatus: response3.status,
        itemCount: Array.isArray(data3) ? data3.length : 0,
        firstItem: Array.isArray(data3) && data3.length > 0 ? data3[0] : null,
      });
    } catch (error: any) {
      console.error(`[ContaAzulApiTest] GET /v1/pessoas?name=* failed: ${error?.message}`);
      results.tests.push({
        endpoint: '/v1/pessoas?name=*',
        error: error?.message,
        httpStatus: error.response?.status,
      });
    }

    res.json({
      success: true,
      ...results,
    });
  } catch (error: any) {
    console.error(`[ContaAzulApiTest] FATAL error=${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
