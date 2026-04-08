import express from 'express';
import { getDb } from './db';
import { contaAzulTokens } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

router.get('/db-dump', async (req, res) => {
  try {
    console.log('[OAuthDbDump] Buscando token do DB...');
    
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'Database connection failed' });
    }
    const rows = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(contaAzulTokens.updatedAt)
      .limit(1);

    if (rows.length === 0) {
      return res.json({
        hasRow: false,
        message: 'Nenhum token encontrado no DB'
      });
    }

    const row = rows[0];
    const nowMs = Date.now();
    const nowISO = new Date(nowMs).toISOString();
    
    // Parse expiresAt (pode estar em string ISO ou timestamp)
    let expiresAtMs: number | null = null;
    let expiresAtISO: string | null = null;
    
    if (row.expiresAt) {
      if (typeof row.expiresAt === 'string') {
        expiresAtMs = new Date(row.expiresAt).getTime();
        expiresAtISO = row.expiresAt;
      } else if (typeof row.expiresAt === 'number') {
        expiresAtMs = row.expiresAt;
        expiresAtISO = new Date(row.expiresAt).toISOString();
      } else if (row.expiresAt instanceof Date) {
        expiresAtMs = row.expiresAt.getTime();
        expiresAtISO = row.expiresAt.toISOString();
      }
    }

    const msToExpiry = expiresAtMs ? expiresAtMs - nowMs : null;
    const isExpiredComputed = msToExpiry !== null && msToExpiry <= 0;

    const result = {
      hasRow: true,
      tokenPrefix: row.accessToken?.substring(0, 20) || 'N/A',
      expiresAtISO,
      expiresAtRaw: row.expiresAt,
      expiresAtType: typeof row.expiresAt,
      nowISO,
      nowMs,
      expiresAtMs,
      msToExpiry,
      minutesToExpiry: msToExpiry ? Math.floor(msToExpiry / 60000) : null,
      isExpiredComputed,
      hasRefreshToken: !!row.refreshToken,
      refreshTokenPrefix: row.refreshToken?.substring(0, 20) || 'N/A',
      updatedAtISO: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      userId: row.userId,
    };

    console.log('[OAuthDbDump] Resultado:', JSON.stringify(result, null, 2));

    return res.json(result);
  } catch (error) {
    console.error('[OAuthDbDump] Erro:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

export default router;
