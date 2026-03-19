/**
 * BLOCO 11.4 — Enriquecimento via API Conta Azul
 * 
 * Busca telefones dos clientes diretamente da API Conta Azul
 * e atualiza clients.phone, clients.phoneCellular, clients.whatsappNumber
 * 
 * ✅ Usa getValidAccessToken() do OAuthManager (refresh automático)
 */

import axios from 'axios';
import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { eq, or, isNull } from 'drizzle-orm';
import { normalizePhoneToE164, getPhoneConfidence } from './whatsappEnrichment';
import { getValidAccessToken } from '../contaAzulOAuthManager';

const CA_API_BASE = 'https://api-v2.contaazul.com/v1';

export interface EnrichFromAPIResult {
  clientId: number;
  clientName: string;
  contaAzulPersonId: string | null;
  phoneRaw: string | null;
  phoneCellularRaw: string | null;
  phoneE164: string | null;
  action: 'updated' | 'skipped' | 'not_found' | 'error';
  reason?: string;
}

export interface EnrichFromAPISummary {
  total: number;
  updated: number;
  skipped: number;
  notFound: number;
  errors: number;
  tokenDecision: 'TOKEN_OK' | 'REFRESHED' | 'REAUTH_REQUIRED';
  samples: EnrichFromAPIResult[];
}

/**
 * Buscar dados de pessoa (cliente) na API Conta Azul
 * Usa o endpoint correto: /v1/customers/{id}
 */
