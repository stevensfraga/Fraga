/**
 * Parse Clients CSV Service
 * Extract clients from CSV and mark as managed
 */

import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { ilike } from 'drizzle-orm';
import * as fs from 'fs';
// Using native parsing instead of csv-parse

interface ClientFromCsv {
  nome: string;
  cnpjCpf: string;
  email: string;
  telefone: string;
  status: string;
}

/**
 * Parse CSV file and extract clients
 */
function parseCsvFile(filePath: string): ClientFromCsv[] {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    
    const clients: ClientFromCsv[] = [];

    // Skip header (line 0)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse CSV line with semicolon delimiter
      const fields = line.split(';').map(f => f.replace(/^"|"$/g, '').trim());

      const nome = fields[0] || '';
      const cnpjCpf = fields[2] || '';
      const email = fields[10] || '';
      const telefone = fields[11] || '';
      const status = fields[7] || '';  // Status is in column 7, not 8

      if (!nome || status !== 'ativado') {
        continue;
      }

      clients.push({
        nome,
        cnpjCpf,
        email,
        telefone,
        status,
      });
    }

    return clients;
  } catch (error: any) {
    console.error(`[ParseCsv] Error parsing CSV: ${error.message}`);
    throw error;
  }
}

/**
 * Normalize name for matching
 */
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/\s+(LTDA|ME|EPP|EIRELI|SA|SPA|LTDA-ME|PJ|PF)$/i, '');
}

/**
 * Mark clients as managed based on CSV
 */
export async function parseAndMarkManagedFromCsv(
  csvFilePath: string
): Promise<{ totalParsed: number; matched: number; notFound: number; samples: any[] }> {
  try {
    console.log(`[ParseCsv] Starting CSV parsing from ${csvFilePath}...`);

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Parse CSV
    const csvClients = parseCsvFile(csvFilePath);
    console.log(`[ParseCsv] Parsed ${csvClients.length} clients from CSV`);

    let matched = 0;
    let notFound = 0;
    const samples: any[] = [];
    const seen = new Set<string>();

    // Match with local database
    for (const csvClient of csvClients) {
      try {
        // Avoid duplicates
        if (seen.has(csvClient.nome)) {
          continue;
        }
        seen.add(csvClient.nome);

        // Search in database
        const matchedClients = await db
          .select()
          .from(clients)
          .where(ilike(clients.name, `%${csvClient.nome}%`))
          .limit(1);

        if (matchedClients.length === 0) {
          console.log(`[ParseCsv] NOT_FOUND: ${csvClient.nome}`);
          notFound++;
          continue;
        }

        const client = matchedClients[0];

        // Mark as managed (using status=active as proxy)
        await db
          .update(clients)
          .set({
            status: 'active',
          })
          .where(ilike(clients.name, `%${csvClient.nome}%`));

        console.log(`[ParseCsv] MATCHED: ${csvClient.nome} (clientId=${client.id})`);
        matched++;

        // Collect sample
        if (samples.length < 5) {
          samples.push({
            csvName: csvClient.nome,
            localName: client.name,
            email: csvClient.email,
            telefone: csvClient.telefone,
          });
        }
      } catch (error: any) {
        console.error(`[ParseCsv] ERROR matching ${csvClient.nome}: ${error.message}`);
      }
    }

    console.log(`[ParseCsv] Summary: total=${csvClients.length} matched=${matched} notFound=${notFound}`);

    return {
      totalParsed: csvClients.length,
      matched,
      notFound,
      samples,
    };
  } catch (error: any) {
    console.error(`[ParseCsv] FATAL: ${error?.message}`);
    throw error;
  }
}
