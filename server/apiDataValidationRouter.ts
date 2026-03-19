import { Router } from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();

/**
 * GET /api/test/api/validate-receivables
 * Testa o endpoint de contas a receber da API
 * Prova C1: HTTP 200, keys corretas, arrayKey = "itens"
 */
router.get('/validate-receivables', async (req, res) => {
  try {
    console.log('[APIValidation] Iniciando validação de contas a receber...');

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'No valid OAuth token',
      });
    }

    // Endpoint da API de contas a receber
    const apiUrl = 'https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber/buscar';
    const params = {
      pagina: 1,
      tamanho_pagina: 1,
      data_vencimento_de: '2026-01-01',
      data_vencimento_ate: '2026-12-31',
    };

    console.log('[APIValidation] Chamando:', apiUrl);
    console.log('[APIValidation] Params:', params);

    const response = await axios.get(apiUrl, {
      params,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const httpStatus = response.status;
    const responseData = response.data;

    console.log('[APIValidation] HTTP:', httpStatus);
    console.log('[APIValidation] Response keys:', Object.keys(responseData));

    // Validar resposta
    if (httpStatus !== 200) {
      return res.status(httpStatus).json({
        success: false,
        http: httpStatus,
        error: 'Non-200 response',
      });
    }

    // Verificar chaves esperadas
    const expectedKeys = ['itens_totais', 'itens', 'totais'];
    const hasAllKeys = expectedKeys.every((key) => key in responseData);

    if (!hasAllKeys) {
      return res.status(400).json({
        success: false,
        error: 'Missing expected keys',
        expectedKeys,
        actualKeys: Object.keys(responseData),
        responseData: JSON.stringify(responseData).substring(0, 500),
      });
    }

    // Extrair itens
    const itens = responseData.itens || [];
    const itensTotais = responseData.itens_totais || 0;

    console.log('[APIValidation] Total de itens:', itensTotais);
    console.log('[APIValidation] Itens na página:', itens.length);

    // Preparar exemplo de item (sem dados sensíveis)
    let itemExample = null;
    if (itens.length > 0) {
      const firstItem = itens[0];
      itemExample = {
        id: firstItem.id,
        descricao: firstItem.descricao,
        data_vencimento: firstItem.data_vencimento,
        total: firstItem.total,
        status: firstItem.status,
      };
    }

    return res.json({
      success: true,
      http: httpStatus,
      itensTotais,
      itensPagina: itens.length,
      arrayKey: 'itens',
      hasData: itens.length > 0,
      itemExample,
      responseKeys: Object.keys(responseData),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[APIValidation] Erro:', error.message);

    const httpStatus = error.response?.status || 500;
    const errorData = error.response?.data || {};

    return res.status(httpStatus).json({
      success: false,
      http: httpStatus,
      error: error.message,
      errorData: JSON.stringify(errorData).substring(0, 500),
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
