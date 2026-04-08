const fs = require('fs');
const path = require('path');

// Ler DATABASE_URL
const envPath = path.join(__dirname, '.env.production');
const envContent = fs.readFileSync(envPath, 'utf8');
const databaseUrl = envContent
  .split('\n')
  .find(line => line.startsWith('DATABASE_URL='))
  ?.replace('DATABASE_URL=', '')
  .trim();

if (!databaseUrl) {
  console.error('❌ DATABASE_URL não encontrada');
  process.exit(1);
}

// Usar módulo nativo
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

(async () => {
  try {
    // Tentar com psql via comando shell
    const sqlCommands = `
      CREATE TABLE IF NOT EXISTS nfse_usuarios_autorizados (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        telefone VARCHAR(20) NOT NULL,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO nfse_usuarios_autorizados (nome, telefone) VALUES
      ('Charles', '5527997052311'),
      ('Stevens', '5527981657804')
      ON CONFLICT DO NOTHING;

      SELECT * FROM nfse_usuarios_autorizados;
    `;

    const cmd = `psql "${databaseUrl}" << 'ENDOFSQL'\n${sqlCommands}\nENDOFSQL`;
    const { stdout, stderr } = await execAsync(cmd);
    
    console.log('✓ Tabela criada e dados inseridos');
    console.log(stdout);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
})();
