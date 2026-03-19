import mysql from 'mysql2/promise';
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  console.log('='.repeat(60));
  console.log('TESTE DE EMISSÃO REAL DE NFS-e');
  console.log('='.repeat(60));
  console.log('');

  // 1. Buscar empresa piloto
  console.log('1️⃣  Buscando empresa piloto...');
  const [configs] = await conn.execute(
    'SELECT id, razaoSocial, cnpj FROM nfse_config LIMIT 1'
  );
  
  if (!Array.isArray(configs) || configs.length === 0) {
    console.log('❌ Nenhuma configuração de prestador encontrada');
    process.exit(1);
  }
  
  const config = configs[0];
  console.log('✅ Empresa Piloto:');
  console.log(`   ID: ${config.id}`);
  console.log(`   Razão Social: ${config.razaoSocial}`);
  console.log(`   CNPJ: ${config.cnpj}`);
  console.log('');

  // 2. Buscar tomador
  console.log('2️⃣  Buscando tomador...');
  const [tomadoresResult] = await conn.execute(
    'SELECT id, nome, cpfCnpj FROM nfse_tomadores LIMIT 1'
  );
  const tomadores = Array.isArray(tomadoresResult) ? tomadoresResult : [];
  
  let tomadorId = null;
  if (tomadores.length > 0) {
    const tomador = tomadores[0];
    tomadorId = tomador.id;
    console.log('✅ Tomador:');
    console.log(`   ID: ${tomador.id}`);
    console.log(`   Nome: ${tomador.nome}`);
    console.log(`   CNPJ/CPF: ${tomador.cpfCnpj}`);
  } else {
    console.log('⚠️  Nenhum tomador encontrado - criando emissão sem tomador');
  }
  console.log('');

  // 3. Criar emissão de teste no banco
  console.log('3️⃣  Criando emissão de teste no banco...');
  const dataEmissao = new Date().toISOString().split('T')[0];
  const dataVencimento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const insertResult = await conn.execute(
    `INSERT INTO nfse_emissoes (
      configId, tomadorId, tomadorNome, tomadorCpfCnpj,
      descricaoServico, valor, competencia, status, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      config.id,
      tomadorId,
      tomadores && tomadores.length > 0 ? tomadores[0].nome : 'N/A',
      tomadores && tomadores.length > 0 ? tomadores[0].cpfCnpj : 'N/A',
      'Serviço de Contabilidade',
      1000.00,
      dataEmissao.substring(0, 7),
      'pendente'
    ]
  );
  
  const emissaoId = insertResult[0].insertId;
  console.log('✅ Emissão criada:');
  console.log(`   ID: ${emissaoId}`);
  console.log(`   Status: pending`);
  console.log(`   Valor: R$ 1.000,00`);
  console.log('');

  // 4. Executar endpoint real
  console.log('4️⃣  Executando POST /api/nfse/emit-real...');
  console.log(`   URL: ${BASE_URL}/api/nfse/emit-real`);
  console.log(`   Payload: { emissaoId: ${emissaoId}, adminKey: "Fraga@123" }`);
  console.log('');

  const response = await fetch(`${BASE_URL}/api/nfse/emit-real`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emissaoId: emissaoId,
      adminKey: 'Fraga@123'
    })
  });

  const result = await response.json();

  console.log('5️⃣  Resultado da Emissão:');
  console.log(`   Status HTTP: ${response.status}`);
  console.log(`   Success: ${result.success}`);
  console.log(`   Número NFS-e: ${result.numeroNfse || 'não capturado'}`);
  console.log(`   Série: ${result.serieNfse || 'não capturado'}`);
  console.log(`   PDF URL: ${result.pdfUrl || 'não disponível'}`);
  console.log(`   Message: ${result.message}`);
  
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  
  if (result.screenshotUrl) {
    console.log(`   Screenshot: ${result.screenshotUrl}`);
  }
  console.log('');

  // 5. Exibir logs por etapa
  if (result.logs && Array.isArray(result.logs)) {
    console.log('6️⃣  Logs Detalhados por Etapa:');
    result.logs.forEach((log, idx) => {
      const status = log.status === 'ok' ? '✅' : '❌';
      console.log(`   ${idx + 1}. ${status} [${log.stage}] ${log.message}`);
      if (log.details) {
        console.log(`      Detalhes: ${JSON.stringify(log.details)}`);
      }
    });
  }
  console.log('');

  // 6. Verificar status no banco
  console.log('7️⃣  Status no Banco de Dados:');
  const [emissoes] = await conn.execute(
    'SELECT id, status, numeroNfse, serieNfse, pdfUrl, createdAt, updatedAt FROM nfse_emissoes WHERE id = ?',
    [emissaoId]
  );
  
  if (Array.isArray(emissoes) && emissoes.length > 0) {
    const emissao = emissoes[0];
    console.log(`   ID: ${emissao.id}`);
    console.log(`   Status: ${emissao.status}`);
    console.log(`   Número NFS-e: ${emissao.numeroNfse || 'não capturado'}`);
    console.log(`   Série: ${emissao.serieNfse || 'não capturado'}`);
    console.log(`   PDF URL: ${emissao.pdfUrl || 'não disponível'}`);
    console.log(`   Criado em: ${emissao.createdAt}`);
    console.log(`   Atualizado em: ${emissao.updatedAt}`);
  }
  console.log('');

  // 7. Resumo final
  console.log('='.repeat(60));
  if (result.success) {
    console.log('✅ EMISSÃO BEM-SUCEDIDA!');
    console.log(`   Número da NFS-e: ${result.numeroNfse}`);
    console.log(`   Emissão ID: ${emissaoId}`);
  } else {
    console.log('❌ EMISSÃO FALHOU');
    console.log(`   Erro: ${result.error || result.message}`);
    console.log(`   Emissão ID: ${emissaoId}`);
    console.log('');
    console.log('   Próximos passos:');
    console.log('   1. Verificar logs acima para identificar em qual etapa falhou');
    console.log('   2. Se houver screenshot, analisar o estado da página');
    console.log('   3. Corrigir a etapa específica que falhou');
    console.log('   4. Executar novamente o teste');
  }
  console.log('='.repeat(60));

} catch (err) {
  console.error('❌ Erro:', err.message);
  console.error(err);
} finally {
  await conn.end();
}
