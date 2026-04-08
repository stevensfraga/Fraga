/**
 * 📄 SyncDocumentFromContaAzul Service
 * Sincroniza CPF/CNPJ de clientes com a API Conta Azul usando UUID
 * 
 * Regras:
 * - Usar EXCLUSIVAMENTE contaAzulPersonId (UUID) no path /v1/pessoas/{uuid}
 * - Buscar documento na Conta Azul para cada cliente com document IS NULL OR ''
 * - Persistir em clients.document (com trim e validação de tamanho)
 * - Se contaAzulPersonId for null → skip (não chamar API)
 * - Log obrigatório: [DocSync] UPDATED / BLOCKED / skip_missing_uuid
 * - Reduzir missingDocument de 206 → 0
 */

import axios from 'axios';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { isNull, eq, or, desc } from 'drizzle-orm';
import { getValidAccessToken } from '../contaAzulOAuthManager';

interface ContaAzulPerson {
  id: string;
  name: string;
  document?: string;
  cpf?: string;
  cnpj?: string;
  [key: string]: any;
}

interface SyncResult {
  clientId: number;
  personUuid: string | null;
  name: string;
  document: string | null;
  status: 'UPDATED' | 'BLOCKED' | 'ERROR' | 'SKIPPED';
  reason?: string;
}

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com/v1';

/**
 * Buscar pessoa na Conta Azul por UUID
 */
