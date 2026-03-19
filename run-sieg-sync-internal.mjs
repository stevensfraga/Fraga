/**
 * Script para executar syncCertificatesToSieg() internamente
 * Acessa o banco de dados diretamente sem HTTP
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { certificates } from './drizzle/schema.ts';
import { eq, and, isNull, ne } from 'drizzle-orm';
import { syncCertificatesToSieg } from './server/jobs/syncCertificatesToSieg.ts';

async function runSyncInternal() {
  console.log('[SIEG-SYNC-INTERNAL] 🚀 Iniciando sincronização manual interna...\n');

  try {
    // 1. Conectar ao banco
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'fraga_dashboard',
    });

    const db = drizzle(connection);

    // 2. Listar certificados candidatos
    console.log('[SIEG-SYNC-INTERNAL] 📋 Listando certificados candidatos...');
    const candidates = await db
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.isActive, true),
          eq(certificates.status, 'valid'),
          ne(certificates.validTo, null)
        )
      )
      .orderBy(certificates.validTo)
      .limit(10);

    console.log(`✅ Encontrados ${candidates.length} certificados candidatos\n`);

    if (candidates.length === 0) {
      console.log('⚠️ Nenhum certificado candidato encontrado. Abortando.\n');
      await connection.end();
      return;
    }

    const recommended = candidates[0];
    console.log(`✅ Certificado piloto recomendado:`);
    console.log(`   CNPJ: ${recommended.cnpj}`);
    console.log(`   ID: ${recommended.id}`);
    console.log(`   Válido até: ${recommended.validTo}\n`);

    // 3. Executar sincronização
    console.log('[SIEG-SYNC-INTERNAL] 🔐 Executando sincronização...');
    const result = await syncCertificatesToSieg();

    // 4. Retornar relatório objetivo
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 RELATÓRIO DE SINCRONIZAÇÃO SIEG');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📋 CANDIDATOS:');
    console.log(`   Total encontrado: ${candidates.length}`);
    console.log(`   Piloto escolhido: ${recommended.cnpj} (ID: ${recommended.id})`);
    console.log(`   Status piloto: ${result.pilot?.success ? '✅ SUCESSO' : '❌ FALHA'}`);
    if (result.pilot?.siegId) {
      console.log(`   SIEG ID do piloto: ${result.pilot.siegId}`);
    }

    console.log('\n📤 RESULTADO DO LOTE:');
    console.log(`   Enviados: ${result.stats.sent}`);
    console.log(`   Falhados: ${result.stats.failed}`);
    console.log(`   Pulados: ${result.stats.skipped}`);

    if (result.stats.skipped_details) {
      console.log('\n   Detalhes dos pulados:');
      if (result.stats.skipped_details.skipped_no_file) {
        console.log(`     - Sem arquivo: ${result.stats.skipped_details.skipped_no_file}`);
      }
      if (result.stats.skipped_details.skipped_default_password) {
        console.log(`     - Senha default: ${result.stats.skipped_details.skipped_default_password}`);
      }
      if (result.stats.skipped_details.skipped_invalid_status) {
        console.log(`     - Status inválido: ${result.stats.skipped_details.skipped_invalid_status}`);
      }
      if (result.stats.skipped_details.skipped_already_sent) {
        console.log(`     - Já enviados: ${result.stats.skipped_details.skipped_already_sent}`);
      }
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\n❌ PRIMEIROS ERROS:');
      result.errors.slice(0, 3).forEach((err, idx) => {
        console.log(`   ${idx + 1}. CNPJ ${err.cnpj}: ${err.error}`);
      });
    }

    // 5. Validar atualização no banco
    console.log('\n✅ CONFIRMAÇÃO DE ATUALIZAÇÃO NO BANCO:');
    const updatedCerts = await db
      .select()
      .from(certificates)
      .where(ne(certificates.siegStatus, null))
      .limit(5);

    if (updatedCerts.length > 0) {
      console.log(`   sieg_status: ✅ Atualizado (${updatedCerts.length} certificados com status)`);
      console.log(`   sieg_id: ${updatedCerts.some(c => c.siegId) ? '✅ Preenchido' : '⚠️ Não preenchido'}`);
      console.log(`   sieg_sent_at: ${updatedCerts.some(c => c.siegSentAt) ? '✅ Preenchido' : '⚠️ Não preenchido'}`);
      console.log(`   sieg_error: ${updatedCerts.some(c => c.siegError) ? '✅ Preenchido' : '⚠️ Não preenchido'}`);

      console.log('\n   Exemplo de certificado atualizado:');
      const example = updatedCerts[0];
      console.log(`   - CNPJ: ${example.cnpj}`);
      console.log(`   - sieg_status: ${example.siegStatus}`);
      console.log(`   - sieg_id: ${example.siegId || 'N/A'}`);
      console.log(`   - sieg_sent_at: ${example.siegSentAt || 'N/A'}`);
      console.log(`   - sieg_error: ${example.siegError || 'N/A'}`);
    } else {
      console.log(`   ⚠️ Nenhum certificado foi atualizado no banco`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    if (result.success) {
      console.log('✅ Sincronização concluída com sucesso!');
      console.log('🔄 Cron diário (08:00 BRT) está pronto para operar sozinho.\n');
    } else {
      console.log('❌ Sincronização falhou. Verifique os erros acima.\n');
    }

    await connection.end();

  } catch (error) {
    console.error('\n❌ Erro ao executar sincronização:');
    console.error(error instanceof Error ? error.message : String(error));
    console.error(error instanceof Error ? error.stack : '');
    process.exit(1);
  }
}

runSyncInternal();
