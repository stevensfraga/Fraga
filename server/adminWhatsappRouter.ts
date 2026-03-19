import { Router } from 'express';
import { getDb } from './db';
import { clients, receivables } from '../drizzle/schema';
import { eq, and, ne } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/admin/whatsapp-pending-validation
 * Lista clientes com whatsappNumber não validado (source != 'conta-azul')
 * Requer autenticação admin
 */
router.get('/whatsapp-pending-validation', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database connection failed' });
    }

    // Buscar clientes com WhatsApp não validado
    const allClients = await db
      .select()
      .from(clients);

    const pendingClients = allClients.filter(
      c => c.whatsappNumber && 
           String(c.whatsappNumber).trim().length > 0 && 
           c.whatsappSource !== 'conta-azul'
    );

    // Para cada cliente, contar receivables
    const allReceivables = await db
      .select()
      .from(receivables);

    const result = pendingClients.map(client => {
      const receivableCount = allReceivables.filter(r => r.clientId === client.id).length;
      const lastReceivable = allReceivables
        .filter(r => r.clientId === client.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      return {
        clientId: client.id,
        clientName: client.name,
        document: client.document,
        whatsappNumber: client.whatsappNumber,
        whatsappSource: client.whatsappSource,
        receivableCount,
        lastReceivableAmount: lastReceivable?.amount || null,
        lastReceivableDueDate: lastReceivable?.dueDate || null,
      };
    });

    res.json({
      success: true,
      total: result.length,
      pending: result,
    });
  } catch (error: any) {
    console.error('[AdminWhatsapp] Erro ao listar clientes pendentes:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/approve-whatsapp/:clientId
 * Aprova WhatsApp de um cliente (marca como 'manual')
 * Body: { approvedBy?: string } - Quem aprovou (email ou ID)
 * Requer autenticação admin
 */
router.post('/approve-whatsapp/:clientId', async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) {
      return res.status(400).json({ error: 'Invalid clientId' });
    }

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database connection failed' });
    }

    // Buscar cliente
    const client = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));

    if (client.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Atualizar whatsappSource para 'manual' com auditoria formal
    const approvedBy = req.body?.approvedBy || 'admin-api';
    const now = new Date();
    
    await db
      .update(clients)
      .set({
        whatsappSource: 'manual',
        whatsappValidatedAt: now,
        whatsappApprovedBy: approvedBy,
        whatsappApprovalMethod: 'manual-approval',
        updatedAt: now,
      })
      .where(eq(clients.id, clientId));

    console.log(`[WhatsappApproval] APROVADO_MANUAL - clientId=${clientId}, name=${client[0].name}, approvedBy=${approvedBy}, validatedAt=${now.toISOString()}`);

    res.json({
      success: true,
      clientId,
      clientName: client[0].name,
      whatsappNumber: client[0].whatsappNumber,
      whatsappSource: 'manual',
      whatsappValidatedAt: now.toISOString(),
      whatsappApprovedBy: approvedBy,
      whatsappApprovalMethod: 'manual-approval',
      message: 'WhatsApp aprovado manualmente com auditoria formal',
    });
  } catch (error: any) {
    console.error('[AdminWhatsapp] Erro ao aprovar WhatsApp:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/whatsapp-validation-status
 * Retorna status geral de validação de WhatsApp
 */
router.get('/whatsapp-validation-status', async (req, res) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database connection failed' });
    }

    const allClients = await db
      .select()
      .from(clients);

    const validatedContaAzul = allClients.filter(c => c.whatsappSource === 'conta-azul').length;
    const validatedManual = allClients.filter(c => c.whatsappSource === 'manual').length;
    const validatedImport = allClients.filter(c => c.whatsappSource === 'import').length;
    const unknown = allClients.filter(c => c.whatsappSource === 'unknown').length;
    const withWhatsapp = allClients.filter(c => c.whatsappNumber && String(c.whatsappNumber).trim().length > 0).length;

    res.json({
      success: true,
      totalClients: allClients.length,
      clientsWithWhatsapp: withWhatsapp,
      validationBreakdown: {
        contaAzul: validatedContaAzul,
        manual: validatedManual,
        import: validatedImport,
        unknown: unknown,
      },
      readyForDispatch: validatedContaAzul + validatedManual,
      pendingValidation: unknown,
    });
  } catch (error: any) {
    console.error('[AdminWhatsapp] Erro ao obter status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
