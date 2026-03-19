import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  // Buscar uma config de prestador
  const [configs] = await conn.execute(
    'SELECT id, razaoSocial, cnpj, modo_auth, portal_id FROM nfse_config LIMIT 1'
  );
  
  if (!Array.isArray(configs) || configs.length === 0) {
    console.log('❌ Nenhuma configuração de prestador encontrada');
    process.exit(1);
  }
  
  const config = configs[0];
  console.log('✅ Empresa Piloto Encontrada:');
  console.log(JSON.stringify(config, null, 2));
  
  // Buscar portal associado
  if (config.portal_id) {
    const [portals] = await conn.execute(
      'SELECT id, nome FROM nfse_portais WHERE id = ?',
      [config.portal_id]
    );
    
    if (Array.isArray(portals) && portals.length > 0) {
      const portal = portals[0];
      console.log('\n✅ Portal Associado:');
      console.log(JSON.stringify({
        id: portal.id,
        nome: portal.nome
      }, null, 2));
    }
  }
  
  // Buscar um tomador
  const [tomadores] = await conn.execute(
    'SELECT id, nome, cpfCnpj FROM nfse_tomadores LIMIT 1'
  );
  
  if (Array.isArray(tomadores) && tomadores.length > 0) {
    const tomador = tomadores[0];
    console.log('\n✅ Tomador Encontrado:');
    console.log(JSON.stringify({
      id: tomador.id,
      nome: tomador.nome,
      cpfCnpj: tomador.cpfCnpj
    }, null, 2));
  } else {
    console.log('\n⚠️  Nenhum tomador encontrado');
  }
} catch (err) {
  console.error('❌ Erro:', err.message);
} finally {
  await conn.end();
}
