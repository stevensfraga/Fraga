/**
 * Debug Router - Mostra exatamente qual URL está sendo enviada para Conta Azul
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
 * GET /debug-pessoas
 * Testa diferentes formatos de URL para /v1/pessoas
 */
router.get('/debug-pessoas', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const accessToken = await getValidAccessToken();
    
    const tests = [
      { name: 'sem params', url: 'https://api-v2.contaazul.com/v1/pessoas' },
      { name: 'limit=1', url: 'https://api-v2.contaazul.com/v1/pessoas?limit=1' },
      { name: 'pagina=1&tamanho_pagina=5', url: 'https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=5' },
      { name: 'emails=test@test.com', url: 'https://api-v2.contaazul.com/v1/pessoas?emails=test@test.com' },
      { name: 'pagina=1&tamanho_pagina=5&emails=test@test.com', url: 'https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=5&emails=test@test.com' },
      { name: 'documentos=12345678901234', url: 'https://api-v2.contaazul.com/v1/pessoas?documentos=12345678901234' },
      { name: 'nomes=Teste', url: 'https://api-v2.contaazul.com/v1/pessoas?nomes=Teste' },
      { name: 'busca=Teste', url: 'https://api-v2.contaazul.com/v1/pessoas?busca=Teste' },
    ];

    const results: any = [];

    for (const test of tests) {
      try {
        console.log(`[DebugPessoas] Testando: ${test.name}`);
        
        const response = await axios.get(test.url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

        const data = response.data?.data || [];
        console.log(`[DebugPessoas] ${test.name} → httpStatus=${response.status} itemCount=${data.length}`);

        results.push({
          name: test.name,
          url: test.url,
          httpStatus: response.status,
          itemCount: data.length,
          success: true,
        });
      } catch (error: any) {
        const status = error.response?.status;
        const errorMsg = error.response?.data?.fault?.faultstring || error?.message;
        console.log(`[DebugPessoas] ${test.name} → httpStatus=${status} error=${errorMsg}`);

        results.push({
          name: test.name,
          url: test.url,
          httpStatus: status,
          error: errorMsg,
          success: false,
        });
      }
    }

    res.json({
      success: true,
      results,
    });
  } catch (error: any) {
    console.error(`[DebugPessoas] FATAL error=${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