async function fetchPersonFromContaAzul(
  contaAzulPersonId: string,
  token: string
): Promise<{ phone: string | null; phoneCellular: string | null } | null> {
  try {
    // Usar /v1/pessoas/{id} (endpoint correto da API v2)
    const response = await axios.get(
      `${CA_API_BASE}/pessoas/${contaAzulPersonId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 10000,
      }
    );

    const data = response.data;
    
    // Campos reais da API Conta Azul v2:
    // telefone_comercial, telefone_celular, outros_contatos[], email
    const phone = data.telefone_comercial || null;
    const phoneCellular = data.telefone_celular || null;
    
    // Se ambos vazios, tentar outros_contatos
    let otherPhone: string | null = null;
    if (!phone && !phoneCellular && Array.isArray(data.outros_contatos)) {
      for (const contato of data.outros_contatos) {
        if (contato.tipo === 'celular' || contato.tipo === 'telefone') {
          otherPhone = contato.valor || contato.numero || null;
          if (otherPhone) break;
        }
      }
    }

    return { 
      phone: phone || otherPhone, 
      phoneCellular: phoneCellular || otherPhone 
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null; // Pessoa não encontrada
    }
    throw error;
  }
}

/**
 * Enriquecer clientes via API Conta Azul
 * 
 * ✅ Usa getValidAccessToken() — refresh automático se expirado
 * ✅ Se refresh falhar, retorna REAUTH_REQUIRED
 * 
 * @param dryRun - Se true, apenas simula sem aplicar no DB
 * @param limit - Máximo de clientes a processar
 */
export async function enrichFromContaAzulAPI(
  dryRun: boolean = true,
  limit: number = 50
): Promise<EnrichFromAPISummary> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  // ✅ Usar getValidAccessToken() com refresh automático
  let token: string;
  let tokenDecision: 'TOKEN_OK' | 'REFRESHED' | 'REAUTH_REQUIRED' = 'TOKEN_OK';

  try {
    token = await getValidAccessToken();
    console.log('[EnrichFromAPI] Token obtido via getValidAccessToken()');
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('REFRESH_TOKEN_INVALID') || msg.includes('Reautorize')) {
      console.error('[EnrichFromAPI] Token expirado e refresh falhou. REAUTH_REQUIRED.');
      return {
        total: 0,
        updated: 0,
        skipped: 0,
        notFound: 0,
        errors: 0,
        tokenDecision: 'REAUTH_REQUIRED',
        samples: [],
      };
    }
    throw error;
  }

  // Buscar clientes SEM whatsappNumber mas COM contaAzulPersonId
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      contaAzulPersonId: clients.contaAzulPersonId,
      whatsappNumber: clients.whatsappNumber,
    })
    .from(clients)
    .where(
      or(
        isNull(clients.whatsappNumber),
        eq(clients.whatsappNumber, '')
      )
    )
    .limit(limit);

  const results: EnrichFromAPIResult[] = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    if (!row.contaAzulPersonId) {
      results.push({
        clientId: row.id,
        clientName: row.name,
        contaAzulPersonId: null,
        phoneRaw: null,
        phoneCellularRaw: null,
        phoneE164: null,
        action: 'skipped',
        reason: 'NO_CONTA_AZUL_PERSON_ID',
      });
      skippedCount++;
      continue;
    }

    try {
      // Buscar dados da pessoa na API Conta Azul
      const personData = await fetchPersonFromContaAzul(row.contaAzulPersonId, token);

      if (!personData) {
        results.push({
          clientId: row.id,
          clientName: row.name,
          contaAzulPersonId: row.contaAzulPersonId,
          phoneRaw: null,
          phoneCellularRaw: null,
          phoneE164: null,
          action: 'not_found',
          reason: 'PERSON_NOT_FOUND_IN_CONTA_AZUL',
        });
        notFoundCount++;
        continue;
      }

      // Priorizar celular, senão usar telefone fixo
      const phoneToUse = personData.phoneCellular || personData.phone;
      const phoneE164 = normalizePhoneToE164(phoneToUse);

      if (!phoneE164) {
        results.push({
          clientId: row.id,
          clientName: row.name,
          contaAzulPersonId: row.contaAzulPersonId,
          phoneRaw: personData.phone,
          phoneCellularRaw: personData.phoneCellular,
          phoneE164: null,
          action: 'skipped',
          reason: phoneToUse ? 'INVALID_PHONE_FORMAT' : 'NO_PHONE_IN_CONTA_AZUL',
        });
        skippedCount++;
        continue;
      }

      // Atualizar no banco (se não for dry run)
      if (!dryRun) {
        await db
          .update(clients)
          .set({
            phone: personData.phone,
            phoneCellular: personData.phoneCellular,
            whatsappNumber: phoneE164,
            whatsappSource: 'conta-azul',
            whatsappValidatedAt: new Date(),
            whatsappApprovalMethod: 'sync-conta-azul',
          })
          .where(eq(clients.id, row.id));
      }

      results.push({
        clientId: row.id,
        clientName: row.name,
        contaAzulPersonId: row.contaAzulPersonId,
        phoneRaw: personData.phone,
        phoneCellularRaw: personData.phoneCellular,
        phoneE164,
        action: 'updated',
        reason: dryRun ? 'DRY_RUN' : undefined,
      });
      updatedCount++;
    } catch (error: any) {
      const status = error.response?.status || 0;

      // Se 401 no meio do loop, tentar refresh uma vez
      if (status === 401) {
        console.warn('[EnrichFromAPI] 401 durante enriquecimento, tentando refresh...');
        try {
          token = await getValidAccessToken();
          tokenDecision = 'REFRESHED';
          console.log('[EnrichFromAPI] Token renovado com sucesso, continuando...');
          // Retry este cliente
          try {
            const personData = await fetchPersonFromContaAzul(row.contaAzulPersonId!, token);
            if (personData) {
              const phoneToUse = personData.phoneCellular || personData.phone;
              const phoneE164 = normalizePhoneToE164(phoneToUse);
              if (phoneE164) {
                if (!dryRun) {
                  await db
                    .update(clients)
                    .set({
                      phone: personData.phone,
                      phoneCellular: personData.phoneCellular,
                      whatsappNumber: phoneE164,
                      whatsappSource: 'conta-azul',
                      whatsappValidatedAt: new Date(),
                      whatsappApprovalMethod: 'sync-conta-azul',
                    })
                    .where(eq(clients.id, row.id));
                }
                results.push({
                  clientId: row.id,
                  clientName: row.name,
                  contaAzulPersonId: row.contaAzulPersonId,
                  phoneRaw: personData.phone,
                  phoneCellularRaw: personData.phoneCellular,
                  phoneE164,
                  action: 'updated',
                  reason: dryRun ? 'DRY_RUN_AFTER_REFRESH' : 'AFTER_REFRESH',
                });
                updatedCount++;
                continue;
              }
            }
          } catch {
            // Retry falhou também
          }
        } catch (refreshErr: any) {
          console.error('[EnrichFromAPI] Refresh falhou. REAUTH_REQUIRED.');
          tokenDecision = 'REAUTH_REQUIRED';
          // Parar o loop — token inválido
          results.push({
            clientId: row.id,
            clientName: row.name,
            contaAzulPersonId: row.contaAzulPersonId,
            phoneRaw: null,
            phoneCellularRaw: null,
            phoneE164: null,
            action: 'error',
            reason: 'REAUTH_REQUIRED',
          });
          errorCount++;
          break; // Parar processamento
        }
      }

      console.error(`[EnrichFromAPI] Erro ao buscar pessoa ${row.contaAzulPersonId}:`, error.message);
      results.push({
        clientId: row.id,
        clientName: row.name,
        contaAzulPersonId: row.contaAzulPersonId,
        phoneRaw: null,
        phoneCellularRaw: null,
        phoneE164: null,
        action: 'error',
        reason: error.message,
      });
      errorCount++;
    }

    // Rate limiting: aguardar 100ms entre requisições
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    total: rows.length,
    updated: updatedCount,
    skipped: skippedCount,
    notFound: notFoundCount,
    errors: errorCount,
    tokenDecision,
    samples: results.slice(0, 10),
  };
}