async function fetchPersonFromContaAzul(
  personUuid: string,
  accessToken: string,
  tokenUpdatedAt?: string
): Promise<ContaAzulPerson | null> {
  try {
    const endpoint = `${CONTA_AZUL_API_BASE}/pessoas/${personUuid}`;
    
    console.log(`[DocSync] fetch_person_start clientId=? personUuid=${personUuid} endpoint=${endpoint}`);
    console.log(`[OAuth] TOKEN_USED updatedAt=${tokenUpdatedAt} tokenSuffix=${accessToken.substring(0, 8)}...`);
    
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log(`[DocSync] fetch_person_done personUuid=${personUuid} httpStatus=${response.status}`);
    // API returns person object directly, not wrapped in { data: {...} }
    return response.data || null;
  } catch (error: any) {
    const status = error.response?.status;
    console.error(`[DocSync] fetch_person_done personUuid=${personUuid} httpStatus=${status} error=${error?.message}`);
    
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Extrair documento (CPF/CNPJ) da pessoa Conta Azul
 */
function extractDocument(contaAzulPerson: ContaAzulPerson): string | null {
  // Tentar campo 'document' primeiro
  if (contaAzulPerson.document && typeof contaAzulPerson.document === 'string') {
    const doc = contaAzulPerson.document.trim();
    if (doc.length > 0) return doc;
  }

  // Tentar campo 'cpf'
  if (contaAzulPerson.cpf && typeof contaAzulPerson.cpf === 'string') {
    const doc = contaAzulPerson.cpf.trim();
    if (doc.length > 0) return doc;
  }

  // Tentar campo 'cnpj'
  if (contaAzulPerson.cnpj && typeof contaAzulPerson.cnpj === 'string') {
    const doc = contaAzulPerson.cnpj.trim();
    if (doc.length > 0) return doc;
  }

  return null;
}

/**
 * Validar documento (tamanho mínimo)
 */
function isValidDocument(document: string): boolean {
  if (!document || typeof document !== 'string') return false;
  const trimmed = document.trim();
  // CPF: 11 dígitos, CNPJ: 14 dígitos
  return trimmed.length >= 11 && trimmed.length <= 14;
}

/**
 * Sincronizar documento de um cliente
 */
async function syncClientDocument(
  clientId: number,
  personUuid: string | null,
  name: string,
  accessToken: string,
  tokenUpdatedAt?: string
): Promise<SyncResult> {
  try {
    // Se não tem contaAzulPersonId (UUID), não pode sincronizar
    if (!personUuid) {
      console.log(`[DocSync] skip_missing_uuid clientId=${clientId} reason=NO_PERSON_UUID`);
      return {
        clientId,
        personUuid: null,
        name,
        document: null,
        status: 'SKIPPED',
        reason: 'NO_PERSON_UUID',
      };
    }

    // Buscar pessoa na Conta Azul usando UUID
    const contaAzulPerson = await fetchPersonFromContaAzul(personUuid, accessToken, tokenUpdatedAt);

    if (!contaAzulPerson) {
      console.log(`[DocSync] BLOCKED clientId=${clientId} personUuid=${personUuid} reason=NOT_FOUND_IN_CONTA_AZUL`);
      return {
        clientId,
        personUuid,
        name,
        document: null,
        status: 'BLOCKED',
        reason: 'NOT_FOUND_IN_CONTA_AZUL',
      };
    }

    // Extrair documento
    const document = extractDocument(contaAzulPerson);

    if (!document || !isValidDocument(document)) {
      console.log(`[DocSync] BLOCKED clientId=${clientId} personUuid=${personUuid} reason=NO_VALID_DOCUMENT_IN_CONTA_AZUL`);
      return {
        clientId,
        personUuid,
        name,
        document: null,
        status: 'BLOCKED',
        reason: 'NO_VALID_DOCUMENT_IN_CONTA_AZUL',
      };
    }

    // Persistir no banco
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    await db
      .update(clients)
      .set({ document: document.trim() })
      .where(eq(clients.id, clientId));

    console.log(`[DocSync] UPDATED clientId=${clientId} personUuid=${personUuid} document=${document} documentSource=conta-azul`);

    return {
      clientId,
      personUuid,
      name,
      document,
      status: 'UPDATED',
    };
  } catch (error: any) {
    console.error(`[DocSync] ERROR clientId=${clientId} personUuid=${personUuid} error=${error?.message}`);
    return {
      clientId,
      personUuid: personUuid || null,
      name,
      document: null,
      status: 'ERROR',
      reason: error?.message,
    };
  }
}

/**
 * Sincronizar documentos em lote
 */
export async function syncDocumentsFromContaAzul(limit: number = 50): Promise<SyncResult[]> {
  try {
    console.log(`[DocSync] Iniciando sincronização de documentos (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();

    // Buscar clientes sem documento
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsWithoutDocument = await db
      .select()
      .from(clients)
      .where(or(isNull(clients.document), eq(clients.document, '')))
      .limit(limit);

    console.log(`[DocSync] Encontrados ${clientsWithoutDocument.length} clientes sem documento`);

    // Obter metadata do token
    let tokenUpdatedAt = new Date().toISOString();
    try {
      const { contaAzulTokens } = require('../../drizzle/schema');
      const tokenRecord = await db
        .select()
        .from(contaAzulTokens)
        .orderBy(desc(contaAzulTokens.updatedAt))
        .limit(1);
      if (tokenRecord.length > 0) {
        tokenUpdatedAt = tokenRecord[0].updatedAt?.toISOString() || tokenUpdatedAt;
      }
    } catch (e) {
      // ignore
    }

    const results: SyncResult[] = [];

    for (const client of clientsWithoutDocument) {
      const result = await syncClientDocument(
        client.id,
        client.contaAzulPersonId || null,
        client.name,
        accessToken,
        tokenUpdatedAt
      );
      results.push(result);

      // Rate limiting: 100ms entre requisições
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Resumo
    const updated = results.filter(r => r.status === 'UPDATED').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const skipped = results.filter(r => r.status === 'SKIPPED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(`[DocSync] Sincronização concluída: UPDATED=${updated}, BLOCKED=${blocked}, SKIPPED=${skipped}, ERROR=${errors}`);

    return results;
  } catch (error: any) {
    console.error(`[DocSync] FATAL ERROR: ${error?.message}`);
    throw error;
  }
}
