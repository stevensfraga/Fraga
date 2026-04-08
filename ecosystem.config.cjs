require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'fraga-dashboard',
      script: 'npm',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DATABASE_URL: process.env.DATABASE_URL,
        OAUTH_SERVER_URL: process.env.OAUTH_SERVER_URL
      },
      // Restart automático
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.next'],
      max_memory_restart: '1G',
      
      // Auto restart em caso de crash
      autorestart: true,
      max_restarts: 100,
      min_uptime: '10s',
      
      // Monitoramento
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Sinais de graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000
    },
    {
      name: 'fraga-dashboard-backup',
      script: 'npm',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DATABASE_URL: process.env.DATABASE_URL,
        OAUTH_SERVER_URL: process.env.OAUTH_SERVER_URL
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
