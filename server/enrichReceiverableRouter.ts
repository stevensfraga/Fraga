/**
 * 🔧 Endpoint de Enriquecimento de Receivables
 * POST /api/test/enrich-receivable-from-conta-azul/:id
 * 
 * Enriquece receivable com payment info REAL da API Conta Azul
 * 
 * Response:
 * {
 *   success: boolean,
 *   receivableId: number,
 *   contaAzulId: string,
 *   fetched: { linhaDigitavel?: string, linkPublico?: string },
 *   persisted: { linhaDigitavel?: string, linkPublico?: string },
 *   reason?: string (se bloqueado)
 * }
 */

import { Router } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();

/**
 * ✅ DEV GUARD: Bloqueia endpoints de teste em produção
 */
function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    console.warn('[DevOnly] Tentativa de acesso em NODE_ENV:', process.env.NODE_ENV);
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  if (!devSecret) {
    console.error('[DevOnly] DEV_SECRET não configurado no ambiente');
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
    console.warn('[DevOnly] Header X-Dev-Secret inválido ou ausente');
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  return true;
}

/**
 * POST /api/test/enrich-receivable-from-conta-azul/:id
 * 
 * Enriquece receivable com payment info REAL da API Conta Azul
 * Busca parcelas via /v1/financeiro/eventos-financeiros/{id_evento}/parcelas
 */
