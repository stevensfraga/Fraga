/**
 * Endpoint administrativo para sync manual de receivables
 * Popula paymentLinkCanonical e desbloqueia NO_PAYMENT_LINK
 */

import express from 'express';
import { getDb } from '../db';
import { receivables } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

/**
 * POST /api/collection/sync-now
 * Sincronizar receivables do Conta Azul manualmente
 * 
 * Proteção: Requer header x-admin-key
 */
router.post('/sync-now', async (req, res) => {
  try {
    // Proteção: Validar x-admin-key
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.FRAGA_ADMIN_KEY) {
      console.error('[SyncNow] ❌ FORBIDDEN: x-admin-key inválido ou ausente');
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'x-admin-key inválido ou ausente'
      });
    }
    
    console.log('[SyncNow] 🔄 Iniciando sync manual de receivables...');
    
    const db = await getDb();
    if (!db) {
      throw new Error('Database não disponível');
    }
    
    // Buscar todos os receivables OVERDUE
    const overdueReceivables = await db
      .select()
      .from(receivables)
      .where(eq(receivables.status, 'overdue'));
    
    console.log(`[SyncNow] 📊 Encontrados ${overdueReceivables.length} receivables OVERDUE`);
    
    let updated = 0;
    let withLink = 0;
    let withoutLink = 0;
    
    // Processar cada receivable
    for (const receivable of overdueReceivables) {
      // Se já tem paymentLinkCanonical, contar
      if (receivable.paymentLinkCanonical && receivable.paymentLinkCanonical.trim() !== '') {
        withLink++;
        continue;
      }
      
      // Se tem link mas não tem paymentLinkCanonical, copiar
      if (receivable.link && receivable.link.trim() !== '') {
        await db
          .update(receivables)
          .set({ paymentLinkCanonical: receivable.link })
          .where(eq(receivables.id, receivable.id));
        
        updated++;
        withLink++;
        console.log(`[SyncNow] ✅ Receivable ${receivable.id}: paymentLinkCanonical copiado de link`);
      } else {
        withoutLink++;
        console.log(`[SyncNow] ⚠️ Receivable ${receivable.id}: SEM link disponível`);
      }
    }
    
    console.log('[SyncNow] ✅ Sync manual concluído');
    console.log(`[SyncNow] 📊 Resumo: ${updated} atualizados, ${withLink} com link, ${withoutLink} sem link`);
    
    return res.json({
      success: true,
      updated,
      overdue: overdueReceivables.length,
      withLink,
      withoutLink,
      message: `Sync concluído: ${updated} receivables atualizados`
    });
    
  } catch (error: any) {
    console.error('[SyncNow] ❌ Erro ao executar sync:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'Erro ao executar sync'
    });
  }
});

export default router;
