#!/usr/bin/env node

import mysql from 'mysql2/promise';
import fetch from 'node-fetch';

const DB_URL = process.env.DATABASE_URL;

async function getDb() {
  return mysql.createConnection(DB_URL);
}

async function main() {
  console.log('[TEST] Iniciando teste de emissão real com logs...\n');

  // 1. Buscar empresa piloto
  console.log('[TEST] 1. Buscando empresa piloto...');
  const db = await getDb();
  const [empresas] = await db.execute(`
    SELECT c.id, c.cnpj, c.razaoSocial, c.portalUsuario, c.portalSenha
    FROM nfse_config c
    WHERE c.cnpj = '07838084000186'
    LIMIT 1
  `);
  await db.end();

  if (!empresas || empresas.length === 0) {
    console.error('[TEST] ❌ Empresa piloto não encontrada');
    process.exit(1);
  }

  const config = empresas[0];
  console.log(`[TEST] ✅ Empresa piloto encontrada: ${config.razaoSocial} (${config.cnpj})\n`);

  // 2. Buscar tomador piloto
  console.log('[TEST] 2. Buscando tomador piloto...');
  const db2 = await getDb();
  const [tomadores] = await db2.execute(`
    SELECT id, nome as nome, cpfCnpj
    FROM nfse_tomadores
    WHERE cpfCnpj = '01991394000150'
    LIMIT 1
  `);
  await db2.end();

  if (!tomadores || tomadores.length === 0) {
    console.error('[TEST] ❌ Tomador piloto não encontrado');
    process.exit(1);
  }

  const tomador = tomadores[0];
  console.log(`[TEST] ✅ Tomador piloto encontrado: ${tomador.nome} (${tomador.cpfCnpj})\n`);

  // 3. Criar emissão de teste
  console.log('[TEST] 3. Criando emissão de teste...');
  const db3 = await getDb();
  const [result] = await db3.execute(`
    INSERT INTO nfse_emissoes (
      configId, tomadorId, tomadorNome, tomadorCpfCnpj, valor, competencia, descricaoServico, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    config.id,
    tomador.id,
    tomador.nome,
    tomador.cpfCnpj,
    '1000.00',
    '2026-03',
    'Serviço de Contabilidade - Teste com Logs',
    'pendente'
  ]);
  await db3.end();

  const emissaoId = result.insertId;
  console.log(`[TEST] ✅ Emissão criada: ID ${emissaoId}\n`);

  // 4. Executar endpoint de emissão real
  console.log('[TEST] 4. Executando POST /api/nfse/emit-real...');
  console.log(`[TEST] Aguardando resultado (pode levar 5-10 minutos)...\n`);

  const startTime = Date.now();
  const response = await fetch('http://localhost:3000/api/nfse/emit-real', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-admin-key': 'Fraga@123'
    },
    body: JSON.stringify({ emissaoId })
  });

  const result2 = await response.json();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[TEST] ✅ Resposta recebida em ${duration}s`);
  console.log(`[TEST] Status: ${result2.status}`);
  console.log(`[TEST] Número NFS-e: ${result2.numeroNfse || 'não capturado'}\n`);

  // 5. Buscar logs da emissão
  console.log('[TEST] 5. Buscando logs da emissão...');
  const db4 = await getDb();
  const [logs] = await db4.execute(`
    SELECT step, status, message, timestamp
    FROM nfse_emissao_logs
    WHERE emissaoId = ?
    ORDER BY timestamp ASC
  `, [emissaoId]);
  await db4.end();

  console.log(`[TEST] ✅ ${logs.length} logs encontrados:\n`);
  logs.forEach((log, idx) => {
    const icon = log.status === 'ok' ? '✅' : '❌';
    console.log(`  ${idx + 1}. ${icon} ${log.step} (${log.status})`);
    if (log.message) {
      console.log(`     ${log.message}`);
    }
  });

  // 6. Resumo
  console.log('\n[TEST] ════════════════════════════════════════════════════════');
  console.log(`[TEST] Emissão ID: ${emissaoId}`);
  console.log(`[TEST] Empresa: ${config.razaoSocial}`);
  console.log(`[TEST] Tomador: ${tomador.nome}`);
  console.log(`[TEST] Duração: ${duration}s`);
  console.log(`[TEST] Status Final: ${result2.status}`);
  console.log(`[TEST] Número NFS-e: ${result2.numeroNfse || 'não capturado'}`);
  console.log(`[TEST] Logs Registrados: ${logs.length}`);
  console.log('[TEST] ════════════════════════════════════════════════════════\n');

  console.log('[TEST] Para diagnóstico completo, execute:');
  console.log(`[TEST] curl http://localhost:3000/api/nfse/diagnostic/${emissaoId} | jq\n`);
}

main().catch(err => {
  console.error('[TEST] ❌ Erro:', err.message);
  process.exit(1);
});
