-- Tabela para armazenar states OAuth com TTL (10 minutos)
CREATE TABLE IF NOT EXISTS oauth_state (
  id VARCHAR(255) PRIMARY KEY,
  state VARCHAR(255) NOT NULL UNIQUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expiresAt TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  usedAt TIMESTAMP NULL
);

-- Índice para limpeza de states expirados
CREATE INDEX idx_oauth_state_expiresAt ON oauth_state(expiresAt);
CREATE INDEX idx_oauth_state_used ON oauth_state(used);
