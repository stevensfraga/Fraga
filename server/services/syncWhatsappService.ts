/**
 * 📱 SyncWhatsappFromContaAzul Service
 * Sincroniza número de WhatsApp de clientes com a API Conta Azul
 * 
 * REGRA DE FALLBACK INTELIGENTE:
 * 1) Tentar telefone_celular (Conta Azul)
 * 2) Se vazio/inválido, tentar telefone_comercial
 * 3) Se ambos inválidos, bloquear
 * 
 * Regras:
 * - Buscar telefone na Conta Azul para cada cliente
 * - Normalizar para E.164 (Brasil +55DDDNUMBER)
 * - Persistir clients.whatsappNumber e setar clients.whatsappSource='conta-azul'
 * - Log obrigatório: [WASync] UPDATED / BLOCKED / PHONE_CANDIDATES / PHONE_SELECTED
 * - Reduzir invalidWhatsappSource
 */

import axios from 'axios';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { eq, ne } from 'drizzle-orm';
import { getValidAccessToken } from '../contaAzulOAuthManager';
import { normalizeWhatsApp, logInvalidWhatsApp } from '../collection/normalizeWhatsApp';

interface ContaAzulPerson {
  id: string;
  nome?: string;
  name?: string;
  telefone_celular?: string;
  telefone_comercial?: string;
  [key: string]: any;
}

interface SyncResult {
  clientId: number;
  contaAzulPersonId: string;
  name: string;
  phone: string | null;
  fromField?: string;
  status: 'UPDATED' | 'BLOCKED' | 'ERROR';
  reason?: string;
}

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com/v1';

/**
 * Buscar pessoa na Conta Azul por UUID
 */
async function fetchPersonFromContaAzul(personUuid: string, accessToken: string): Promise<ContaAzulPerson | null> {
  try {
    const response = await axios.get(
      `${CONTA_AZUL_API_BASE}/pessoas/${personUuid}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    // API returns person object directly
    return response.data || null;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

// Removido: normalização agora é centralizada em normalizeWhatsApp()

/**
 * Extrair telefone com fallback: celular → comercial
 * AGORA USANDO normalizeWhatsApp() centralizada
 */
function extractPhoneWithFallback(person: ContaAzulPerson): { phone: string | null; fromField: string | null } {
  const phoneMobile = normalizeWhatsApp(person.telefone_celular);
  const phoneCommercial = normalizeWhatsApp(person.telefone_comercial);

  // Log candidates
  console.log(
    `[WASync] PHONE_CANDIDATES mobile="${person.telefone_celular || 'empty'}" commercial="${person.telefone_comercial || 'empty'}"`
  );

  // Fallback: celular → comercial
  if (phoneMobile) {
    console.log(`[WASync] PHONE_SELECTED field=telefone_celular e164="${phoneMobile}"`);
    return { phone: phoneMobile, fromField: 'telefone_celular' };
  }

  if (phoneCommercial) {
    console.log(`[WASync] PHONE_SELECTED field=telefone_comercial e164="${phoneCommercial}"`);
    return { phone: phoneCommercial, fromField: 'telefone_comercial' };
  }

  console.log(`[WASync] PHONE_BLOCKED reason=NO_VALID_PHONE`);
  return { phone: null, fromField: null };
}

/**
 * Sincronizar WhatsApp de 1 cliente
 */
async function syncClientWhatsapp(
  clientId: number,
  contaAzulPersonId: string | null,
  name: string,
  accessToken: string
): Promise<SyncResult> {
  try {
    // Se não tem UUID, não pode sincronizar
    if (!contaAzulPersonId) {
      console.log(`[WASync] BLOCKED clientId=${clientId} reason=NO_CONTA_AZUL_PERSON_ID`);
      return {
        clientId,
        contaAzulPersonId: 'unknown',
        name,
        phone: null,
        status: 'BLOCKED',
        reason: 'NO_CONTA_AZUL_PERSON_ID',
      };
    }

    // Buscar pessoa na Conta Azul
    console.log(`[WASync] FETCH personId=${contaAzulPersonId}`);
    const person = await fetchPersonFromContaAzul(contaAzulPersonId, accessToken);

    if (!person) {
      console.log(`[WASync] BLOCKED clientId=${clientId} personId=${contaAzulPersonId} reason=NOT_FOUND_IN_CONTA_AZUL`);
      return {
        clientId,
        contaAzulPersonId,
        name,
        phone: null,
        status: 'BLOCKED',
        reason: 'NOT_FOUND_IN_CONTA_AZUL',
      };
    }

    // Extrair telefone com fallback
    const { phone, fromField } = extractPhoneWithFallback(person);

    if (!phone) {
      console.log(`[WASync] BLOCKED clientId=${clientId} personId=${contaAzulPersonId} reason=NO_VALID_PHONE_IN_CONTA_AZUL`);
      return {
        clientId,
        contaAzulPersonId,
        name,
        phone: null,
        status: 'BLOCKED',
        reason: 'NO_VALID_PHONE_IN_CONTA_AZUL',
      };
    }

    // Persistir no banco
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    await db
      .update(clients)
      .set({
        whatsappNumber: phone, // Já vem normalizado com +55
        whatsappSource: 'conta-azul',
        whatsappValidatedAt: new Date(),
        whatsappApprovedBy: 'system@sync-conta-azul',
        whatsappApprovalMethod: 'sync-conta-azul',
      })
      .where(eq(clients.id, clientId));

    console.log(
      `[WASync] UPDATED clientId=${clientId} personId=${contaAzulPersonId} phone=${phone} source=conta-azul fromField=${fromField}`
    );

    return {
      clientId,
      contaAzulPersonId,
      name,
      phone: phone, // Já vem com +55
      fromField: fromField || undefined,
      status: 'UPDATED',
    };
  } catch (error: any) {
    console.error(`[WASync] ERROR clientId=${clientId} error=${error?.message}`);
    return {
      clientId,
      contaAzulPersonId: contaAzulPersonId || 'unknown',
      name,
      phone: null,
      status: 'ERROR',
      reason: error?.message,
    };
  }
}

/**
 * Sincronizar WhatsApp em lote
 */
export async function syncWhatsappFromContaAzul(limit: number = 50): Promise<SyncResult[]> {
  try {
    console.log(`[WASync] Iniciando sincronização de WhatsApp com fallback (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED accessToken=${accessToken.substring(0, 20)}...`);

    // Buscar clientes com whatsappSource != 'conta-azul'
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsNeedingSync = await db
      .select()
      .from(clients)
      .where(ne(clients.whatsappSource, 'conta-azul'))
      .limit(limit);

    console.log(`[WASync] Encontrados ${clientsNeedingSync.length} clientes para sincronizar`);

    const results: SyncResult[] = [];

    for (const client of clientsNeedingSync) {
      // Use contaAzulPersonId (UUID) instead of contaAzulId (random string)
      const result = await syncClientWhatsapp(
        client.id,
        client.contaAzulPersonId || null,
        client.name,
        accessToken
      );
      results.push(result);

      // Rate limiting: 100ms entre requisições
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Resumo
    const updated = results.filter(r => r.status === 'UPDATED').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(`[WASync] Sincronização concluída: UPDATED=${updated}, BLOCKED=${blocked}, ERROR=${errors}`);

    return results;
  } catch (error: any) {
    console.error(`[WASync] ERRO GERAL: ${error?.message}`);
    throw error;
  }
}
