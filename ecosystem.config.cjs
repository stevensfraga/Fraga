// Env carregado pelo wrapper /opt/fraga-start.sh

module.exports = {
  apps: [
    {
      name: 'fraga-dashboard',
      script: '/opt/fraga-start.sh',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DATABASE_URL: process.env.DATABASE_URL,
        OAUTH_SERVER_URL: process.env.OAUTH_SERVER_URL,
        // IA / Secretária Virtual
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_SECRETARY_ENABLED: process.env.CLAUDE_SECRETARY_ENABLED,
        INBOUND_AI_ENABLED: process.env.INBOUND_AI_ENABLED,
        WHATSAPP_AI_WHITELIST: process.env.WHATSAPP_AI_WHITELIST,
        // ZapContábil
        ZAP_CONTABIL_API_URL: process.env.ZAP_CONTABIL_API_URL,
        ZAP_CONTABIL_API_KEY: process.env.ZAP_CONTABIL_API_KEY,
        ZAP_CONTABIL_BASE_URL: process.env.ZAP_CONTABIL_BASE_URL,
        ZAP_CONTABIL_USER: process.env.ZAP_CONTABIL_USER,
        ZAP_CONTABIL_PASS: process.env.ZAP_CONTABIL_PASS,
        // Conta Azul OAuth
        CONTA_AZUL_CLIENT_ID: process.env.CONTA_AZUL_CLIENT_ID,
        CONTA_AZUL_CLIENT_SECRET: process.env.CONTA_AZUL_CLIENT_SECRET,
        CONTA_AZUL_REDIRECT_URI: process.env.CONTA_AZUL_REDIRECT_URI,
        CONTA_AZUL_API_BASE: process.env.CONTA_AZUL_API_BASE,
        CONTA_AZUL_ACCOUNT_ID: process.env.CONTA_AZUL_ACCOUNT_ID,
        // Régua de Cobrança
        COBRANCA_QUEUE_ID: process.env.COBRANCA_QUEUE_ID,
        FINANCEIRO_QUEUE_ID: process.env.FINANCEIRO_QUEUE_ID,
        AUTO_CLOSE_COBRANCA_ENABLED: process.env.AUTO_CLOSE_COBRANCA_ENABLED,
        AUTO_CLOSE_COBRANCA_MINUTES: process.env.AUTO_CLOSE_COBRANCA_MINUTES,
        COBRANCA_TRANSFER_USER_ID: process.env.COBRANCA_TRANSFER_USER_ID,
        // Feature flags
        ALLOW_REAL_SEND: process.env.ALLOW_REAL_SEND,
        ALLOW_CRON_ENABLE: process.env.ALLOW_CRON_ENABLE,
        DISPATCH_PROD_ONLY: process.env.DISPATCH_PROD_ONLY,
        FOLLOWUP_ENABLED: process.env.FOLLOWUP_ENABLED,
      },
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.next'],
      max_memory_restart: '1G',
      autorestart: true,
      max_restarts: 100,
      min_uptime: '10s',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      listen_timeout: 3000
    },
    {
      name: 'fraga-dashboard-backup',
      script: '/opt/fraga-start.sh',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DATABASE_URL: process.env.DATABASE_URL,
        OAUTH_SERVER_URL: process.env.OAUTH_SERVER_URL,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_SECRETARY_ENABLED: process.env.CLAUDE_SECRETARY_ENABLED,
        WHATSAPP_AI_WHITELIST: process.env.WHATSAPP_AI_WHITELIST,
      },
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.next'],
      max_memory_restart: '1G',
      autorestart: true,
      max_restarts: 100,
      min_uptime: '10s',
      error_file: './logs/error-backup.log',
      out_file: './logs/out-backup.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      listen_timeout: 3000
    }
  ]
};
