import express from 'express';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';

const router = express.Router();

/**
 * Endpoint de bypass para inserir token simulado (DEV ONLY)
 * POST /api/oauth/bypass/insert-token
 */
router.post('/insert-token', async (req, res) => {
  // SEGURANÇA: Apenas em desenvolvimento
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Bypass endpoint não disponível em produção'
    });
  }

  try {
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'Não consegui conectar ao banco de dados'
      });
    }

    // Inserir token simulado
    const simulatedToken = 'simulated_token_' + Date.now();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    await db.insert(contaAzulTokens).values({
      accessToken: simulatedToken,
      refreshToken: 'simulated_refresh_' + Date.now(),
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return res.status(200).json({
      success: true,
      message: 'Token simulado inserido com sucesso',
      token: simulatedToken,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('[Bypass] Erro ao inserir token:', error);
    return res.status(500).json({
      error: 'INSERT_ERROR',
      message: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

export default router;
