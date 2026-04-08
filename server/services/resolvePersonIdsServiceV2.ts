/**
 * 📄 ResolvePersonIds Service V2
 * Resolve UUID da Pessoa na Conta Azul usando busca sem filtro + match local
 * 
 * Estratégia:
 * - Buscar TODAS as pessoas (sem filtro) com paginação
 * - Fazer match local por email/documento/nome
 * - Persistir UUID quando encontrar match exato
 * 
 * Regras:
 * - Prioridade: email > documento > nome
 * - Se 0 ou múltiplos resultados => BLOCKED
 * - Persistir UUID em clients.contaAzulPersonId
 * - Log obrigatório: [PersonResolve] UPDATED / BLOCKED
 * - Nunca inventar UUID
 */

import axios from 'axios';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { isNull, eq, or, desc } from 'drizzle-orm';
import { getValidAccessToken } from '../contaAzulOAuthManager';

interface ResolveResult {
  clientId: number;
  name: string;
  contaAzulPersonId: string | null;
  status: 'UPDATED' | 'BLOCKED' | 'ERROR';
  reason?: string;
  matchStrategy?: string;
}

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com/v1';

/**
 * Normalizar valores para comparação
 */
function normalize(value: string): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w@.-]/g, '');
}

/**
 * Buscar TODAS as pessoas da Conta Azul com paginação
 */
