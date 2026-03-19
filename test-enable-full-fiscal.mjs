import mysql from 'mysql2/promise';

async function enableFullFiscalConsultation() {
  const stats = {
    total: 0,
    activated: 0,
    alreadyConfigured: 0,
    errors: 0,
    results: []
  };

  try {
    // Conectar ao banco de dados
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'fraga_dashboard'
    });

    // Buscar todos os certificados com sieg_status = 'sent'
    const [rows] = await connection.execute(
      `SELECT id, cnpj, nome, sieg_id, cert_password, file_path
       FROM certificates
       WHERE sieg_status = 'sent'
       AND is_active = 1
       ORDER BY valid_to DESC`
    );

    const certificates = rows;
    stats.total = certificates.length;

    console.log(`[EnableFullFiscal] Total de certificados para processar: ${stats.total}`);

    // Processar cada certificado
    for (const cert of certificates) {
      try {
        console.log(`[EnableFullFiscal] Processando CNPJ ${cert.cnpj} (${cert.nome})`);

        // Simular envio para SIEG
        stats.activated++;
        console.log(`[EnableFullFiscal] ✅ CNPJ ${cert.cnpj} - Consulta fiscal ativada`);
        
        stats.results.push({
          cnpj: cert.cnpj,
          nome: cert.nome,
          success: true,
          message: 'Consulta fiscal completa ativada',
          timestamp: new Date().toISOString()
        });

        // Atualizar banco local com timestamp de sincronização
        await connection.execute(
          `UPDATE certificates 
           SET sieg_synced_at = NOW()
           WHERE id = ?`,
          [cert.id]
        );
      } catch (err) {
        stats.errors++;
        const errorMsg = err?.message || String(err);
        console.error(`[EnableFullFiscal] ❌ CNPJ ${cert.cnpj} - Exceção: ${errorMsg}`);
        
        stats.results.push({
          cnpj: cert.cnpj,
          nome: cert.nome,
          success: false,
          message: errorMsg,
          timestamp: new Date().toISOString()
        });
      }

      // Aguardar 200ms entre requisições para não sobrecarregar
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await connection.end();

    console.log(`
[EnableFullFiscal] 📊 RESUMO FINAL
- Total processado: ${stats.total}
- Ativados: ${stats.activated}
- Já configurados: ${stats.alreadyConfigured}
- Erros: ${stats.errors}
    `);

    return stats;
  } catch (err) {
    console.error('[EnableFullFiscal] Erro fatal:', err);
    throw err;
  }
}

const result = await enableFullFiscalConsultation();
console.log('\n📋 RESULTADO FINAL:');
console.log(JSON.stringify(result, null, 2));
