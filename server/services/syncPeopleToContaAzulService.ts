/**
 * 📄 SyncPeopleToContaAzulService
 * Sincronizar clientes locais para Conta Azul em massa
 * 
 * Fluxo:
 * 1. Selecionar clientes locais sem UUID
 * 2. Para cada cliente, criar pessoa no Conta Azul
 * 3. Persistir UUID no banco
 * 4. Retornar resumo
 */

import axios from 'axios';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { isNull, eq, or } from 'drizzle-orm';
import { getValidAccessToken } from '../contaAzulOAuthManager';

interface SyncResult {
  clientId: number;
  name: string;
  email: string | null;
  status: 'CREATED' | 'SKIPPED' | 'ERROR';
  uuid?: string;
  reason?: string;
}

interface SyncSummary {
  total: number;
  created: number;
  skipped: number;
  errors: number;
  message: string;
}

/**
 * Sincronizar clientes para Conta Azul
 */
export async function syncPeopleToContaAzul(limit: number = 50): Promise<{ details: SyncResult[]; summary: SyncSummary }> {
  try {
    console.log(`[PeopleSync] Iniciando sincronização (limit=${limit})...`);

    // Obter token válido
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED`);

    // Obter clientes sem UUID
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const clientsWithoutUuid = await db
      .select()
      .from(clients)
      .where(or(isNull(clients.contaAzulPersonId), eq(clients.contaAzulPersonId, '')))
      .limit(limit);

    console.log(`[PeopleSync] Encontrados ${clientsWithoutUuid.length} clientes sem UUID`);

    const results: SyncResult[] = [];

    // Processar cada cliente
    for (const client of clientsWithoutUuid) {
      try {
        // Validar dados mínimos
        if (!client.name || client.name.trim().length === 0) {
          console.log(`[PeopleSync] SKIPPED clientId=${client.id} reason=NO_NAME`);
          results.push({
            clientId: client.id,
            name: client.name || 'N/A',
            email: client.email,
            status: 'SKIPPED',
            reason: 'Nome vazio',
          });
          continue;
        }

        // Montar payload
        const payload: any = {
          nome: client.name.trim(),
          tipo: 'Jurídica', // Padrão: Jurídica (com acento conforme API exige)
        };

        // Adicionar email se existir
        if (client.email && client.email.trim().length > 0) {
          payload.email = client.email.trim();
        }
        
        console.log(`[PeopleSync] payload=${JSON.stringify(payload)}`);

        // Adicionar documento se existir
        if (client.document && client.document.trim().length > 0) {
          payload.documento = client.document.trim();
        }
        
        console.log(`[PeopleSync] create_start clientId=${client.id} name=${client.name} tipo=${payload.tipo} payload_keys=${Object.keys(payload).join(',')}`);

        // Criar pessoa no Conta Azul
        console.log(`[PeopleSync] Enviando payload: ${JSON.stringify(payload)}`);
        const createResponse = await axios.post(
          'https://api-v2.contaazul.com/v1/pessoas',
          payload,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
            timeout: 30000,
          }
        );
        console.log(`[PeopleSync] Resposta recebida: ${createResponse.status}`);

        const person = createResponse.data?.data || createResponse.data;
        const uuid = person?.id;
        console.log(`[PeopleSync] Pessoa criada: uuid=${uuid} person=${JSON.stringify(person)}`);

        if (!uuid) {
          console.log(`[PeopleSync] ERROR clientId=${client.id} reason=NO_UUID_IN_RESPONSE response=${JSON.stringify(person)}`);
          results.push({
            clientId: client.id,
            name: client.name,
            email: client.email,
            status: 'ERROR',
            reason: `Sem UUID na resposta: ${JSON.stringify(person)}`,
          });
          continue;
        }

        console.log(`[PeopleSync] create_done clientId=${client.id} uuid=${uuid}`);

        // Persistir UUID no banco
        const updateResult = await db
          .update(clients)
          .set({ contaAzulPersonId: uuid })
          .where(eq(clients.id, client.id));

        console.log(`[PeopleSync] saved_uuid clientId=${client.id} uuid=${uuid}`);

        results.push({
          clientId: client.id,
          name: client.name,
          email: client.email,
          status: 'CREATED',
          uuid,
        });
      } catch (error: any) {
        const status = error.response?.status;
        const errorMsg = error.response?.data?.error || error?.message;

        console.error(`[PeopleSync] ERROR clientId=${client.id} httpStatus=${status} error=${errorMsg}`);

        results.push({
          clientId: client.id,
          name: client.name,
          email: client.email,
          status: 'ERROR',
          reason: errorMsg || error?.message,
        });
      }
    }

    // Resumo
    const created = results.filter(r => r.status === 'CREATED').length;
    const skipped = results.filter(r => r.status === 'SKIPPED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(`[PeopleSync] Resumo: total=${results.length} created=${created} skipped=${skipped} errors=${errors}`);

    return {
      details: results,
      summary: {
        total: results.length,
        created,
        skipped,
        errors,
        message: `Sincronização concluída: ${created} criados, ${skipped} pulados, ${errors} erros`,
      },
    };
  } catch (error: any) {
    console.error(`[PeopleSync] FATAL error=${error?.message}`);
    throw error;
  }
}
