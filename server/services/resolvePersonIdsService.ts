/**
 * 📄 ResolvePersonIds Service
 * Resolve UUID da Pessoa na Conta Azul usando filtros (email, codigo, cpf/cnpj, nome)
 * 
 * Regras:
 * - Buscar pessoa na Conta Azul usando GET /v1/pessoas com filtros
 * - Prioridade: email > codigo > cpf/cnpj > nome
 * - Se 0 ou múltiplos resultados => BLOCKED (fila de revisão humana)
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
  filterUsed?: string;
}

interface FilterConfig {
  label: string;
  value: string;
  priority: number;
}

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com/v1';

/**
 * Normalizar valores para log (mascarar dados sensíveis)
 */
function maskSensitive(value: string, type: 'email' | 'document' | 'name'): string {
  if (!value) return '';
  if (type === 'email') {
    const [local, domain] = value.split('@');
    if (local && domain) {
      return `${local.substring(0, 2)}***@${domain}`;
    }
  }
  if (type === 'document') {
    return `***${value.substring(Math.max(0, value.length - 4))}`;
  }
  return value.substring(0, 20);
}

/**
 * Buscar pessoa na Conta Azul usando filtros
 */
async function searchPersonInContaAzul(
  filters: Record<string, string>,
  accessToken: string,
  tokenUpdatedAt?: string,
  clientId?: number
): Promise<any | null> {
  try {
    const filterKeys = Object.keys(filters);
    const filterStr = filterKeys.map(k => `${k}=${encodeURIComponent(filters[k])}`).join('&');
    const endpoint = `${CONTA_AZUL_API_BASE}/pessoas?${filterStr}`;
    
    // [PersonResolve] request
    console.log(`[PersonResolve] request clientId=${clientId} endpoint=${endpoint} method=GET`);
    console.log(`[OAuth] TOKEN_USED updatedAt=${tokenUpdatedAt} suffix=${accessToken.substring(0, 8)}...`);
    
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data?.data || [];
    
    // [PersonResolve] response
    console.log(`[PersonResolve] response clientId=${clientId} httpStatus=${response.status} hitsCount=${data.length}`);
    if (data.length > 0 && data.length <= 3) {
      const ids = data.map((p: any) => p.id).join(',');
      console.log(`[PersonResolve] response idsReturned=${ids}`);
    }
    
    // Retornar primeiro resultado se houver exatamente 1
    if (data.length === 1) {
      return data[0];
    }
    
    if (data.length > 1) {
      console.log(`[PersonResolve] response AMBIGUOUS hitsCount=${data.length} (não salvar UUID)`);
    }
    
    return null;
  } catch (error: any) {
    const status = error.response?.status;
    const message = error?.message || 'Unknown error';
    console.error(`[PersonResolve] response clientId=${clientId} httpStatus=${status} error=${message}`);
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
  accessToken: string,
  tokenUpdatedAt?: string
): Promise<ResolveResult> {
  try {
    // [PersonResolve] candidate_input
    console.log(`[PersonResolve] candidate_input clientId=${clientId}`);
    console.log(`[PersonResolve] candidate_input emailNormalized=${email ? maskSensitive(email, 'email') : 'NULL'}`);
    console.log(`[PersonResolve] candidate_input documentNormalized=${document ? maskSensitive(document, 'document') : 'NULL'}`);
    console.log(`[PersonResolve] candidate_input nameNormalized=${maskSensitive(name || '', 'name')}`);

    // Prioridade de filtros: email > documento > nome
    const filterConfigs: FilterConfig[] = [];
    
    if (email && email.trim()) {
      filterConfigs.push({ label: 'email', value: email.trim(), priority: 1 });
    }
    
    if (document && document.trim()) {
      filterConfigs.push({ label: 'document', value: document.trim(), priority: 2 });
    }
    
    if (name && name.trim()) {
      filterConfigs.push({ label: 'name', value: name.trim(), priority: 3 });
    }

    // Tentar cada filtro em ordem de prioridade
    for (const filterConfig of filterConfigs.sort((a, b) => a.priority - b.priority)) {
      try {
        console.log(`[PersonResolve] candidate_input strategy=${filterConfig.label}`);
        
        const filterObj: Record<string, string> = {};
        filterObj[filterConfig.label] = filterConfig.value;
        
        const person = await searchPersonInContaAzul(
          filterObj,
          accessToken,
          tokenUpdatedAt,
          clientId
        );

        if (person && person.id) {
          // Persistir UUID no banco
          const db = await getDb();
          if (!db) throw new Error('Database not available');

          const updateResult = await db
            .update(clients)
            .set({ contaAzulPersonId: person.id })
            .where(eq(clients.id, clientId));

          // [PersonResolve] decision
          console.log(`[PersonResolve] decision clientId=${clientId} strategyUsedFinal=${filterConfig.label} reason=SAVED personUuidSaved=${person.id}`);

          return {
            clientId,
            name,
            contaAzulPersonId: person.id,
            status: 'UPDATED',
            filterUsed: filterConfig.label,
          };
        }
      } catch (error: any) {
        // Continuar com próximo filtro
        console.log(`[PersonResolve] FILTER_FAILED strategy=${filterConfig.label} error=${error?.message}`);
        continue;
      }
    }

    // Nenhum filtro funcionou
    // [PersonResolve] decision
    console.log(`[PersonResolve] decision clientId=${clientId} strategyUsedFinal=NONE reason=NO_MATCH_IN_CONTA_AZUL personUuidSaved=null rowsAffected=0`);
    
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
export async function resolvePersonIds(limit: number = 50): Promise<ResolveResult[]> {
  try {
    console.log(`[PersonResolve] Iniciando resolução de UUIDs (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();

    // Buscar clientes sem contaAzulPersonId
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsWithoutPersonId = await db
      .select()
      .from(clients)
      .where(or(isNull(clients.contaAzulPersonId), eq(clients.contaAzulPersonId, '')))
      .limit(limit);

    console.log(`[PersonResolve] Encontrados ${clientsWithoutPersonId.length} clientes sem UUID`);

    // Obter metadata do token
    let tokenUpdatedAt = new Date().toISOString();
    try {
      const contaAzulTokens = require('../../drizzle/schema').contaAzulTokens;
      const tokenRecord = await db
        .select()
        .from(contaAzulTokens)
        .orderBy(desc(contaAzulTokens.updatedAt))
        .limit(1);
      if (tokenRecord.length > 0) {
        tokenUpdatedAt = tokenRecord[0].updatedAt?.toISOString() || tokenUpdatedAt;
      }
    } catch (e) {
      // Ignore
    }

    // Processar cada cliente
    const results: ResolveResult[] = [];
    for (const client of clientsWithoutPersonId) {
      const result = await resolveClientPersonId(
        client.id,
        client.name || '',
        client.email,
        client.document,
        accessToken,
        tokenUpdatedAt
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