router.post('/enrich-receivable-from-conta-azul/:id', async (req, res) => {
  if (!devOnly(req, res)) return;

  const receivableId = Number(req.params.id);
  const db = await getDb();

  try {
    if (!db) throw new Error('Database not available');

    // 1. Carregar receivable do DB
    const receivableResult = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (!receivableResult || receivableResult.length === 0) {
      console.log(`[Enrich] BLOCKED reason=RECEIVABLE_NOT_FOUND receivableId=${receivableId}`);
      return res.status(404).json({
        success: false,
        receivableId,
        reason: 'RECEIVABLE_NOT_FOUND',
        message: `Receivable ${receivableId} não encontrado no banco local`,
      });
    }

    const receivable = receivableResult[0];
    const contaAzulId = receivable.contaAzulId as string;

    // 2. Validar contaAzulId (não pode ser mock)
    if (!contaAzulId || contaAzulId.includes('mock') || contaAzulId.includes('test')) {
      console.log(`[Enrich] BLOCKED reason=INVALID_CONTA_AZUL_ID contaAzulId=${contaAzulId}`);
      return res.status(400).json({
        success: false,
        receivableId,
        contaAzulId,
        reason: 'INVALID_CONTA_AZUL_ID',
        message: 'contaAzulId é inválido ou mock',
      });
    }

    console.log(`[Enrich] START receivableId=${receivableId}, contaAzulId=${contaAzulId}`);

    // 3. Obter token OAuth com refresh automático
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err) {
      console.log(`[Enrich] BLOCKED reason=OAUTH_REQUIRED error=${(err as any).message}`);
      return res.status(401).json({
        success: false,
        receivableId,
        contaAzulId,
        reason: 'OAUTH_REQUIRED',
        message: 'Nenhum token OAuth válido encontrado. Reautentique com Conta Azul.',
        error: (err as any).message,
      });
    }

    // 4. Chamar API Conta Azul para buscar parcelas
    // Endpoint: /v1/financeiro/eventos-financeiros/{id_evento}/parcelas
    // CONTA_AZUL_API_BASE já inclui /v1 (ex: https://api-v2.contaazul.com/v1)
    const apiBase = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';
    const endpoint = `/financeiro/eventos-financeiros/${contaAzulId}/parcelas`;
    const apiUrl = `${apiBase.replace(/\/+$/, '')}${endpoint}`;

    let response;
    try {
      response = await axios.get(apiUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
    } catch (axiosErr: any) {
      const status = axiosErr.response?.status || 'unknown';
      const payload = axiosErr.response?.data ? JSON.stringify(axiosErr.response.data).substring(0, 200) : 'no payload';
      console.log(`[Enrich] FETCHED url=${apiUrl} status=${status} payload=${payload}`);
      console.log(`[Enrich] ERROR receivableId=${receivableId}: ${axiosErr.message}`);
      return res.status(400).json({
        success: false,
        receivableId,
        contaAzulId,
        reason: 'API_ERROR',
        apiStatus: status,
        error: axiosErr.message,
      });
    }

    if (response.status !== 200) {
      const payload = JSON.stringify(response.data).substring(0, 200);
      console.log(`[Enrich] FETCHED url=${apiUrl} status=${response.status} payload=${payload}`);
      console.log(`[Enrich] BLOCKED reason=API_ERROR status=${response.status}`);
      return res.status(400).json({
        success: false,
        receivableId,
        contaAzulId,
        reason: 'API_ERROR',
        apiStatus: response.status,
      });
    }

    // 5. Extrair payment info das parcelas
    const parcelas = response.data?.parcelas || response.data?.items || response.data || [];
    const payload = JSON.stringify(parcelas).substring(0, 200);
    console.log(`[Enrich] FETCHED url=${apiUrl} status=${response.status} payload=${payload}`);

    if (!Array.isArray(parcelas) || parcelas.length === 0) {
      console.log(`[Enrich] BLOCKED reason=NO_PAYMENT_INFO`);
      return res.status(400).json({
        success: false,
        receivableId,
        contaAzulId,
        reason: 'NO_PAYMENT_INFO',
        message: 'Nenhuma parcela encontrada com payment info',
      });
    }

    // 6. Extrair linhaDigitavel ou link público da primeira parcela
    let linhaDigitavel: string | null = null;
    let linkPublico: string | null = null;

    const parcela = parcelas[0];
    
    // Tentar extrair linhaDigitavel (prioridade 1)
    if (parcela.linhaDigitavel && String(parcela.linhaDigitavel).trim()) {
      linhaDigitavel = String(parcela.linhaDigitavel).trim();
      console.log(`[Enrich] EXTRACTED linhaDigitavel (masked)`);
    }

    // Tentar extrair link público (prioridade 2)
    if (!linhaDigitavel && parcela.link && String(parcela.link).trim()) {
      const linkStr = String(parcela.link).trim();
      // Validar se é link público (não contém api-v2.contaazul.com)
      if (!linkStr.includes('api-v2.contaazul.com')) {
        linkPublico = linkStr;
        console.log(`[Enrich] EXTRACTED linkPublico (masked)`);
      } else {
        console.log(`[Enrich] BLOCKED reason=PAYMENT_INFO_NOT_PUBLIC (link privado)`);
        return res.status(400).json({
          success: false,
          receivableId,
          contaAzulId,
          reason: 'PAYMENT_INFO_NOT_PUBLIC',
          message: 'Link é privado (api-v2.contaazul.com) e não há linhaDigitavel',
        });
      }
    }

    // Se não encontrou nenhum payment info válido
    if (!linhaDigitavel && !linkPublico) {
      console.log(`[Enrich] BLOCKED reason=NO_PAYMENT_INFO`);
      return res.status(400).json({
        success: false,
        receivableId,
        contaAzulId,
        reason: 'NO_PAYMENT_INFO',
        message: 'Nenhum payment info válido encontrado (sem linhaDigitavel ou link público)',
      });
    }

    // 7. Persistir no DB
    const updates: any = {};
    if (linhaDigitavel) updates.linhaDigitavel = linhaDigitavel;
    if (linkPublico) updates.link = linkPublico;
    if (linkPublico) updates.paymentInfoPublic = true;

    await db
      .update(receivables)
      .set(updates)
      .where(eq(receivables.id, receivableId));

    const updatedFields = Object.keys(updates).join(', ');
    console.log(`[Enrich] UPDATED fields=${updatedFields}`);

    return res.status(200).json({
      success: true,
      receivableId,
      contaAzulId,
      fetched: {
        linhaDigitavel: linhaDigitavel ? '***masked***' : undefined,
        linkPublico: linkPublico ? '***masked***' : undefined,
      },
      persisted: {
        linhaDigitavel: linhaDigitavel ? '***masked***' : undefined,
        linkPublico: linkPublico ? '***masked***' : undefined,
      },
    });
  } catch (error) {
    console.error(`[Enrich] INTERNAL_ERROR receivableId=${receivableId}:`, error);
    return res.status(500).json({
      success: false,
      receivableId,
      reason: 'INTERNAL_ERROR',
      error: (error as any).message,
    });
  }
});

export default router;
