import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function createTestEmission() {
  console.log('🔧 Criando emissão de teste no banco...\n');

  const conn = await mysql.createConnection(DATABASE_URL!);
  
  try {
    // Verificar se tabela existe
    const [tables] = await conn.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nfse_emissoes'`
    );
    
    if (tables.length === 0) {
      console.log('❌ Tabela nfse_emissoes não encontrada!');
      console.log('   Tabelas disponíveis:');
      const [allTables] = await conn.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
      );
      allTables.forEach((t: any) => console.log(`   - ${t.TABLE_NAME}`));
      process.exit(1);
    }

    console.log('✅ Tabela nfse_emissoes encontrada\n');

    // Competência no formato YYYY-MM (ex: 2026-03)
    const competencia = new Date().toISOString().substring(0, 7);

    // Criar emissão de teste
    const [result] = await conn.execute(
      `INSERT INTO nfse_emissoes (
        configId, 
        tomadorNome, 
        tomadorCpfCnpj, 
        valor, 
        competencia, 
        descricaoServico,
        status, 
        solicitadoVia, 
        createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        1,
        'A.C. XAVIER ME',
        '01991394000150',
        1000.00,
        competencia,
        'Serviço de contabilidade',
        'rascunho',
        'dashboard',
      ]
    );

    const emissaoId = (result as any).insertId;
    console.log(`✅ Emissão criada com sucesso!`);
    console.log(`   Emissão ID: ${emissaoId}\n`);

    // Retornar o ID para o script de teste
    console.log(JSON.stringify({ emissaoId }));

  } catch (error) {
    console.error('❌ Erro ao criar emissão:', (error as any).message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

createTestEmission();
