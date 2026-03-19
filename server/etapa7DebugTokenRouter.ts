/**
 * 🔍 ETAPA 7 Debug: Verificar qual token está sendo usado
 */

import express from 'express';
import axios from 'axios';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { desc } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = express.Router();

/**
 * GET /api/test/etapa7/debug-token
 * 
 * Verifica qual token está sendo usado e testa com a API
 */
router.get('/debug-token', async (req, res) => {
  try {
    console.log('[ETAPA7 Debug] Iniciando debug de token...');

    // 1) Obter DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    // 2) Ler token do DB
    const savedTokens = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.updatedAt))
      .limit(1);

    const dbToken = savedTokens.length > 0 ? savedTokens[0] : null;

    console.log('[ETAPA7 Debug] Token do DB:', {
      exists: !!dbToken,
      accessTokenPrefix: dbToken?.accessToken?.substring(0, 20) + '...',
      expiresAt: dbToken?.expiresAt,
      createdAt: dbToken?.createdAt,
    });

    // 3) Obter token via getValidAccessToken
    let validAccessToken: string | null = null;
    try {
      validAccessToken = await getValidAccessToken();
      console.log('[ETAPA7 Debug] Token via getValidAccessToken:', validAccessToken?.substring(0, 20) + '...');
    } catch (err: any) {
      console.error('[ETAPA7 Debug] Erro ao obter token via getValidAccessToken:', err.message);
    }

    // 4) Testar ambos os tokens com a API
    const testUrl = 'https://api.contaazul.com/v1/contas-receber?pagina=1&tamanho_pagina=1';

    const results: any[] = [];

    // Testar token do DB
    if (dbToken?.accessToken) {
      try {
        const response = await axios.get(testUrl, {
          headers: {
            'Authorization': `Bearer ${dbToken.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        });
        results.push({
          source: 'DB Token',
          status: response.status,
          success: true,
          itemsCount: (response.data.itens || response.data.data || []).length,
        });
      } catch (err: any) {
        results.push({
          source: 'DB Token',
          status: err.response?.status,
          success: false,
          error: err.response?.data?.fault?.faultstring || err.message,
        });
      }
    }

    // Testar token via getValidAccessToken
    if (validAccessToken) {
      try {
        const response = await axios.get(testUrl, {
          headers: {
            'Authorization': `Bearer ${validAccessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        });
        results.push({
          source: 'getValidAccessToken',
          status: response.status,
          success: true,
          itemsCount: (response.data.itens || response.data.data || []).length,
        });
      } catch (err: any) {
        results.push({
          source: 'getValidAccessToken',
          status: err.response?.status,
          success: false,
          error: err.response?.data?.fault?.faultstring || err.message,
        });
      }
    }

    return res.json({
      success: true,
      dbToken: {
        exists: !!dbToken,
        accessTokenPrefix: dbToken?.accessToken?.substring(0, 20) + '...',
        expiresAt: dbToken?.expiresAt,
      },
      validAccessToken: {
        exists: !!validAccessToken,
        prefix: validAccessToken?.substring(0, 20) + '...',
      },
      testResults: results,
      recommendation: results.find(r => r.success) ? `Use ${results.find(r => r.success)?.source}` : 'Nenhum token funcionou',
    });
  } catch (error: any) {
    console.error('[ETAPA7 Debug] Erro:', error.message);

    return res.status(500).json({
      success: false,
      error: error.message || 'Erro desconhecido'
    });
  }
});

export default router;