async function fetchAllPeopleFromContaAzul(
  accessToken: string,
  clientId?: number
): Promise<any[]> {
  try {
    const allPeople: any[] = [];
    let limit = 100;
    let offset = 0;
    let totalFetched = 0;
    const maxIterations = 50; // Proteção contra loop infinito
    let iteration = 0;

    console.log(`[PersonResolveV2] fetchAll_start clientId=${clientId}`);

    while (iteration < maxIterations) {
      iteration++;
      const endpoint = `${CONTA_AZUL_API_BASE}/pessoas?limit=${limit}&offset=${offset}`;
      
      console.log(`[PersonResolveV2] fetchAll_request iteration=${iteration} offset=${offset} limit=${limit}`);

      const response = await axios.get(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data = response.data?.data || [];
      
      console.log(`[PersonResolveV2] fetchAll_response iteration=${iteration} fetched=${data.length}`);

      if (!Array.isArray(data) || data.length === 0) {
        console.log(`[PersonResolveV2] fetchAll_done totalFetched=${totalFetched}`);
        break;
      }

      allPeople.push(...data);
      totalFetched += data.length;
      offset += limit;

      // Se recebeu menos que limit, é a última página
      if (data.length < limit) {
        console.log(`[PersonResolveV2] fetchAll_lastpage totalFetched=${totalFetched}`);
        break;
      }
    }

    console.log(`[PersonResolveV2] fetchAll_complete totalFetched=${totalFetched}`);
    return allPeople;
  } catch (error: any) {
    console.error(`[PersonResolveV2] fetchAll_error clientId=${clientId} error=${error?.message}`);
    throw error;
  }
}

/**
 * Fazer match local de um cliente contra lista de pessoas
 */
function matchClientLocally(
  clientId: number,
  clientName: string,
  clientEmail: string | null,
  clientDocument: string | null,
  allPeople: any[]
): any | null {
  const normalizedEmail = normalize(clientEmail || '');
  const normalizedDocument = normalize(clientDocument || '');
  const normalizedName = normalize(clientName || '');

  console.log(`[PersonResolveV2] match_start clientId=${clientId}`);
  console.log(`[PersonResolveV2] match_input email=${normalizedEmail || 'NULL'} document=${normalizedDocument || 'NULL'} name=${normalizedName || 'NULL'}`);

  // Prioridade 1: Email
  if (normalizedEmail) {
    const matches = allPeople.filter(p => {
      const pEmail = normalize(p.email || '');
      return pEmail === normalizedEmail;
    });

    console.log(`[PersonResolveV2] match_strategy=EMAIL matches=${matches.length}`);
    if (matches.length === 1) {
      console.log(`[PersonResolveV2] match_found strategy=EMAIL uuid=${matches[0].id}`);
      return matches[0];
    }
    if (matches.length > 1) {
      console.log(`[PersonResolveV2] match_ambiguous strategy=EMAIL count=${matches.length}`);
      return null;
    }
  }

  // Prioridade 2: Documento (CPF/CNPJ)
  if (normalizedDocument) {
    const matches = allPeople.filter(p => {
      const pDoc = normalize(p.documento || p.cpf || p.cnpj || '');
      return pDoc === normalizedDocument;
    });

    console.log(`[PersonResolveV2] match_strategy=DOCUMENT matches=${matches.length}`);
    if (matches.length === 1) {
      console.log(`[PersonResolveV2] match_found strategy=DOCUMENT uuid=${matches[0].id}`);
      return matches[0];
    }
    if (matches.length > 1) {
      console.log(`[PersonResolveV2] match_ambiguous strategy=DOCUMENT count=${matches.length}`);
      return null;
    }
  }

  // Prioridade 3: Nome
  if (normalizedName) {
    const matches = allPeople.filter(p => {
      const pName = normalize(p.nome || p.name || '');
      return pName === normalizedName;
    });

    console.log(`[PersonResolveV2] match_strategy=NAME matches=${matches.length}`);
    if (matches.length === 1) {
      console.log(`[PersonResolveV2] match_found strategy=NAME uuid=${matches[0].id}`);
      return matches[0];
    }
    if (matches.length > 1) {
      console.log(`[PersonResolveV2] match_ambiguous strategy=NAME count=${matches.length}`);
      return null;
    }
  }

  console.log(`[PersonResolveV2] match_none clientId=${clientId}`);
  return null;
}

/**
 * Resolver UUID de um cliente
 */
async function resolveClientPersonIdV2(
  clientId: number,
  name: string,
  email: string | null,
  document: string | null,
  allPeople: any[]
): Promise<ResolveResult> {
  try {
    console.log(`[PersonResolveV2] candidate_input clientId=${clientId} name=${name}`);

    // Fazer match local
    const person = matchClientLocally(clientId, name, email, document, allPeople);

    if (person && person.id) {
      // Persistir UUID no banco
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      await db
        .update(clients)
        .set({ contaAzulPersonId: person.id })
        .where(eq(clients.id, clientId));

      console.log(`[PersonResolveV2] decision_updated clientId=${clientId} uuid=${person.id}`);

      return {
        clientId,
        name,
        contaAzulPersonId: person.id,
        status: 'UPDATED',
        matchStrategy: 'local-match',
      };
    }

    // Nenhum match
    console.log(`[PersonResolveV2] decision_blocked clientId=${clientId} reason=NO_MATCH_FOUND`);
    
    return {
      clientId,
      name,
      contaAzulPersonId: null,
      status: 'BLOCKED',
      reason: 'NO_MATCH_FOUND',
      matchStrategy: 'local-match',
    };
  } catch (error: any) {
    console.error(`[PersonResolveV2] ERROR clientId=${clientId} error=${error?.message}`);
    return {
      clientId,
      name,
      contaAzulPersonId: null,
      status: 'ERROR',
      reason: error?.message,
    };
  }
}

/**
 * Resolver UUIDs em lote (estratégia: fetch all + local match)
 */
export async function resolvePersonIdsV2(limit: number = 50): Promise<ResolveResult[]> {
  try {
    console.log(`[PersonResolveV2] Iniciando resolução de UUIDs (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();

    // Buscar TODAS as pessoas da Conta Azul
    const allPeople = await fetchAllPeopleFromContaAzul(accessToken);
    console.log(`[PersonResolveV2] Carregadas ${allPeople.length} pessoas da Conta Azul`);

    // Buscar clientes sem contaAzulPersonId
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsWithoutPersonId = await db
      .select()
      .from(clients)
      .where(or(isNull(clients.contaAzulPersonId), eq(clients.contaAzulPersonId, '')))
      .limit(limit);

    console.log(`[PersonResolveV2] Encontrados ${clientsWithoutPersonId.length} clientes sem UUID`);

    // Processar cada cliente
    const results: ResolveResult[] = [];
    for (const client of clientsWithoutPersonId) {
      const result = await resolveClientPersonIdV2(
        client.id,
        client.name || '',
        client.email,
        client.document,
        allPeople
      );
      results.push(result);
    }

    // Resumo
    const updated = results.filter(r => r.status === 'UPDATED').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;
    
    console.log(`[PersonResolveV2] Resumo: total=${results.length} updated=${updated} blocked=${blocked} errors=${errors}`);

    return results;
  } catch (error: any) {
    console.error(`[PersonResolveV2] FATAL error=${error?.message}`);
    throw error;
  }
}
