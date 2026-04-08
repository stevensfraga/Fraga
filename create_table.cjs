const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const url = require('url');

const execAsync = promisify(exec);

(async () => {
  try {
    const envPath = path.join(__dirname, '.env.production');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const databaseUrl = envContent
      .split('\n')
      .find(line => line.startsWith('DATABASE_URL='))
      ?.replace('DATABASE_URL=', '')
      .trim();

    if (!databaseUrl) {
      throw new Error('DATABASE_URL não encontrada');
    }

    // Parsear MySQL URL
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname;
    const port = parsed.port || 3306;
    const user = parsed.username;
    const password = parsed.password;
    const database = parsed.pathname.replace('/', '');

    console.log(`Conectando a: ${host}:${port}/${database}`);

    const sqlCommands = `
      CREATE TABLE IF NOT EXISTS nfse_usuarios_autorizados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        telefone VARCHAR(20) NOT NULL,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO nfse_usuarios_autorizados (nome, telefone) VALUES
      ('Charles', '5527997052311'),
      ('Stevens', '5527981657804');

      SELECT * FROM nfse_usuarios_autorizados;
    `;

    const cmd = `mysql -h "${host}" -P ${port} -u "${user}" -p"${password}" "${database}" << 'ENDOFSQL'\n${sqlCommands}\nENDOFSQL`;
    
    const { stdout, stderr } = await execAsync(cmd);
    
    console.log('✓ Sucesso!\n');
    if (stdout) console.log(stdout);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
})();
