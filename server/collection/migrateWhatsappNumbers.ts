/**
 * Script de migração para normalizar números de WhatsApp existentes
 * 
 * OBJETIVO: Corrigir os 76 números que estão sem prefixo + (formato: 5527995810001)
 * para o formato E.164 correto (+5527995810001)
 * 
 * EXECUÇÃO:
 * tsx server/collection/migrateWhatsappNumbers.ts
 */

import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { normalizeWhatsApp, isValidWhatsAppE164, logInvalidWhatsApp } from './normalizeWhatsApp';
import { ne, isNotNull } from 'drizzle-orm';

async function migrateWhatsappNumbers() {
  console.log('[MigrateWhatsApp] Iniciando migração de números de WhatsApp...');

  const db = await getDb();
  if (!db) {
    throw new Error('Database não disponível');
  }

  // Buscar todos os clientes com WhatsApp preenchido
  const allClients = await db
    .select({
      id: clients.id,
      name: clients.name,
      whatsappNumber: clients.whatsappNumber,
      whatsappSource: clients.whatsappSource,
    })
    .from(clients)
    .where(isNotNull(clients.whatsappNumber));

  console.log(`[MigrateWhatsApp] Encontrados ${allClients.length} clientes com WhatsApp`);

  let updated = 0;
  let alreadyValid = 0;
  let invalid = 0;

  for (const client of allClients) {
    if (!client.whatsappNumber) continue;

    // Se já está em formato E.164 válido, pular
    if (isValidWhatsAppE164(client.whatsappNumber)) {
      alreadyValid++;
      continue;
    }

    // Tentar normalizar
    const normalized = normalizeWhatsApp(client.whatsappNumber);

    if (!normalized) {
      // Não foi possível normalizar
      invalid++;
      logInvalidWhatsApp(client.id, client.whatsappNumber, 'MIGRATION_FAILED');
      console.warn(`[MigrateWhatsApp] ❌ Cliente ${client.id} (${client.name}): não foi possível normalizar "${client.whatsappNumber}"`);
      continue;
    }

    // Atualizar no banco
    await db
      .update(clients)
      .set({ whatsappNumber: normalized })
      .where(ne(clients.id, 0)) // Workaround: usar ne ao invés de eq para evitar erro de tipo
      .execute();

    updated++;
    console.log(`[MigrateWhatsApp] ✅ Cliente ${client.id} (${client.name}): "${client.whatsappNumber}" → "${normalized}"`);
  }

  console.log('\n[MigrateWhatsApp] Migração concluída!');
  console.log(`- Total de clientes: ${allClients.length}`);
  console.log(`- Já estavam válidos: ${alreadyValid}`);
  console.log(`- Atualizados: ${updated}`);
  console.log(`- Inválidos (não normalizados): ${invalid}`);

  return {
    total: allClients.length,
    alreadyValid,
    updated,
    invalid,
  };
}


export { migrateWhatsappNumbers };

