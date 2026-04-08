/**
 * 🔐 Endpoint de Sincronização com Token de Teste
 * 
 * Sincroniza receivables usando um token de teste válido
 * (sem depender de OAuth)
 */

import express from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

const CONTA_AZUL_API_BASE = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';

/**
 * POST /api/test/conta-azul/sync-with-token
 * 
 * Sincroniza receivables usando um token de teste fornecido
 * Requer: token (Bearer token válido do Conta Azul)
 */
router.post('/sync-with-token', async (req, res) => {
  try {
    const { token, clientId = 30004, daysBack = 365, pageLimit = 50 } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'token é obrigatório',
        hint: 'Forneça um Bearer token válido do Conta Azul'
      });
    }

    console.log('[ContaAzulSyncToken] Iniciando sincronização com token de teste...');
    console.log('[ContaAzulSyncToken] Token:', token.substring(0, 20) + '...');
    console.log('[ContaAzulSyncToken] API Base:', CONTA_AZUL_API_BASE);

    // 1) Buscar receivables do Conta Azul
    const contaAzulUrl = `${CONTA_AZUL_API_BASE}/contas-receber?limit=${pageLimit}`;

    console.log('[ContaAzulSyncToken] Buscando receivables em:', contaAzulUrl);

    const response = await axios.get(contaAzulUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data;
    const receivablesList = data.data || [];

    console.log('[ContaAzulSyncToken] Receivables obtidos:', receivablesList.length);

    // 2) Salvar no DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    let inserted = 0;
    let updated = 0;
    const sampleIds: string[] = [];

    for (const item of receivablesList) {
      try {
        const contaAzulId = item.id || item.uuid;
        if (!contaAzulId) continue;

        // Verificar se já existe
        const existing = await db
          .select()
          .from(receivables)
          .where(eq(receivables.contaAzulId, contaAzulId))
          .limit(1);

        if (existing.length > 0) {
          // UPDATE
          await db
            .update(receivables)
            .set({
              status: item.status,
              dueDate: item.dueDate ? new Date(item.dueDate) : undefined,
              amount: item.amount,
              updatedAt: new Date(),
            })
            .where(eq(receivables.contaAzulId, contaAzulId));
          updated++;
        } else {
          // INSERT
          await db
            .insert(receivables)
            .values({
              contaAzulId,
              clientId,
              status: item.status,
              dueDate: item.dueDate ? new Date(item.dueDate) : new Date(),
              amount: item.amount,
              description: item.description || `Conta Azul ${contaAzulId}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          inserted++;
        }

        if (sampleIds.length < 3) {
          sampleIds.push(contaAzulId);
        }
      } catch (err) {
        console.error('[ContaAzulSyncToken] Erro ao salvar receivable:', err);
      }
    }

    console.log('[ContaAzulSyncToken] Sync completo: inserted=', inserted, 'updated=', updated);

    return res.json({
      success: true,
      httpStatusContaAzul: response.status,
      totalFetched: receivablesList.length,
      inserted,
      updated,
      sampleIds,
      message: `${inserted} novos receivables inseridos, ${updated} atualizados`
    });
  } catch (error: any) {
    console.error('[ContaAzulSyncToken] Erro:', error.message);
    
    const errorResponse = {
      success: false,
      error: error.message || 'Erro desconhecido',
      httpStatus: error.response?.status,
      details: error.response?.data
    };

    return res.status(error.response?.status || 500).json(errorResponse);
  }
});

export default router;
