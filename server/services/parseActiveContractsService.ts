/**
 * Parse Active Contracts Service
 * Extrair contratos ativos dos PDFs e marcar clientes como managed
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { ilike } from 'drizzle-orm';
import * as fs from 'fs';

const execAsync = promisify(exec);

interface ActiveContract {
  numero: string;
  cliente: string;
  valor: number;
  proximoVencimento: string;
}

/**
 * Extrair texto do PDF usando Python
 */
async function extractPdfText(pdfPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`python3 /home/ubuntu/fraga-dashboard/extract_pdf_text.py "${pdfPath}"`);
    return stdout;
  } catch (error: any) {
    console.error(`[ParsePDF] Error extracting ${pdfPath}: ${error.message}`);
    console.error(`[ParsePDF] stderr: ${error.stderr}`);
    throw error;
  }
}

/**
 * Parsear contratos ativos do texto extraído
 * Usa regex global para capturar todas as linhas com padrão
 */
function parseActiveContracts(text: string): ActiveContract[] {
  const contracts: ActiveContract[] = [];

  console.log(`[ParseContracts] parseActiveContracts iniciado, texto length=${text.length}`);

  // Padrão: Data Número Cliente Vencimento Indeterminado Valor Ativo
  // Usa regex global para capturar múltiplas linhas
  const contractPattern = /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+Indeterminado\s+([\d.,]+)\s+Ativo/g;

  let match;
  let matchCount = 0;
  while ((match = contractPattern.exec(text)) !== null) {
    matchCount++;
    const [, data, numero, cliente, vencimento, valorStr] = match;
    const valor = parseFloat(valorStr.replace(/\./g, '').replace(',', '.'));

    contracts.push({
      numero: numero.trim(),
      cliente: cliente.trim(),
      valor,
      proximoVencimento: vencimento,
    });

    console.log(`[ParseContracts] Match ${matchCount}: numero=${numero} cliente="${cliente.trim()}" valor=${valor}`);
  }

  console.log(`[ParseContracts] Total matches: ${matchCount}`);

  console.log(`[ParseContracts] parseActiveContracts finalizado, contracts.length=${contracts.length}`);
  return contracts;
}

/**
 * Normalizar nome para busca
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
    .replace(/[ç]/g, 'c');
}

/**
 * Marcar clientes como managed baseado em contratos ativos
 */
export async function parseAndMarkManagedClients(
  pdfPaths: string[]
): Promise<{ totalContracts: number; matched: number; notFound: number; errors: number }> {
  try {
    console.log(`[ParseContracts] Iniciando parsing de ${pdfPaths.length} PDFs...`);

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    let allContracts: ActiveContract[] = [];

    // Extrair contratos de cada PDF
    for (const pdfPath of pdfPaths) {
      try {
        console.log(`[ParseContracts] Processando ${pdfPath}...`);
        const text = await extractPdfText(pdfPath);
        const contracts = parseActiveContracts(text);
        console.log(`[ParseContracts] Encontrados ${contracts.length} contratos em ${pdfPath}`);
        allContracts = allContracts.concat(contracts);
      } catch (error: any) {
        console.error(`[ParseContracts] Erro ao processar ${pdfPath}: ${error.message}`);
      }
    }

    console.log(`[ParseContracts] Total de contratos: ${allContracts.length}`);

    // Marcar clientes como managed
    let matched = 0;
    let notFound = 0;
    let errors = 0;

    const seen = new Set<string>();

    for (const contract of allContracts) {
      try {
        // Evitar duplicatas por número de contrato
        if (seen.has(contract.numero)) {
          console.log(`[ParseContracts] SKIP numero=${contract.numero} reason=DUPLICATE`);
          continue;
        }
        seen.add(contract.numero);

        // Buscar cliente por nome (LIKE)
        const matchedClients = await db
          .select()
          .from(clients)
          .where(ilike(clients.name, `%${contract.cliente}%`))
          .limit(1);

        if (matchedClients.length === 0) {
          console.log(`[ParseContracts] NOT_FOUND numero=${contract.numero} cliente="${contract.cliente}"`);
          notFound++;
          continue;
        }

        const client = matchedClients[0];

        // Marcar como managed (usando status=active como proxy)
        await db
          .update(clients)
          .set({
            status: 'active',
          })
          .where(ilike(clients.name, `%${contract.cliente}%`));

        console.log(`[ParseContracts] MATCHED numero=${contract.numero} clientId=${client.id} cliente="${client.name}"`);
        matched++;
      } catch (error: any) {
        console.error(`[ParseContracts] ERROR numero=${contract.numero} error=${error.message}`);
        errors++;
      }
    }

    console.log(`[ParseContracts] Resumo: total=${allContracts.length} matched=${matched} notFound=${notFound} errors=${errors}`);

    return {
      totalContracts: allContracts.length,
      matched,
      notFound,
      errors,
    };
  } catch (error: any) {
    console.error(`[ParseContracts] FATAL error=${error?.message}`);
    throw error;
  }
}
