import { Router } from 'express';
import { getDb } from './db';
import { clients, receivables, collectionMessages } from '../drizzle/schema';
import { isNull, eq, ne, sql, and, inArray } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/test/data-quality/missing-document
 * Lista clientes SEM CPF/CNPJ (bloqueados para envio)
 * Retorna: lista + contagem para correção em lote
 */
router.get('/missing-document', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const result = await db
      .select({
        clientId: clients.id,
        name: clients.name,
        email: clients.email,
        whatsappNumber: clients.whatsappNumber,
        document: clients.document,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(
        isNull(clients.document) ||
        eq(clients.document, '')
      );

    res.json({
      count: result.length,
      items: result,
      message: `${result.length} clientes sem documento (bloqueados para envio)`,
    });
  } catch (error) {
    console.error('[DataQualitySanitation] Error:', error);
    res.status(500).json({ error: 'Failed to fetch missing document list' });
  }
});

/**
 * GET /api/test/data-quality/invalid-whatsapp-source
 * Lista clientes com whatsappSource inválido (não 'conta-azul')
 * Retorna: lista + contagem para validação/correção
 */
router.get('/invalid-whatsapp-source', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const result = await db
      .select({
        clientId: clients.id,
        name: clients.name,
        email: clients.email,
        whatsappNumber: clients.whatsappNumber,
        whatsappSource: clients.whatsappSource,
        whatsappValidatedAt: clients.whatsappValidatedAt,
        whatsappApprovedBy: clients.whatsappApprovedBy,
        document: clients.document,
      })
      .from(clients)
      .where(
        ne(clients.whatsappSource, 'conta-azul')
      );

    res.json({
      count: result.length,
      items: result,
      message: `${result.length} clientes com whatsappSource inválido (bloqueados para envio)`,
      actionRequired: 'Sincronizar com Conta Azul ou aprovar manualmente com whatsappValidatedAt preenchido',
    });
  } catch (error) {
    console.error('[DataQualitySanitation] Error:', error);
    res.status(500).json({ error: 'Failed to fetch invalid whatsapp source list' });
  }
});

/**
 * GET /api/test/data-quality/invalid-receivable-source
 * Lista receivables com source inválido (não 'conta-azul')
 * Retorna: lista + contagem para exclusão ou correção
 */
router.get('/invalid-receivable-source', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const result = await db
      .select({
        receivableId: receivables.id,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        source: receivables.source,
        status: receivables.status,
      })
      .from(receivables)
      .where(ne(receivables.source, 'conta-azul'));

    res.json({
      count: result.length,
      items: result,
      message: `${result.length} receivables com source inválido (bloqueados para envio)`,
      actionRequired: 'Corrigir source para conta-azul ou marcar como ignorado',
    });
  } catch (error) {
    console.error('[DataQualitySanitation] Error:', error);
    res.status(500).json({ error: 'Failed to fetch invalid receivable source list' });
  }
});

/**
 * GET /api/test/data-quality/sanitation-summary
 * Resumo executivo de todas as issues de qualidade + eligibleReceivablesCount
 * 
 * Critérios para elegível:
 * - clients.document NOT NULL/trim != ''
 * - clients.whatsappNumber NOT NULL/trim != ''
 * - clients.whatsappSource='conta-azul'
 * - clients.optOut=false
 * - receivables.source='conta-azul'
 * - receivables.status IN ('pending','overdue')
 * - amount > 0
 * - anti-duplicidade (últimos 7 dias)
 */
router.get('/sanitation-summary', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Contar issues
    const missingDocCountResult = await db
      .select({ count: sql`COUNT(*)` })
      .from(clients)
      .where(isNull(clients.document) || eq(clients.document, ''));
    
    const missingDocCount = parseInt(String(missingDocCountResult[0]?.count || 0));

    const invalidWhatsappCountResult = await db
      .select({ count: sql`COUNT(*)` })
      .from(clients)
      .where(ne(clients.whatsappSource, 'conta-azul'));
    
    const invalidWhatsappCount = parseInt(String(invalidWhatsappCountResult[0]?.count || 0));

    const invalidReceivableCountResult = await db
      .select({ count: sql`COUNT(*)` })
      .from(receivables)
      .where(ne(receivables.source, 'conta-azul'));
    
    const invalidReceivableCount = parseInt(String(invalidReceivableCountResult[0]?.count || 0));

    // Contar receivables elegíveis (sem duplicata nos últimos 7 dias)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Buscar receivables com clientes válidos
    const allEligibleCandidates = await db
      .select({
        receivableId: receivables.id,
      })
      .from(receivables)
      .innerJoin(clients, eq(receivables.clientId, clients.id))
      .where(
        and(
          // Cliente válido
          ne(clients.document, ''),
          ne(clients.whatsappNumber, ''),
          eq(clients.whatsappSource, 'conta-azul'),
          eq(clients.optOut, false),
          // Receivable válido
          eq(receivables.source, 'conta-azul'),
          inArray(receivables.status, ['pending', 'overdue']),
          sql`${receivables.amount} > 0`
        )
      );

    // Filtrar por anti-duplicidade
    let eligibleReceivablesCount = 0;
    for (const candidate of allEligibleCandidates) {
      const recentMessages = await db
        .select({ id: collectionMessages.id })
        .from(collectionMessages)
        .where(
          and(
            eq(collectionMessages.receivableId, candidate.receivableId),
            inArray(collectionMessages.status, ['sent', 'delivered', 'read']),
            sql`${collectionMessages.sentAt} > ${sevenDaysAgo}`
          )
        )
        .limit(1);

      if (recentMessages.length === 0) {
        eligibleReceivablesCount++;
      }
    }

    const canSchedulerRun = 
      missingDocCount === 0 &&
      invalidWhatsappCount === 0 &&
      invalidReceivableCount === 0 &&
      eligibleReceivablesCount > 0;

    const nextSteps: string[] = [];
    if (missingDocCount > 0) nextSteps.push(`Preencher documento em ${missingDocCount} clientes`);
    if (invalidWhatsappCount > 0) nextSteps.push(`Validar WhatsApp em ${invalidWhatsappCount} clientes`);
    if (invalidReceivableCount > 0) nextSteps.push(`Corrigir source em ${invalidReceivableCount} receivables`);
    if (eligibleReceivablesCount === 0 && missingDocCount === 0 && invalidWhatsappCount === 0 && invalidReceivableCount === 0) {
      nextSteps.push('Nenhum receivable elegível encontrado');
    }

    res.json({
      timestamp: new Date().toISOString(),
      issues: {
        missingDocument: missingDocCount,
        invalidWhatsappSource: invalidWhatsappCount,
        invalidReceivableSource: invalidReceivableCount,
      },
      eligibleReceivablesCount,
      canSchedulerRun,
      message: canSchedulerRun 
        ? `Base de dados está limpa - scheduler pode rodar (${eligibleReceivablesCount} receivables elegíveis)`
        : 'Issues de qualidade detectadas ou sem elegíveis - scheduler bloqueado',
      nextSteps,
    });
  } catch (error) {
    console.error('[DataQualitySanitation] Error:', error);
    res.status(500).json({ error: 'Failed to generate sanitation summary' });
  }
});

export default router;
