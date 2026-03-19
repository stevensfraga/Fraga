import { getDb } from '../db';
import { clients, receivables } from '../../drizzle/schema';
import { eq, isNull, ne } from 'drizzle-orm';

export interface DataQualityReport {
  missingDocument: Array<{ clientId: number; name: string; whatsappNumber: string | null }>;
  invalidWhatsappSource: Array<{ clientId: number; name: string; whatsappSource: string }>;
  invalidReceivableSource: Array<{ receivableId: number; clientId: number; source: string }>;
  summary: {
    totalClients: number;
    blockedClients: number;
    totalReceivables: number;
    blockedReceivables: number;
    canSchedulerRun: boolean;
  };
}

/**
 * Gerar relatório de qualidade de dados
 * Identifica bloqueios estruturais que impedem envios
 */
export async function generateDataQualityReport(): Promise<DataQualityReport> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 1. Clientes sem documento
    const missingDocumentResult = await db
      .select({
        clientId: clients.id,
        name: clients.name,
        whatsappNumber: clients.whatsappNumber,
      })
      .from(clients)
      .where(
        isNull(clients.document) ||
        eq(clients.document, '')
      );

    // 2. WhatsApp com source inválido
    const invalidWhatsappSourceResult = await db
      .select({
        clientId: clients.id,
        name: clients.name,
        whatsappSource: clients.whatsappSource,
      })
      .from(clients)
      .where(
        ne(clients.whatsappSource, 'conta-azul')
      );

    // 3. Receivables com source inválido
    const invalidReceivableSourceResult = await db
      .select({
        receivableId: receivables.id,
        clientId: receivables.clientId,
        source: receivables.source,
      })
      .from(receivables)
      .where(
        ne(receivables.source, 'conta-azul')
      );

    // 4. Contar totais
    const totalClientsResult = await db
      .select({ count: clients.id })
      .from(clients);

    const totalReceivablesResult = await db
      .select({ count: receivables.id })
      .from(receivables);

    const totalClients = totalClientsResult.length;
    const totalReceivables = totalReceivablesResult.length;
    const blockedClients = missingDocumentResult.length + invalidWhatsappSourceResult.length;
    const blockedReceivables = invalidReceivableSourceResult.length;

    // 5. Determinar se scheduler pode rodar
    const canSchedulerRun = 
      missingDocumentResult.length === 0 &&
      invalidWhatsappSourceResult.length === 0 &&
      invalidReceivableSourceResult.length === 0;

    console.log(`[DataQuality] Report generated: totalClients=${totalClients}, blockedClients=${blockedClients}, canSchedulerRun=${canSchedulerRun}`);

    return {
      missingDocument: missingDocumentResult,
      invalidWhatsappSource: invalidWhatsappSourceResult,
      invalidReceivableSource: invalidReceivableSourceResult,
      summary: {
        totalClients,
        blockedClients,
        totalReceivables,
        blockedReceivables,
        canSchedulerRun,
      },
    };
  } catch (error) {
    console.error('[DataQuality] Error generating report:', error);
    throw error;
  }
}
