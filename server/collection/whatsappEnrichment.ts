/**
 * BLOCO 11.4 — AÇÃO A: Enriquecimento de WhatsApp via Conta Azul
 * 
 * Mapeia telefones do Conta Azul (phone/celular) para clients.whatsappNumber
 * Normaliza para E.164 (+55DDDNUMERO)
 * Salva whatsappSource = 'CONTA_AZUL_PHONE'
 */

import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { isNull, or, eq } from 'drizzle-orm';

export interface EnrichmentResult {
  clientId: number;
  clientName: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  action: 'updated' | 'skipped' | 'invalid';
  reason?: string;
}

export interface EnrichmentSummary {
  total: number;
  updated: number;
  skipped: number;
  invalid: number;
  samples: EnrichmentResult[];
}

/**
 * Normalizar telefone para E.164
 * Regras:
 * 1. Remove non-digits
 * 2. Se len 12-13 e começa 55 -> +55...
 * 3. Se len 10-11 -> +55...
 * 4. Se inválido -> null
 */
export function normalizePhoneToE164(phone: string | null): string | null {
  if (!phone) return null;

  // Remove tudo que não é dígito
  const digits = phone.replace(/\D/g, '');

  // Validar comprimento
  if (digits.length < 10 || digits.length > 13) {
    return null; // Inválido
  }

  // Se já começa com 55 e tem 12-13 dígitos
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  // Se tem 10-11 dígitos (DDD + número BR)
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  // Outros casos: inválido
  return null;
}

/**
 * Determinar nível de confiança do telefone
 * HIGH: celular (9 no início do número)
 * MED: fixo ou incerto
 */
export function getPhoneConfidence(phoneE164: string): 'HIGH' | 'MED' {
  // Telefone celular BR: +55 DDD 9XXXX-XXXX (11 dígitos após +55)
  const digits = phoneE164.replace(/\D/g, '');
  if (digits.length === 13 && digits[4] === '9') {
    return 'HIGH'; // Celular
  }
  return 'MED'; // Fixo ou incerto
}

/**
 * Enriquecer base de WhatsApp via Conta Azul
 * 
 * @param dryRun - Se true, apenas simula sem aplicar no DB
 * @param limit - Máximo de clientes a processar
 */
export async function enrichWhatsAppFromContaAzul(
  dryRun: boolean = true,
  limit: number = 100
): Promise<EnrichmentSummary> {
  const db = await getDb();
  if (!db) throw new Error('Database não disponível');

  // Buscar clientes SEM whatsappNumber mas COM phone
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phone,
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

  const results: EnrichmentResult[] = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let invalidCount = 0;

  for (const row of rows) {
    const phoneE164 = normalizePhoneToE164(row.phone);

    if (!phoneE164) {
      // Telefone inválido ou ausente
      results.push({
        clientId: row.id,
        clientName: row.name,
        phoneRaw: row.phone,
        phoneE164: null,
        action: 'invalid',
        reason: row.phone ? 'INVALID_FORMAT' : 'NO_PHONE',
      });
      invalidCount++;
      continue;
    }

    if (row.whatsappNumber && row.whatsappNumber.trim() !== '') {
      // Já tem WhatsApp cadastrado
      results.push({
        clientId: row.id,
        clientName: row.name,
        phoneRaw: row.phone,
        phoneE164,
        action: 'skipped',
        reason: 'ALREADY_HAS_WHATSAPP',
      });
      skippedCount++;
      continue;
    }

    // Atualizar no banco (se não for dry run)
    if (!dryRun) {
      const confidence = getPhoneConfidence(phoneE164);
      await db
        .update(clients)
        .set({
          whatsappNumber: phoneE164,
          whatsappSource: 'conta-azul', // Mapeado do phone do Conta Azul
          whatsappValidatedAt: new Date(),
          whatsappApprovalMethod: 'sync-conta-azul',
        })
        .where(eq(clients.id, row.id));
    }

    results.push({
      clientId: row.id,
      clientName: row.name,
      phoneRaw: row.phone,
      phoneE164,
      action: 'updated',
      reason: dryRun ? 'DRY_RUN' : undefined,
    });
    updatedCount++;
  }

  return {
    total: rows.length,
    updated: updatedCount,
    skipped: skippedCount,
    invalid: invalidCount,
    samples: results.slice(0, 10), // Primeiros 10 para preview
  };
}
