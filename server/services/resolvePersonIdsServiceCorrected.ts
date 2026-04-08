/**
 * 📄 ResolvePersonIds Service - CORRECTED
 * Resolve UUID da Pessoa na Conta Azul usando PARAMS CORRETOS
 * 
 * Params corretos (Conta Azul API v2):
 * - pagina, tamanho_pagina (não limit/offset)
 * - emails, nomes, documentos (não email/name/document)
 * - busca (busca genérica)
 * 
 * Estratégia:
 * 1. Tentar busca por EMAIL
 * 2. Tentar busca por DOCUMENTO
 * 3. Tentar busca por NOME
 * 4. Fallback: busca genérica
 * 
 * Critério: hitsCount == 1 → UPDATED, hitsCount > 1 → AMBIGUOUS, hitsCount == 0 → BLOCKED
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
  strategyUsed?: string;
}

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com/v1';

/**
 * Normalizar valores para busca
 */
function normalize(value: string): string {
  if (!value) return '';
  return value.trim();
}

/**
 * Buscar pessoa na Conta Azul usando params corretos
 */
async function searchPersonInContaAzul(
  strategy: 'email' | 'document' | 'name' | 'search',
  value: string,
  accessToken: string,
  clientId?: number
): Promise<any | null> {
  try {
    let endpoint = `${CONTA_AZUL_API_BASE}/pessoas`;
    
    // Construir query params corretos (SEM pagina/tamanho_pagina que causam 400)
    if (strategy === 'email') {
      endpoint += `?emails=${encodeURIComponent(value)}`;
    } else if (strategy === 'document') {
      endpoint += `?documentos=${encodeURIComponent(value)}`;
    } else if (strategy === 'name') {
      endpoint += `?nomes=${encodeURIComponent(value)}`;
    } else if (strategy === 'search') {
      endpoint += `?busca=${encodeURIComponent(value)}`;
    }
    
    console.log(`[PersonResolve] request clientId=${clientId} strategy=${strategy} endpoint=${endpoint}`);
    
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data?.data || [];
    const hitsCount = Array.isArray(data) ? data.length : 0;
    
    console.log(`[PersonResolve] response clientId=${clientId} strategy=${strategy} httpStatus=${response.status} hitsCount=${hitsCount}`);
    
    if (hitsCount > 0 && hitsCount <= 3) {
      const ids = data.map((p: any) => p.id).join(',');
      console.log(`[PersonResolve] response_ids strategy=${strategy} ids=${ids}`);
    }
    
    // Retornar primeiro resultado se houver exatamente 1
    if (hitsCount === 1) {
      return data[0];
    }
    
    if (hitsCount > 1) {
      console.log(`[PersonResolve] response_ambiguous strategy=${strategy} hitsCount=${hitsCount}`);
    }
    
    return null;
  } catch (error: any) {
    const status = error.response?.status;
    console.error(`[PersonResolve] error clientId=${clientId} strategy=${strategy} httpStatus=${status} error=${error?.message}`);
    throw error;
  }
}

/**
 * Resolver UUID de um cliente
 */
async function resolveClientPersonId(
  clientId: number,
  name: string,
  email: string | null,
  document: string | null,
  accessToken: string
): Promise<ResolveResult> {
  try {
    console.log(`[PersonResolve] candidate_input clientId=${clientId} name=${name}`);

    // Prioridade: email > documento > nome > busca genérica
    const strategies: Array<{ strategy: 'email' | 'document' | 'name' | 'search'; value: string }> = [];
    
    if (email && email.trim()) {
      strategies.push({ strategy: 'email', value: normalize(email) });
    }
    
    if (document && document.trim()) {
      strategies.push({ strategy: 'document', value: normalize(document) });
    }
    
    if (name && name.trim()) {
      strategies.push({ strategy: 'name', value: normalize(name) });
    }
    
    // Fallback: busca genérica por documento ou nome
    if (document && document.trim()) {
      strategies.push({ strategy: 'search', value: normalize(document) });
    } else if (name && name.trim()) {
      strategies.push({ strategy: 'search', value: normalize(name) });
    }

    // Tentar cada estratégia em ordem
    for (const { strategy, value } of strategies) {
      try {
        const person = await searchPersonInContaAzul(strategy, value, accessToken, clientId);

        if (person && person.id) {
          // Persistir UUID no banco
          const db = await getDb();
          if (!db) throw new Error('Database not available');

          await db
            .update(clients)
            .set({ contaAzulPersonId: person.id })
            .where(eq(clients.id, clientId));

          console.log(`[PersonResolve] decision_updated clientId=${clientId} strategy=${strategy} uuid=${person.id}`);

          return {
            clientId,
            name,
            contaAzulPersonId: person.id,
            status: 'UPDATED',
            strategyUsed: strategy,
          };
        }
      } catch (error: any) {
        console.log(`[PersonResolve] strategy_failed strategy=${strategy} error=${error?.message}`);
        continue;
      }
    }

    // Nenhuma estratégia funcionou
    console.log(`[PersonResolve] decision_blocked clientId=${clientId} reason=NO_MATCH_IN_CONTA_AZUL`);
    
    return {
      clientId,
      name,
      contaAzulPersonId: null,
      status: 'BLOCKED',
      reason: 'NO_MATCH_IN_CONTA_AZUL',
    };
  } catch (error: any) {
    console.error(`[PersonResolve] ERROR clientId=${clientId} error=${error?.message}`);
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
 * Resolver UUIDs em lote
 */
export async function resolvePersonIdsCorrected(limit: number = 50): Promise<ResolveResult[]> {
  try {
    console.log(`[PersonResolve] Iniciando resolução de UUIDs (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED suffix=${accessToken.substring(0, 8)}...`);

    // Buscar clientes sem contaAzulPersonId
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsWithoutPersonId = await db
      .select()
      .from(clients)
      .where(or(isNull(clients.contaAzulPersonId), eq(clients.contaAzulPersonId, '')))
      .limit(limit);

    console.log(`[PersonResolve] Encontrados ${clientsWithoutPersonId.length} clientes sem UUID`);

    // Processar cada cliente
    const results: ResolveResult[] = [];
    for (const client of clientsWithoutPersonId) {
      const result = await resolveClientPersonId(
        client.id,
        client.name || '',
        client.email,
        client.document,
        accessToken
      );
      results.push(result);
    }

    // Resumo
    const updated = results.filter(r => r.status === 'UPDATED').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;
    
    console.log(`[PersonResolve] Resumo: total=${results.length} updated=${updated} blocked=${blocked} errors=${errors}`);

    return results;
  } catch (error: any) {
    console.error(`[PersonResolve] FATAL error=${error?.message}`);
    throw error;
  }
}
