import { Router } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();

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

/**
 * GET /api/test/diagnose-parcelas
 * Lista candidatos e verifica quais têm parcelas reais na API Conta Azul
 */
router.get('/diagnose-parcelas', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err) {
      return res.status(401).json({
        success: false,
        reason: 'OAUTH_REQUIRED',
        error: (err as any).message,
      });
    }

    const apiBase = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';
    const limit = 50;

    const candidates = await db
      .select({
        id: receivables.id,
        contaAzulId: receivables.contaAzulId,
        linhaDigitavel: receivables.linhaDigitavel,
        link: receivables.link,
      })
      .from(receivables)
      .limit(limit);

    console.log(`[Diagnose] Verificando ${candidates.length} receivables`);

    const results: any[] = [];

    for (const candidate of candidates) {
      if (!candidate.contaAzulId || candidate.contaAzulId.includes('mock') || candidate.contaAzulId.includes('test')) {
        continue;
      }

      const endpoint = `/financeiro/eventos-financeiros/${candidate.contaAzulId}/parcelas`;
      const apiUrl = `${apiBase.replace(/\/+$/, '')}${endpoint}`;

      try {
        const response = await axios.get(apiUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

        const parcelas = response.data?.parcelas || response.data?.items || response.data || [];
        const hasParcelas = Array.isArray(parcelas) && parcelas.length > 0;

        if (hasParcelas) {
          const firstParcela = parcelas[0];
          const linhaDigitavel = firstParcela.linhaDigitavel || null;
          const link = firstParcela.link || null;
          const hasPrivateLink = link?.includes('api-v2.contaazul.com') || false;

          console.log(`[Diagnose] FOUND receivableId=${candidate.id}, contaAzulId=${candidate.contaAzulId}, parcelas=${parcelas.length}`);

          results.push({
            id: candidate.id,
            contaAzulId: candidate.contaAzulId,
            hasParcelas: true,
            parcelasCount: parcelas.length,
            linhaDigitavel: linhaDigitavel ? '***masked***' : null,
            link: link ? (hasPrivateLink ? '***private***' : '***public***') : null,
            hasPrivateLink: hasPrivateLink,
          });

          if (results.length >= 10) break;
        }
      } catch (err: any) {
        const status = err.response?.status || 'unknown';
        if (status !== 404) {
          console.log(`[Diagnose] ERROR receivableId=${candidate.id}: ${err.message}`);
        }
      }
    }

    return res.json({
      success: true,
      checked: candidates.length,
      foundWithParcelas: results.length,
      results: results,
    });
  } catch (error) {
    console.error(`[Diagnose] INTERNAL_ERROR:`, error);
    return res.status(500).json({
      success: false,
      reason: 'INTERNAL_ERROR',
      error: (error as any).message,
    });
  }
});

export default router;
