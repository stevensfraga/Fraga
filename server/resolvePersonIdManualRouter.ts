/**
 * BLOCO 1.3 - Teste Manual com 1 Cliente Real
 * Endpoint para testar busca com dados específicos
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
 * POST /resolve-person-id-by-input
 * Body: { email?: string, document?: string, name?: string }
 * Retorna: httpStatus + hitsCount + uuid(s)
 */
router.post('/resolve-person-id-by-input', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const { email, document, name } = req.body;
    
    console.log(`[PersonResolveManual] request_start email=${email} document=${document} name=${name}`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED suffix=${accessToken.substring(0, 8)}...`);

    // Construir filtros
    const filters: Record<string, string> = {};
    if (email && email.trim()) {
      filters.email = email.trim();
    }
    if (document && document.trim()) {
      filters.document = document.trim();
    }
    if (name && name.trim()) {
      filters.name = name.trim();
    }

    if (Object.keys(filters).length === 0) {
      return res.json({
        success: false,
        error: 'NO_FILTERS_PROVIDED',
      });
    }

    // Construir query string com PARAMS CORRETOS (SEM pagina/tamanho_pagina)
    let endpoint = 'https://api-v2.contaazul.com/v1/pessoas';
    let hasParams = false;
    
    if (filters.email) {
      endpoint += `${hasParams ? '&' : '?'}emails=${encodeURIComponent(filters.email)}`;
      hasParams = true;
    }
    if (filters.document) {
      endpoint += `${hasParams ? '&' : '?'}documentos=${encodeURIComponent(filters.document)}`;
      hasParams = true;
    }
    if (filters.name) {
      endpoint += `${hasParams ? '&' : '?'}nomes=${encodeURIComponent(filters.name)}`;
      hasParams = true;
    }
    
    console.log(`[PersonResolveManual] request_call endpoint=${endpoint}`);

    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data?.data || [];
    
    console.log(`[PersonResolveManual] response_received httpStatus=${response.status} hitsCount=${data.length}`);
    
    const uuids = data.map((p: any) => p.id);
    if (uuids.length > 0) {
      console.log(`[PersonResolveManual] response_uuids ${uuids.join(',')}`);
    }

    res.json({
      success: true,
      httpStatus: response.status,
      hitsCount: data.length,
      uuids,
      fullData: data,
    });
  } catch (error: any) {
    const status = error.response?.status;
    console.error(`[PersonResolveManual] error httpStatus=${status} error=${error?.message}`);
    
    res.json({
      success: false,
      error: error?.message,
      httpStatus: status,
    });
  }
});

export default router;
