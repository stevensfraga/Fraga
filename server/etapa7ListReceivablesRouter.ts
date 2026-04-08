/**
 * PASSO 2: Listar receivables reais sincronizados
 * 
 * Endpoint: GET /api/test/etapa7/list-receivables
 */

import express from 'express';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/test/etapa7/list-receivables
 * 
 * Lista receivables reais do Conta Azul
 */
router.get('/list-receivables', async (req, res) => {
  try {
    const { clientId = 30004, limit = 10 } = req.query;

    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database connection failed'
      });
    }

    // Buscar receivables reais (não mock)
    const items = await db
      .select()
      .from(receivables)
      .where(eq(receivables.clientId, Number(clientId)))
      .limit(Number(limit));

    const realItems = items.filter(r => r.contaAzulId && !r.contaAzulId.startsWith('mock-'));

    console.log('[ListReceivables] Total:', items.length, 'Reais:', realItems.length);

    return res.json({
      success: true,
      total: items.length,
      realCount: realItems.length,
      items: realItems.map(r => ({
        id: r.id,
        contaAzulId: r.contaAzulId,
        clientId: r.clientId,
        amount: r.amount,
        dueDate: r.dueDate,
        status: r.status,
        description: r.description,
        link: r.link,
        source: r.source,
      })),
      nextStep: realItems.length > 0 ? 'PASSO 2: Escolher 1 receivable real acima e testar download do PDF' : 'Nenhum receivable real encontrado'
    });
  } catch (error: any) {
    console.error('[ListReceivables] Erro:', error.message);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
