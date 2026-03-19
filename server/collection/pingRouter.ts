/**
 * PING ROUTER — Endpoint simples para verificar se o servidor está vivo
 * Não depende de banco de dados ou variáveis de ambiente
 */

import express from 'express';

const router = express.Router();

router.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: 'pong',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'unknown',
  });
});

export default router;
