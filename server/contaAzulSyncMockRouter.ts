/**
 * 🧪 Endpoint de Sincronização com Dados Mock
 * 
 * Insere receivables de teste no banco para validar estrutura
 * Útil para testar ETAPA 5 sem depender de token OAuth válido
 */

import express from 'express';
import { getDb } from './db';
import { receivables, type InsertReceivable } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

/**
 * POST /api/test/conta-azul/sync-mock
 * 
 * Insere receivables mock no banco
 * Simula sincronização real do Conta Azul
 */
router.post('/sync-mock', async (req, res) => {
  try {
    const { clientId = 30004, count = 5 } = req.body;

    console.log('[ContaAzulSyncMock] Iniciando sincronização mock...');
    console.log('[ContaAzulSyncMock] clientId:', clientId);
    console.log('[ContaAzulSyncMock] count:', count);

    // Gerar receivables mock
    const mockReceivables: Array<{id: string; uuid: string; status: string; dueDate: string; amount: number; description: string}> = [];
    for (let i = 0; i < count; i++) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - (i * 10)); // Variar datas

      mockReceivables.push({
        id: `mock-${Date.now()}-${i}`,
        uuid: `uuid-${Date.now()}-${i}`,
        status: i % 2 === 0 ? 'pending' : 'overdue',
        dueDate: dueDate.toISOString(),
        amount: 1000 + (i * 500),
        description: `Boleto Mock ${i + 1} - Teste ETAPA 5`,
      });
    }

    console.log('[ContaAzulSyncMock] Receivables mock gerados:', mockReceivables.length);

    // Salvar no DB
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

    for (const item of mockReceivables) {
      try {
        const contaAzulId = item.id || item.uuid;

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
              status: item.status as 'pending' | 'overdue' | 'paid' | 'cancelled',
              dueDate: new Date(item.dueDate),
              amount: item.amount.toString(),
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
              status: item.status as 'pending' | 'overdue' | 'paid' | 'cancelled',
              dueDate: new Date(item.dueDate),
              amount: item.amount.toString(),
              description: item.description,
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
        console.error('[ContaAzulSyncMock] Erro ao salvar receivable:', err);
      }
    }

    console.log('[ContaAzulSyncMock] Sync completo: inserted=', inserted, 'updated=', updated);

    return res.json({
      success: true,
      totalFetched: mockReceivables.length,
      inserted,
      updated,
      sampleIds,
      message: `${inserted} receivables mock inseridos, ${updated} atualizados`,
      note: 'Dados são mock para teste. Use /sync-now para dados reais.'
    });
  } catch (error: any) {
    console.error('[ContaAzulSyncMock] Erro:', error.message);
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro desconhecido'
    });
  }
});

export default router;
