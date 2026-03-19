/**
 * BLOCO 1.2 - Diagnóstico de Tenant
 * Confirmar qual empresa está conectada no Conta Azul
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
 * GET /contaazul-whoami
 * Retorna informações da empresa/tenant conectado
 */
router.get('/contaazul-whoami', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[ContaAzulDiag] whoami_request iniciado`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED suffix=${accessToken.substring(0, 8)}...`);

    // Tentar multiplos endpoints para encontrar dados da empresa
    const endpoints = [
      'https://api-v2.contaazul.com/v1/empresas',
      'https://api-v2.contaazul.com/v1/empresa',
      'https://api-v2.contaazul.com/v1/me',
      'https://api-v2.contaazul.com/v1/clientes?limit=1',
    ];
    
    let successResponse = null;
    let lastError = null;
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[ContaAzulDiag] whoami_request tentando endpoint=${endpoint}`);
        
        const response = await axios.get(endpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });
        
        console.log(`[ContaAzulDiag] whoami_response endpoint=${endpoint} httpStatus=${response.status}`);
        
        successResponse = { endpoint, response };
        break;
      } catch (error: any) {
        lastError = error;
        console.log(`[ContaAzulDiag] whoami_failed endpoint=${endpoint} httpStatus=${error.response?.status}`);
        continue;
      }
    }
    
    if (successResponse) {
      const { endpoint, response } = successResponse;
      const data = response.data?.data || response.data;
      
      res.json({
        success: true,
        endpoint,
        httpStatus: response.status,
        data,
      });
    } else {
      console.log(`[ContaAzulDiag] whoami_all_failed lastError=${lastError?.message}`);
      res.json({
        success: false,
        error: 'ALL_ENDPOINTS_FAILED',
        lastError: lastError?.message,
      });
    }
  } catch (error: any) {
    const status = error.response?.status;
    console.error(`[ContaAzulDiag] whoami_error httpStatus=${status} error=${error?.message}`);
    
    res.json({
      success: false,
      error: error?.message,
      httpStatus: status,
    });
  }
});

export default router;
