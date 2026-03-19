/**
 * 🔌 Conta Azul Ping Router
 * Validar token OAuth e conectividade com API Conta Azul
 * Retorna: apiStatus, usedTokenUpdatedAt, expiresAt
 * 
 * GET /api/test/conta-azul/ping
 */

import { Router } from 'express';
import * as crypto from 'crypto';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';

const router = Router();
const CONTA_AZUL_API_BASE = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  if (!devSecret) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }

  const headerSecret = req.headers['x-dev-secret'];
  let isValidSecret = false;
  try {
    const headerBuf = Buffer.from(headerSecret || '');
    const devSecretBuf = Buffer.from(devSecret);
    if (headerBuf.length === devSecretBuf.length) {
      isValidSecret = crypto.timingSafeEqual(headerBuf, devSecretBuf);
    }
  } catch (e) {
    isValidSecret = false;
  }

  if (!isValidSecret) {
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  return true;
}

router.get('/ping', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[OAuth] PING_REQUEST');

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
      console.log('[OAuth] PING_TOKEN_OBTAINED');
    } catch (err: any) {
      console.error('[OAuth] PING_TOKEN_ERROR:', err?.message);
      return res.status(401).json({
        success: false,
        apiStatus: 401,
        error: 'OAUTH_TOKEN_INVALID',
        message: err?.message,
        usedTokenUpdatedAt: null,
        expiresAt: null,
        nextAction: 'Reautorizar OAuth no painel Conta Azul',
      });
    }

    // Buscar metadata do token salvo no banco
    let tokenMetadata = null;
    try {
      const db = await getDb();
      if (db) {
        const { desc } = await import('drizzle-orm');
        const saved = await db
          .select()
          .from(contaAzulTokens)
          .orderBy((t) => t.updatedAt ? desc(t.updatedAt) : desc(t.createdAt))
          .limit(1);
        
        if (saved.length > 0) {
          tokenMetadata = {
            id: saved[0].id,
            updatedAt: saved[0].updatedAt,
            expiresAt: saved[0].expiresAt
          };
          console.log('[OAuth] PING_TOKEN_METADATA_FOUND');
          console.log('[OAuth] Token UpdatedAt:', tokenMetadata.updatedAt);
          console.log('[OAuth] Token ExpiresAt:', tokenMetadata.expiresAt);
        }
      }
    } catch (err: any) {
      console.error('[OAuth] PING_METADATA_ERROR:', err?.message);
    }

    let apiStatus = 0;
    let apiResponse: any = null;
    let apiError: string | null = null;

    try {
      console.log('[OAuth] PING_API_REQUEST');
      console.log('[OAuth] Endpoint: GET /v1/clientes?limit=1');
      
      const response = await axios.get(
        `${CONTA_AZUL_API_BASE}/v1/clientes?limit=1`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      apiStatus = response.status;
      apiResponse = response.data;
      console.log('[OAuth] PING_API_SUCCESS');
      console.log('[OAuth] OK apiStatus=' + apiStatus + ' updatedAt=' + tokenMetadata?.updatedAt);
    } catch (err: any) {
      apiStatus = err.response?.status || 0;
      apiError = err.message;
      console.error('[OAuth] PING_API_ERROR');
      console.error('[OAuth] apiStatus=' + apiStatus);
      console.error('[OAuth] error=' + apiError);

      return res.status(apiStatus || 500).json({
        success: false,
        apiStatus,
        error: 'CONTA_AZUL_API_ERROR',
        message: apiError,
        usedTokenUpdatedAt: tokenMetadata?.updatedAt || null,
        expiresAt: tokenMetadata?.expiresAt || null,
        nextAction: 'Verificar token e reautorizar se necessário',
      });
    }

    console.log('[OAuth] PING_COMPLETE');

    return res.json({
      success: true,
      apiStatus,
      message: 'Token OAuth válido e API Conta Azul acessível',
      usedTokenUpdatedAt: tokenMetadata?.updatedAt || null,
      expiresAt: tokenMetadata?.expiresAt || null,
      timestamp: new Date().toISOString(),
      apiResponse: {
        clientsCount: apiResponse?.data?.length || 0,
        hasData: !!apiResponse?.data,
      },
    });
    } catch (error: any) {
    console.error('[OAuth] PING_FATAL_ERROR:', error?.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error?.message,
        usedTokenUpdatedAt: null,
        expiresAt: null,
      });
    }
  }
});

export default router;
