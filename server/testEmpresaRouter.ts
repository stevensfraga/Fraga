/**
 * Test endpoint to validate company/tenant
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
 * GET /empresa - Validate which company the token is accessing
 */
router.get('/empresa', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[EmpresaCheck] START');
    
    const accessToken = await getValidAccessToken();
    console.log('[EmpresaCheck] TOKEN_OBTAINED');

    const response = await axios.get('https://api-v2.contaazul.com/v1/empresa', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log('[EmpresaCheck] RESPONSE_RECEIVED httpStatus=' + response.status);
    console.log('[EmpresaCheck] COMPANY_DATA', JSON.stringify(response.data));

    const data = response.data?.data || response.data || {};
    
    res.json({
      success: true,
      httpStatus: response.status,
      companyName: data.razaoSocial || data.name || 'N/A',
      companyCnpj: data.cnpj || 'N/A',
      raw: data,
    });
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    console.error('[EmpresaCheck] ERROR httpStatus=' + status);
    console.error('[EmpresaCheck] ERROR_DATA', JSON.stringify(errorData));
    
    res.json({
      success: false,
      error: error?.message,
      httpStatus: status,
      errorData,
    });
  }
});

export default router;
