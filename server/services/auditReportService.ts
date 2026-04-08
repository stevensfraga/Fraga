import { getDb } from '../db';
import { receivables, clients } from '../../drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';

export interface AuditReport {
  timestamp: string;
  total_receivables: number;
  total_eligible: number;
  total_blocked: number;
  blocked_breakdown: {
    no_document: number;
    invalid_source: number;
    duplicate_phone: number;
    invalid_whatsapp_source: number;
    opt_out: number;
    test_data: number;
    invalid_amount: number;
    invalid_due_date: number;
    invalid_status: number;
    no_whatsapp: number;
  };
  top_duplicates: Array<{
    whatsapp_number: string;
    client_count: number;
    client_ids: number[];
    client_names: string[];
  }>;
  without_document: Array<{
    client_id: number;
    client_name: string;
    whatsapp_number: string | null;
    receivable_count: number;
  }>;
  invalid_source_receivables: Array<{
    receivable_id: number;
    source: string;
    client_name: string;
    amount: string;
  }>;
  invalid_whatsapp_source: Array<{
    client_id: number;
    client_name: string;
    whatsapp_number: string | null;
    whatsapp_source: string;
    receivable_count: number;
  }>;
}

/**
 * Gerar relatório de auditoria (dry-run)
 * Identifica todos os bloqueios sem enviar mensagens
 */
export async function generateAuditReport(): Promise<AuditReport> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    total_receivables: 0,
    total_eligible: 0,
    total_blocked: 0,
    blocked_breakdown: {
      no_document: 0,
      invalid_source: 0,
      duplicate_phone: 0,
      invalid_whatsapp_source: 0,
      opt_out: 0,
      test_data: 0,
      invalid_amount: 0,
      invalid_due_date: 0,
      invalid_status: 0,
      no_whatsapp: 0,
    },
    top_duplicates: [],
    without_document: [],
    invalid_source_receivables: [],
    invalid_whatsapp_source: [],
  };

  // 1. Buscar todos os receivables elegíveis (pending + overdue)
  const allReceivables = await db
    .select()
    .from(receivables)
    .where(
      inArray(receivables.status, ['pending', 'overdue'])
    );

  report.total_receivables = allReceivables.length;

  // 2. Buscar todos os clientes
  const allClients = await db.select().from(clients);
  const clientMap = new Map(allClients.map(c => [c.id, c]));

  // 3. Buscar números duplicados
  const phoneGroups = new Map<string, Array<{ id: number; name: string }>>();
  for (const client of allClients) {
    if (client.whatsappNumber && String(client.whatsappNumber).trim().length > 0) {
      const phone = String(client.whatsappNumber);
      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, []);
      }
      const group = phoneGroups.get(phone);
      if (group) {
        group.push({ id: client.id, name: client.name || 'N/A' });
      }
    }
  }

  // Filtrar apenas duplicados
  phoneGroups.forEach((clients_list: Array<{ id: number; name: string }>, phone: string) => {
    if (clients_list.length > 1) {
      report.top_duplicates.push({
        whatsapp_number: phone,
        client_count: clients_list.length,
        client_ids: clients_list.map((c: any) => c.id),
        client_names: clients_list.map((c: any) => c.name || 'N/A'),
      });
    }
  });

  // 4. Clientes sem documento
  for (const client of allClients) {
    if (!client.document || String(client.document).trim().length === 0) {
      const receivableCount = allReceivables.filter(r => r.clientId === client.id).length;
      if (receivableCount > 0) {
        report.without_document.push({
          client_id: client.id,
          client_name: client.name || 'N/A',
          whatsapp_number: client.whatsappNumber || null,
          receivable_count: receivableCount,
        });
        report.blocked_breakdown.no_document += receivableCount;
      }
    }
  }

  // 4.5 Clientes com whatsappSource inválido (não 'conta-azul')
  for (const client of allClients) {
    if (client.whatsappNumber && String(client.whatsappNumber).trim().length > 0 && client.whatsappSource !== 'conta-azul') {
      const receivableCount = allReceivables.filter(r => r.clientId === client.id).length;
      if (receivableCount > 0) {
        report.invalid_whatsapp_source.push({
          client_id: client.id,
          client_name: client.name || 'N/A',
          whatsapp_number: client.whatsappNumber || null,
          whatsapp_source: client.whatsappSource || 'unknown',
          receivable_count: receivableCount,
        });
        report.blocked_breakdown.invalid_whatsapp_source += receivableCount;
      }
    }
  }

  // 5. Receivables com source inválido
  for (const receivable of allReceivables) {
    if (receivable.source !== 'conta-azul') {
      const client = clientMap.get(receivable.clientId);
      report.invalid_source_receivables.push({
        receivable_id: receivable.id,
        source: receivable.source || 'null',
        client_name: client?.name || 'N/A',
        amount: String(receivable.amount),
      });
      report.blocked_breakdown.invalid_source++;
    }
  }

  // 6. Validar cada receivable para contar bloqueios
  for (const receivable of allReceivables) {
    const client = clientMap.get(receivable.clientId);
    if (!client) continue;

    let isBlocked = false;

    // Test data
    if (
      receivable.source === 'test' ||
      receivable.contaAzulId?.startsWith('receivable_test_') ||
      client.name?.includes('Teste')
    ) {
      report.blocked_breakdown.test_data++;
      isBlocked = true;
    }

    // Sem documento
    if (!client.document || String(client.document).trim().length === 0) {
      // Já contado acima
      isBlocked = true;
    }

    // Source inválido
    if (receivable.source !== 'conta-azul') {
      // Já contado acima
      isBlocked = true;
    }

    // Número duplicado
    if (client.whatsappNumber) {
      const group = phoneGroups.get(String(client.whatsappNumber));
      if (group && group.length > 1) {
        report.blocked_breakdown.duplicate_phone++;
        isBlocked = true;
      }
    }

    // WhatsApp source inválido
    if (client.whatsappNumber && String(client.whatsappNumber).trim().length > 0 && client.whatsappSource !== 'conta-azul') {
      report.blocked_breakdown.invalid_whatsapp_source++;
      isBlocked = true;
    }

    // Opt-out
    if (client.optOut === true) {
      report.blocked_breakdown.opt_out++;
      isBlocked = true;
    }

    // Sem WhatsApp
    if (!client.whatsappNumber || String(client.whatsappNumber).trim().length === 0) {
      report.blocked_breakdown.no_whatsapp++;
      isBlocked = true;
    }

    // Amount inválido
    const amountNum = typeof receivable.amount === 'string' ? parseFloat(receivable.amount) : (receivable.amount || 0);
    if (!amountNum || amountNum <= 0) {
      report.blocked_breakdown.invalid_amount++;
      isBlocked = true;
    }

    // DueDate inválido
    if (!receivable.dueDate || isNaN(new Date(receivable.dueDate).getTime())) {
      report.blocked_breakdown.invalid_due_date++;
      isBlocked = true;
    }

    // Status inválido
    if (!receivable.status || !['pending', 'overdue'].includes(receivable.status)) {
      report.blocked_breakdown.invalid_status++;
      isBlocked = true;
    }

    if (!isBlocked) {
      report.total_eligible++;
    } else {
      report.total_blocked++;
    }
  }

  // 7. Ordenar duplicados por quantidade (DESC)
  report.top_duplicates.sort((a, b) => b.client_count - a.client_count);

  return report;
}
