/**
 * TAREFA A1 - Gerar CSV de Clientes para Importação Conta Azul
 */

import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { isNull, eq, or } from 'drizzle-orm';

/**
 * Normalizar documento (remover caracteres especiais)
 */
function normalizeDocument(doc: string | null): string {
  if (!doc) return '';
  return doc.replace(/[^\d]/g, '');
}

/**
 * Normalizar telefone
 */
function normalizePhone(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d]/g, '');
  // Formato: (XX) XXXXX-XXXX
  if (digits.length === 11) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`;
  }
  return digits;
}

/**
 * Determinar tipo (PF/PJ) baseado em documento
 */
function determineTipo(document: string | null): string {
  if (!document) return 'PJ'; // Padrão
  const digits = document.replace(/[^\d]/g, '');
  if (digits.length === 11) return 'PF'; // CPF
  if (digits.length === 14) return 'PJ'; // CNPJ
  return 'PJ'; // Padrão
}

/**
 * Gerar CSV para importação Conta Azul
 */
export async function generateContaAzulCsv(): Promise<{ csv: string; count: number; duplicatesRemoved: number }> {
  try {
    console.log(`[GenerateCsv] Iniciando geração de CSV...`);

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Buscar todos os clientes
    const allClients = await db.select().from(clients);

    console.log(`[GenerateCsv] Total de clientes: ${allClients.length}`);

    // Deduplicar por documento e email
    const seen = new Set<string>();
    const deduplicated: typeof allClients = [];
    let duplicatesRemoved = 0;

    for (const client of allClients) {
      // Pular clientes sem nome
      if (!client.name || client.name.trim().length === 0) {
        console.log(`[GenerateCsv] SKIP clientId=${client.id} reason=NO_NAME`);
        duplicatesRemoved++;
        continue;
      }

      // Chave de deduplicação: documento ou email
      const docKey = normalizeDocument(client.document);
      const emailKey = client.email?.toLowerCase() || '';
      const key = docKey || emailKey;

      if (!key) {
        console.log(`[GenerateCsv] SKIP clientId=${client.id} reason=NO_DOC_NO_EMAIL`);
        duplicatesRemoved++;
        continue;
      }

      if (seen.has(key)) {
        console.log(`[GenerateCsv] SKIP clientId=${client.id} reason=DUPLICATE key=${key}`);
        duplicatesRemoved++;
        continue;
      }

      seen.add(key);
      deduplicated.push(client);
    }

    console.log(`[GenerateCsv] Após deduplicação: ${deduplicated.length} clientes`);
    console.log(`[GenerateCsv] Duplicados removidos: ${duplicatesRemoved}`);

    // Gerar CSV
    const csvLines: string[] = [];

    // Cabeçalho
    csvLines.push('nome,documento,email,telefone,tipo');

    // Dados
    for (const client of deduplicated) {
      const nome = client.name?.replace(/,/g, ' ') || ''; // Remover vírgulas
      const documento = normalizeDocument(client.document);
      const email = client.email?.toLowerCase() || '';
      const telefone = normalizePhone(client.phone);
      const tipo = determineTipo(client.document);

      csvLines.push(`"${nome}","${documento}","${email}","${telefone}","${tipo}"`);
    }

    const csv = csvLines.join('\n');

    console.log(`[GenerateCsv] CSV gerado com ${deduplicated.length} linhas`);

    return {
      csv,
      count: deduplicated.length,
      duplicatesRemoved,
    };
  } catch (error: any) {
    console.error(`[GenerateCsv] ERROR: ${error?.message}`);
    throw error;
  }
}
