/**
 * BLOCO 2 - Descoberta de Endpoints Conta Azul
 * Testa todos os endpoints possíveis para encontrar onde estão os dados
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
 * GET /endpoint-discovery
 * Testa múltiplos endpoints para encontrar dados
 */
router.get('/endpoint-discovery', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[EndpointDiscovery] Iniciando descoberta de endpoints`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED suffix=${accessToken.substring(0, 8)}...`);

    const results: any = {
      timestamp: new Date().toISOString(),
      endpoints: [],
    };

    // Lista de endpoints para testar
    const endpointsToTest = [
      '/v1/pessoas?limit=5',
      '/v1/clientes?limit=5',
      '/v1/fornecedores?limit=5',
      '/v1/contatos?limit=5',
      '/v1/empresas',
      '/v1/empresa',
      '/v1/me',
      '/v1/usuarios?limit=5',
      '/v1/contas?limit=5',
      '/v1/categorias?limit=5',
      '/v1/produtos?limit=5',
      '/v1/vendas?limit=5',
      '/v1/compras?limit=5',
      '/v1/notas-fiscais?limit=5',
      '/v1/boletos?limit=5',
      '/v1/duplicatas?limit=5',
      '/v1/recebiveis?limit=5',
      '/v1/pagaveis?limit=5',
    ];

    for (const endpoint of endpointsToTest) {
      try {
        const fullUrl = `https://api-v2.contaazul.com${endpoint}`;
        console.log(`[EndpointDiscovery] Testando ${endpoint}...`);
        
        const response = await axios.get(fullUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

        const data = response.data?.data || response.data;
        const itemCount = Array.isArray(data) ? data.length : (data ? 1 : 0);
        
        console.log(`[EndpointDiscovery] ${endpoint} → httpStatus=${response.status} itemCount=${itemCount}`);

        results.endpoints.push({
          endpoint,
          httpStatus: response.status,
          itemCount,
          hasData: itemCount > 0,
          firstItem: Array.isArray(data) && data.length > 0 ? data[0] : (data && itemCount > 0 ? data : null),
          keys: Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : (data && itemCount > 0 ? Object.keys(data) : []),
        });
      } catch (error: any) {
        const status = error.response?.status;
        console.log(`[EndpointDiscovery] ${endpoint} → httpStatus=${status} error=${error?.message}`);
        
        results.endpoints.push({
          endpoint,
          httpStatus: status,
          error: error?.message,
          hasData: false,
        });
      }
    }

    // Filtrar endpoints com dados
    const endpointsWithData = results.endpoints.filter((e: any) => e.hasData);
    
    res.json({
      success: true,
      ...results,
      summary: {
        totalTested: results.endpoints.length,
        withData: endpointsWithData.length,
        endpointsWithData: endpointsWithData.map((e: any) => ({ endpoint: e.endpoint, itemCount: e.itemCount })),
      },
    });
  } catch (error: any) {
    console.error(`[EndpointDiscovery] FATAL error=${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
