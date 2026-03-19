import { Router } from "express";
import { getDb } from "./db";
import { contaAzulTokens } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

/**
 * GET /api/test/oauth/token-raw
 * Retorna token direto do DB para testes
 * ?unsafe=1 para retornar token completo (default: apenas prefix)
 */
router.get("/token-raw", async (req, res) => {
  try {
    const unsafe = req.query.unsafe === "1";

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    const result = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.updatedAt))
      .limit(1);

    if (!result || result.length === 0) {
      return res.status(404).json({ error: "No token found in database" });
    }

    const token = result[0];
    const now = new Date();
    const expiresAt = new Date(token.expiresAt);
    const msToExpiry = expiresAt.getTime() - now.getTime();
    const minutesUntilExpiry = Math.round(msToExpiry / 1000 / 60);
    const isExpiredNow = msToExpiry <= 0;

    const response: any = {
      tokenPrefix: token.accessToken.slice(0, 20) + "...",
      expiresAt: expiresAt.toISOString(),
      isExpiredNow,
      minutesUntilExpiry,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      hasRefreshToken: !!token.refreshToken,
    };

    // Se unsafe=1, retornar token completo
    if (unsafe) {
      response.accessToken = token.accessToken;
      response.refreshToken = token.refreshToken;
      console.warn("[tokenRawRouter] ⚠️ UNSAFE MODE: Token completo retornado!");
    }

    res.json(response);
  } catch (err: any) {
    console.error(`[tokenRawRouter] Erro: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
