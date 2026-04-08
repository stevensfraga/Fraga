import { getDb } from '../db';
import { clients, receivables, collectionMessages } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Scheduler Integrity Check Service
 * Valida se a base está pronta para envios automáticos
 * Bloqueio global se qualquer condição falhar
 */

export interface IntegrityCheckResult {
  success: boolean;
  canSchedulerRun: boolean;
  checks: {
    invalid_whatsapp_source: number;
    duplicate_numbers: number;
    clients_without_document: number;
    receivables_invalid_source: number;
    receivables_invalid_amount: number;
    receivables_invalid_due_date: number;
  };
  blockedReasons: string[];
  readyForDispatch: number;
  totalEligibleReceivables: number;
}

export async function checkSchedulerIntegrity(): Promise<IntegrityCheckResult> {
  const db = await getDb();
  
  const result: IntegrityCheckResult = {
    success: false,
    canSchedulerRun: false,
    checks: {
      invalid_whatsapp_source: 0,
      duplicate_numbers: 0,
      clients_without_document: 0,
      receivables_invalid_source: 0,
      receivables_invalid_amount: 0,
      receivables_invalid_due_date: 0,
    },
    blockedReasons: [],
    readyForDispatch: 0,
    totalEligibleReceivables: 0,
  };

  try {
    if (!db) {
      result.blockedReasons.push('Database connection failed');
      console.error('[SchedulerIntegrity] DB_CONNECTION_FAILED');
      return result;
    }

    // 1. Buscar todos os dados
    const allClients = await db.select().from(clients);
    const allReceivables = await db.select().from(receivables);

    // 2. Verificar whatsappSource inválido
    const invalidWhatsappSource = allClients.filter(
      c => c.whatsappNumber && 
           String(c.whatsappNumber).trim().length > 0 && 
           c.whatsappSource !== 'conta-azul'
    ).length;
    result.checks.invalid_whatsapp_source = invalidWhatsappSource;

    // 3. Verificar números duplicados
    const phoneGroups = new Map<string, number>();
    allClients.forEach(c => {
      if (c.whatsappNumber) {
        const phone = String(c.whatsappNumber);
        phoneGroups.set(phone, (phoneGroups.get(phone) || 0) + 1);
      }
    });
    const duplicateNumbers = Array.from(phoneGroups.values()).filter(count => count > 1).length;
    result.checks.duplicate_numbers = duplicateNumbers;

    // 4. Verificar clientes sem documento
    const clientsWithoutDocument = allClients.filter(
      c => !c.document || String(c.document).trim().length === 0
    ).length;
    result.checks.clients_without_document = clientsWithoutDocument;

    // 5. Verificar receivables com source inválido
    const receivablesInvalidSource = allReceivables.filter(
      r => r.source !== 'conta-azul'
    ).length;
    result.checks.receivables_invalid_source = receivablesInvalidSource;

    // 6. Verificar receivables com amount <= 0
    const receivablesInvalidAmount = allReceivables.filter(
      r => !r.amount || parseFloat(String(r.amount)) <= 0
    ).length;
    result.checks.receivables_invalid_amount = receivablesInvalidAmount;

    // 7. Verificar receivables com dueDate inválida
    const receivablesInvalidDueDate = allReceivables.filter(
      r => !r.dueDate || new Date(r.dueDate) < new Date('2000-01-01')
    ).length;
    result.checks.receivables_invalid_due_date = receivablesInvalidDueDate;

    // 8. Contar receivables elegíveis (que podem ser enviados)
    const elegibleReceivables = allReceivables.filter(r => {
      const client = allClients.find(c => c.id === r.clientId);
      if (!client) return false;
      
      // Validações obrigatórias
      if (!client.document || String(client.document).trim().length === 0) return false;
      if (client.whatsappSource !== 'conta-azul') return false;
      if (!client.whatsappNumber || String(client.whatsappNumber).trim().length === 0) return false;
      if (client.optOut === true) return false;
      if (r.source !== 'conta-azul') return false;
      if (!r.amount || parseFloat(String(r.amount)) <= 0) return false;
      if (!r.dueDate || new Date(r.dueDate) < new Date('2000-01-01')) return false;
      if (r.status !== 'pending' && r.status !== 'overdue') return false;
      
      return true;
    });

    result.readyForDispatch = elegibleReceivables.length;
    result.totalEligibleReceivables = allReceivables.filter(
      r => r.status === 'pending' || r.status === 'overdue'
    ).length;

    // 9. Validar integridade
    if (invalidWhatsappSource > 0) {
      result.blockedReasons.push(`invalid_whatsapp_source=${invalidWhatsappSource}`);
    }
    if (duplicateNumbers > 0) {
      result.blockedReasons.push(`duplicate_numbers=${duplicateNumbers}`);
    }
    if (clientsWithoutDocument > 0) {
      result.blockedReasons.push(`clients_without_document=${clientsWithoutDocument}`);
    }
    if (receivablesInvalidSource > 0) {
      result.blockedReasons.push(`receivables_invalid_source=${receivablesInvalidSource}`);
    }
    if (receivablesInvalidAmount > 0) {
      result.blockedReasons.push(`receivables_invalid_amount=${receivablesInvalidAmount}`);
    }
    if (receivablesInvalidDueDate > 0) {
      result.blockedReasons.push(`receivables_invalid_due_date=${receivablesInvalidDueDate}`);
    }

    // 10. Determinar se scheduler pode rodar
    result.canSchedulerRun = result.blockedReasons.length === 0 && result.readyForDispatch > 0;
    result.success = true;

    if (result.canSchedulerRun) {
      console.log(`[SchedulerIntegrity] OK - readyForDispatch=${result.readyForDispatch}`);
    } else {
      console.warn(`[SchedulerIntegrity] BLOCKED - reasons=${result.blockedReasons.join(', ')}`);
    }

    return result;
  } catch (error: any) {
    console.error('[SchedulerIntegrity] ERROR:', error.message);
    result.blockedReasons.push(`error=${error.message}`);
    return result;
  }
}
