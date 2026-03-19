/**
 * 📄 ResolvePersonIds Service - FINAL
 * Com detecção de base vazia e estratégia ajustada
 * 
 * Estratégia:
 * 1. Verificar se base Conta Azul tem dados
 * 2. Se vazia → retornar erro + solicitar importação
 * 3. Se tem dados → executar resolução normal
 */

import axios from 'axios';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { isNull, eq, or } from 'drizzle-orm';
import { getValidAccessToken } from '../contaAzulOAuthManager';

interface ResolveResult {
  clientId: number;
  name: string;
  contaAzulPersonId: string | null;
  status: 'UPDATED' | 'BLOCKED' | 'ERROR';
  reason?: string;
  strategyUsed?: string;
}

interface ResolutionSummary {
  total: number;
  updated: number;
  blocked: number;
  errors: number;
  baseEmpty: boolean;
  message: string;
}

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com/v1';

/**
 * Verificar se base Conta Azul tem dados
 */
async function checkIfBaseHasData(accessToken: string): Promise<boolean> {
  try {
    console.log(`[PersonResolve] Verificando se base Conta Azul tem dados...`);

    const response = await axios.get(`${CONTA_AZUL_API_BASE}/pessoas?pagina=1&tamanho_pagina=10`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    // API returns { items: [...], totalItems: N }
    const items = response.data?.items || response.data?.data || [];
    const totalItems = response.data?.totalItems || response.data?.total || 0;
    const hasData = totalItems > 0 || (Array.isArray(items) && items.length > 0);

    console.log(`[PersonResolve] Base check: hasData=${hasData} totalItems=${totalItems} itemsCount=${items.length}`);
    return hasData;
  } catch (error: any) {
    console.error(`[PersonResolve] Base check error: ${error?.message}`);
    return false;
  }
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

    // Construir query params corretos (SEM pagina/tamanho_pagina)
    if (strategy === 'email') {
      endpoint += `?emails=${encodeURIComponent(value)}`;
    } else if (strategy === 'document') {
      endpoint += `?documentos=${encodeURIComponent(value)}`;
    } else if (strategy === 'name') {
      endpoint += `?nomes=${encodeURIComponent(value)}`;
    } else if (strategy === 'search') {
      endpoint += `?busca=${encodeURIComponent(value)}`;
    }

    console.log(`[PersonResolve] request clientId=${clientId} strategy=${strategy}`);

    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // API returns { items: [...], totalItems: N }
    const items = response.data?.items || response.data?.data || [];
    const hitsCount = Array.isArray(items) ? items.length : 0;

    console.log(`[PersonResolve] response clientId=${clientId} strategy=${strategy} hitsCount=${hitsCount}`);

    // Retornar primeiro resultado se houver exatamente 1
    if (hitsCount === 1) {
      return items[0];
    }

    if (hitsCount > 1) {
      console.log(`[PersonResolve] response_ambiguous strategy=${strategy} hitsCount=${hitsCount}`);
    }

    return null;
  } catch (error: any) {
    const status = error.response?.status;
    console.error(`[PersonResolve] error clientId=${clientId} strategy=${strategy} httpStatus=${status}`);
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
    console.log(`[PersonResolve] candidate_input clientId=${clientId}`);

    // Prioridade: documento > email > nome > busca genérica
    const strategies: Array<{ strategy: 'email' | 'document' | 'name' | 'search'; value: string }> = [];

    if (document && document.trim()) {
      strategies.push({ strategy: 'document', value: document.trim() });
    }

    if (email && email.trim()) {
      strategies.push({ strategy: 'email', value: email.trim() });
    }

    if (name && name.trim()) {
      strategies.push({ strategy: 'name', value: name.trim() });
    }

    // Fallback: busca genérica
    if (document && document.trim()) {
      strategies.push({ strategy: 'search', value: document.trim() });
    } else if (name && name.trim()) {
      strategies.push({ strategy: 'search', value: name.trim() });
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
        console.log(`[PersonResolve] strategy_failed strategy=${strategy}`);
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
 * Resolver UUIDs em lote (com detecção de base vazia)
 */
export async function resolvePersonIdsFinal(limit: number = 50, onlyManaged: boolean = false): Promise<{ details: ResolveResult[]; summary: ResolutionSummary }> {
  try {
    console.log(`[PersonResolve] Iniciando resolução de UUIDs (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED`);

    // VERIFICAÇÃO CRÍTICA: Base tem dados?
    const baseHasData = await checkIfBaseHasData(accessToken);

    if (!baseHasData) {
      console.log(`[PersonResolve] BASE VAZIA - Parando resolução`);

      return {
        details: [],
        summary: {
          total: 0,
          updated: 0,
          blocked: 0,
          errors: 0,
          baseEmpty: true,
          message: 'Base Conta Azul está vazia. Importar clientes antes de resolver UUIDs.',
        },
      };
    }

    // Base tem dados - continuar com resolução normal
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Build query with optional managed filter
    console.log(`[PersonResolve] DEBUG: onlyManaged=${onlyManaged}, limit=${limit}`);
    
    let query = db
      .select()
      .from(clients)
      .where(or(isNull(clients.contaAzulPersonId), eq(clients.contaAzulPersonId, '')))
      .limit(limit * 2);

    const allClients = await query;
    console.log(`[PersonResolve] DEBUG: allClients.length=${allClients.length}`);
    
    if (onlyManaged && allClients.length > 0) {
      const statusCounts = allClients.reduce((acc: any, c: any) => {
        const s = c.status || 'null';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {});
      console.log(`[PersonResolve] DEBUG: statusCounts=${JSON.stringify(statusCounts)}`);
    }
    
    // Filter by managed status if needed
    const clientsWithoutPersonId = onlyManaged 
      ? allClients.filter(c => c.status === 'active').slice(0, limit)
      : allClients.slice(0, limit);

    console.log(`[PersonResolve] DEBUG: clientsWithoutPersonId.length=${clientsWithoutPersonId.length}`);
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

    return {
      details: results,
      summary: {
        total: results.length,
        updated,
        blocked,
        errors,
        baseEmpty: false,
        message: `Resolução concluída: ${updated} atualizados, ${blocked} bloqueados, ${errors} erros`,
      },
    };
  } catch (error: any) {
    console.error(`[PersonResolve] FATAL error=${error?.message}`);
    throw error;
  }
}
