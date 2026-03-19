import express from 'express';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { receivables, contaAzulTokens } from '../drizzle/schema';
import { eq, desc } from 'drizzle-orm';

const CONTA_AZUL_API_BASE = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com';

const router = express.Router();

router.post('/sync-now', async (req, res) => {
  try {
    // 1) Validar chave admin
    const adminKey = req.header('x-fraga-admin-key');
    const expectedKey = process.env.FRAGA_ADMIN_KEY;

    if (!adminKey || !expectedKey || adminKey !== expectedKey) {
      console.log('[ContaAzulSyncPublic] Chave inválida ou ausente');
      return res.status(401).json({
        success: false,
        error: 'Chave admin inválida ou ausente'
      });
    }

    console.log('[ContaAzulSyncPublic] Chave validada');

    // 2) Obter token do banco (OAuth válido)
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    const tokenRecord = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.createdAt))
      .limit(1);

    if (!tokenRecord || tokenRecord.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Nenhum token OAuth encontrado no banco'
      });
    }

    const accessToken = tokenRecord[0].accessToken;
    console.log('[ContaAzulSyncPublic] Token obtido do banco:', accessToken.substring(0, 20) + '...');

    // 3) Buscar receivables do Conta Azul
    const clientId = req.body.clientId || 30004;
    const daysBack = req.body.daysBack || 365;
    const pageLimit = req.body.pageLimit || 50;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const contaAzulUrl = `${CONTA_AZUL_API_BASE}/v1/financeiro/contas-a-receber?pagina=1&tamanho_pagina=${pageLimit}`;

    console.log('[ContaAzulSyncPublic] Buscando receivables em:', contaAzulUrl);
    console.log('[ContaAzulSyncPublic] API Base:', process.env.CONTA_AZUL_API_BASE);

    const response = await fetch(contaAzulUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ContaAzulSyncPublic] Erro:', response.status, errorText);
      return res.status(response.status).json({
        success: false,
        error: `Conta Azul API retornou ${response.status}`,
        details: errorText.substring(0, 200)
      });
    }

    const data = await response.json();
    const receivablesList = data.itens || data.data || [];

    console.log('[ContaAzulSyncPublic] Receivables obtidos:', receivablesList.length);

    // 4) Salvar no DB (já conectado acima)

    let inserted = 0;
    let updated = 0;
    const sampleIds: string[] = [];

    for (const item of receivablesList) {
      try {
        const contaAzulId = item.id || item.uuid || item.contaAzulId;
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
              status: (item.status || item.statusConta || 'pending') as any,
              dueDate: item.dueDate ? new Date(item.dueDate) : item.dataVencimento ? new Date(item.dataVencimento) : undefined,
              amount: (item.amount || item.valor)?.toString(),
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
              status: (item.status || item.statusConta || 'pending') as any,
              dueDate: item.dueDate ? new Date(item.dueDate) : item.dataVencimento ? new Date(item.dataVencimento) : new Date(),
              amount: (item.amount || item.valor)?.toString() || '0.00',
              description: item.description || item.descricao || `Conta Azul ${contaAzulId}`,
              link: item.link || item.urlBoleto,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          inserted++;
        }

        if (sampleIds.length < 3) {
          sampleIds.push(contaAzulId);
        }
      } catch (err) {
        console.error('[ContaAzulSyncPublic] Erro ao salvar receivable:', err);
      }
    }

    console.log('[ContaAzulSyncPublic] Sync completo: inserted=', inserted, 'updated=', updated);

    return res.json({
      success: true,
      httpStatusContaAzul: response.status,
      totalFetched: receivablesList.length,
      inserted,
      updated,
      sampleIds,
      message: `${inserted} novos receivables inseridos, ${updated} atualizados`
    });
  } catch (error) {
    console.error('[ContaAzulSyncPublic] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

export default router;
