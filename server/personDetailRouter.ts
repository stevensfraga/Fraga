/**
 * Person Detail Router - Get detailed info about a specific person by UUID
 * Used to debug why doc-sync and whatsapp-sync are failing
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
 * GET /person-detail/{uuid}
 * Get detailed information about a specific person by UUID
 */
router.get('/person-detail/:uuid', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const uuid = req.params.uuid;
    
    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_UUID',
        message: 'UUID is required',
      });
    }

    console.log(`[PersonDetail] START uuid=${uuid}`);
    
    // Get valid access token
    const accessToken = await getValidAccessToken();
    const tokenSuffix = accessToken.substring(0, 20);
    console.log(`[OAuth] TOKEN_USED suffix=${tokenSuffix}...`);

    // Call Conta Azul API to get person details
    const endpoint = `https://api-v2.contaazul.com/v1/pessoas/${uuid}`;
    console.log(`[PersonDetail] FETCH url=${endpoint}`);

    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log(`[PersonDetail] RESPONSE status=${response.status}`);

    const data = response.data || {};
    
    // Check for documento and telefone fields
    const temDocumento = !!(data.documento || data.cpf || data.cnpj);
    const temTelefone = !!(data.telefone_celular || data.telefone_comercial || data.phone);
    
    console.log(`[PersonDetail] FIELDS documento=${temDocumento ? 'SIM' : 'NAO'} tel=${temTelefone ? 'SIM' : 'NAO'}`);

    res.json({
      success: true,
      apiStatus: response.status,
      uuid,
      temDocumento,
      temTelefone,
      payload: {
        id: data.id,
        nome: data.name || data.nome,
        email: data.email,
        documento: data.documento || data.cpf || data.cnpj,
        telefone_celular: data.telefone_celular || data.phone,
        telefone_comercial: data.telefone_comercial,
        tipo_perfil: data.tipo_perfil,
        criado_em: data.criado_em,
        atualizado_em: data.atualizado_em,
      },
      rawResponse: data,
    });
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    console.error(`[PersonDetail] ERROR status=${status}`);
    console.error(`[PersonDetail] ERROR_DATA`, JSON.stringify(errorData));
    
    res.json({
      success: false,
      error: error?.message,
      apiStatus: status,
      errorData,
    });
  }
});

export default router;
