/**
 * Endpoint de debug para inspecionar elegibilidade de receivables
 * Identifica motivos de bloqueio
 */

import express from 'express';
import { getDb } from '../db';
import { receivables, clients } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/collection/debug-eligibility
 * Inspecionar elegibilidade de receivables OVERDUE
 * 
 * Proteção: Requer header x-admin-key
 */
router.get('/debug-eligibility', async (req, res) => {
  try {
    // Proteção: Validar x-admin-key
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.FRAGA_ADMIN_KEY) {
      console.error('[DebugEligibility] ❌ FORBIDDEN: x-admin-key inválido ou ausente');
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'x-admin-key inválido ou ausente'
      });
    }
    
    console.log('[DebugEligibility] 🔍 Iniciando debug de elegibilidade...');
    
    const db = await getDb();
    if (!db) {
      throw new Error('Database não disponível');
    }
    
    // Buscar todos os receivables OVERDUE
    const overdueReceivables = await db
      .select({
        id: receivables.id,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        paymentLinkCanonical: receivables.paymentLinkCanonical,
        dispatchCount: receivables.dispatchCount,
        lastDispatchedAt: receivables.lastDispatchedAt,
        collectionScore: receivables.collectionScore,
      })
      .from(receivables)
      .where(eq(receivables.status, 'overdue'))
      .orderBy(sql`dispatchCount ASC, collectionScore DESC`)
      .limit(100);
    
    console.log(`[DebugEligibility] 📊 Encontrados ${overdueReceivables.length} receivables OVERDUE`);
    
    // Buscar clientes com WhatsApp
    const clientsWithWhatsapp = await db
      .select({
        id: clients.id,
        whatsappNumber: clients.whatsappNumber,
        optOut: clients.optOut,
      })
      .from(clients);
    
    const clientsMap = new Map(clientsWithWhatsapp.map(c => [c.id, c]));
    
    // Classificar receivables
    const eligible: any[] = [];
    const blocked: any[] = [];
    const reasons = {
      NO_PAYMENT_LINK: 0,
      NO_WHATSAPP: 0,
      OPTOUT: 0,
      RECENT_MESSAGE: 0,
      DISPATCH_COUNT_LIMIT: 0,
      OTHER: 0,
    };
    
    for (const receivable of overdueReceivables) {
      const client = clientsMap.get(receivable.clientId);
      const blockReasons: string[] = [];
      
      // Verificar paymentLinkCanonical
      if (!receivable.paymentLinkCanonical || receivable.paymentLinkCanonical.trim() === '') {
        blockReasons.push('NO_PAYMENT_LINK');
        reasons.NO_PAYMENT_LINK++;
      }
      
      // Verificar WhatsApp
      if (!client || !client.whatsappNumber || client.whatsappNumber.trim() === '') {
        blockReasons.push('NO_WHATSAPP');
        reasons.NO_WHATSAPP++;
      }
      
      // Verificar optOut
      if (client && client.optOut) {
        blockReasons.push('OPTOUT');
        reasons.OPTOUT++;
      }
      
      // Verificar mensagem recente (últimas 24h)
      if (receivable.lastDispatchedAt) {
        const hoursSinceLastDispatch = (Date.now() - new Date(receivable.lastDispatchedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastDispatch < 24) {
          blockReasons.push('RECENT_MESSAGE');
          reasons.RECENT_MESSAGE++;
        }
      }
      
      // Verificar limite de dispatchCount (exemplo: max 5)
      if (receivable.dispatchCount && receivable.dispatchCount >= 5) {
        blockReasons.push('DISPATCH_COUNT_LIMIT');
        reasons.DISPATCH_COUNT_LIMIT++;
      }
      
      // Classificar
      if (blockReasons.length === 0) {
        eligible.push({
          receivableId: receivable.id,
          clientId: receivable.clientId,
          amount: receivable.amount,
          daysOverdue: Math.floor((Date.now() - new Date(receivable.dueDate).getTime()) / (1000 * 60 * 60 * 24)),
          dispatchCount: receivable.dispatchCount || 0,
          collectionScore: receivable.collectionScore || 0,
        });
      } else {
        blocked.push({
          receivableId: receivable.id,
          clientId: receivable.clientId,
          amount: receivable.amount,
          blockReasons,
        });
      }
    }
    
    console.log('[DebugEligibility] ✅ Debug concluído');
    console.log(`[DebugEligibility] 📊 Elegíveis: ${eligible.length}, Bloqueados: ${blocked.length}`);
    
    return res.json({
      success: true,
      summary: {
        totalOverdue: overdueReceivables.length,
        eligible: eligible.length,
        blocked: blocked.length,
        reasons,
      },
      top10Eligible: eligible.slice(0, 10),
      top10Blocked: blocked.slice(0, 10),
    });
    
  } catch (error: any) {
    console.error('[DebugEligibility] ❌ Erro:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'Erro ao executar debug'
    });
  }
});

export default router;
