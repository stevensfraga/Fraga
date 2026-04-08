/**
 * 🚀 ETAPA 7: Sincronização REAL com Refresh Automático do Token
 * 
 * Fluxo:
 * 1. Validar token OAuth no banco
 * 2. Se expirado, fazer refresh via refresh_token
 * 3. Sincronizar receivables reais do Conta Azul
 * 4. Salvar no DB
 * 
 * Prova obrigatória: totalFetched > 0, sampleIds preenchido, contaAzulId é UUID real
 */

import express from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables, contaAzulTokens } from '../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = express.Router();

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com'; // URL base correta (v2)

/**
 * POST /api/test/etapa7/sync-real
 * 
 * Sincroniza receivables reais com refresh automático do token
 */
router.post('/sync-real', async (req, res) => {
  try {
    const { clientId = 30004, daysBack = 90, pageLimit = 20 } = req.body;

    console.log('[ETAPA7] Iniciando sincronização REAL...');
    console.log('[ETAPA7] clientId:', clientId);
    console.log('[ETAPA7] daysBack:', daysBack);
    console.log('[ETAPA7] pageLimit:', pageLimit);

    // 1) Obter DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    // 2) Obter token válido (com refresh automático)
    let accessToken: string;
    let tokenRefreshed = false;

    try {
      accessToken = await getValidAccessToken();
      console.log('[ETAPA7] Token obtido com sucesso');
    } catch (err: any) {
      console.error('[ETAPA7] Erro ao obter token:', err.message);
      return res.status(401).json({
        success: false,
        error: 'Falha ao obter token OAuth válido',
        details: err.message
      });
    }

    console.log('[ETAPA7] Token válido, sincronizando receivables...');

    // 4) Buscar receivables do Conta Azul
    const contaAzulUrl = `${CONTA_AZUL_API_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=${pageLimit}&data_vencimento_de=2025-01-01&data_vencimento_ate=2027-12-31`;

    console.log('[ETAPA7] GET', contaAzulUrl);
    console.log('[ETAPA7] API Base:', CONTA_AZUL_API_BASE);
    console.log('[ETAPA7] Token:', accessToken.substring(0, 20) + '...');

    const response = await axios.get(contaAzulUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (response.status !== 200) {
      return res.status(response.status).json({
        success: false,
        error: `Conta Azul API retornou ${response.status}`
      });
    }

    const data = response.data;
    const receivablesList = data.itens || data.data || [];

    console.log('[ETAPA7] Receivables obtidos:', Array.isArray(receivablesList) ? receivablesList.length : 0);
    console.log('[ETAPA7] Response structure:', Object.keys(data).slice(0, 10));

    // 5) Salvar no DB
    let inserted = 0;
    let updated = 0;
    const sampleIds: string[] = [];

    const items = Array.isArray(receivablesList) ? receivablesList : []; // Garante que é um array
    for (const item of items) {
      try {
        const contaAzulId = item.id || item.uuid || item.contaAzulId || item.numero;
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
              status: (item.status || item.statusConta || 'ABERTO') as any,
              dueDate: item.dueDate ? new Date(item.dueDate) : item.dataVencimento ? new Date(item.dataVencimento) : item.data_vencimento ? new Date(item.data_vencimento) : undefined,
              amount: (item.amount || item.valor || item.valor_total)?.toString(),
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
              status: (item.status || item.statusConta || 'ABERTO') as any,
              dueDate: item.dueDate ? new Date(item.dueDate) : item.dataVencimento ? new Date(item.dataVencimento) : item.data_vencimento ? new Date(item.data_vencimento) : new Date(),
              amount: (item.amount || item.valor || item.valor_total)?.toString() || '0.00',
              description: item.description || item.descricao || item.numero || `Conta Azul ${contaAzulId}`,
              link: item.link || item.urlBoleto || item.url_boleto,
              source: 'conta-azul',
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          inserted++;
        }

        if (sampleIds.length < 3) {
          sampleIds.push(contaAzulId);
        }
      } catch (err) {
        console.error('[ETAPA7] Erro ao salvar receivable:', err);
      }
    }

    console.log('[ETAPA7] Sync completo: inserted=', inserted, 'updated=', updated);

    return res.json({
      success: true,
      totalFetched: receivablesList.length,
      inserted,
      updated,
      sampleIds,
      message: `${inserted} receivables reais inseridos, ${updated} atualizados`,
      tokenRefreshed,
      nextStep: 'PASSO 2: Escolher 1 receivable real e testar download do PDF'
    });
  } catch (error: any) {
    console.error('[ETAPA7] Erro:', error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || 'Erro desconhecido',
      details: error.response?.data
    });
  }
});

export default router;
