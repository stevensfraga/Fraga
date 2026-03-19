import express from "express";
import { refreshAccessToken, getValidAccessToken } from "../contaAzulOAuthManager";
import { clearContaAzulTokenCache } from "../contaAzul/contaAzulAuth";
import { getDb } from "../db";
import { contaAzulTokens } from "../../drizzle/schema";
import { desc } from "drizzle-orm";

const router = express.Router();

/**
 * Forçar refresh do token OAuth
 */
router.get("/force-refresh", async (req, res) => {
  try {
    console.log("[force-refresh] Limpando cache e forçando refresh...");

    // 1. Limpar cache
    clearContaAzulTokenCache();

    // 2. Obter refresh token do banco
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        decision: "DB_ERROR",
        message: "Erro ao conectar ao banco de dados",
      });
    }
    const lastToken = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.createdAt))
      .limit(1);

    if (!db || !lastToken || lastToken.length === 0 || !lastToken[0].refreshToken) {
      return res.status(400).json({
        ok: false,
        decision: "NO_REFRESH_TOKEN",
        message: "Nenhum refresh token encontrado no banco",
      });
    }

    const refreshToken = lastToken[0].refreshToken;
    console.log(`[force-refresh] Refresh token: ${refreshToken.substring(0, 50)}...`);

    // 3. Fazer refresh
    let result: any;
    try {
      result = await refreshAccessToken(refreshToken);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        decision: "REFRESH_ERROR",
        message: String(error),
      });
    }

    console.log("[force-refresh] Refresh result:", result);

    if (!result || !result.access_token) {
      return res.status(400).json({
        ok: false,
        decision: "REFRESH_FAILED",
        message: "Refresh falhou",
      });
    }

    // 4. Testar novo token
    const token = result.access_token;
    const testUrl = "https://api.contaazul.com/v1/pessoas";
    const testResponse = await fetch(testUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const testStatus = testResponse.status;
    const testBody = await testResponse.text();

    console.log(`[force-refresh] Test status: ${testStatus}`);

    return res.json({
      ok: testStatus === 200,
      decision: testStatus === 200 ? "TOKEN_REFRESHED_OK" : "TOKEN_STILL_INVALID",
      refreshResult: {
        success: result.success,
        accessToken: token.substring(0, 50),
        expiresIn: result.expiresIn,
      },
      testStatus,
      testBodyPreview: testBody.substring(0, 300),
    });
  } catch (error) {
    console.error("[force-refresh] Erro:", error);
    return res.status(500).json({
      ok: false,
      decision: "SERVER_ERROR",
      message: String(error),
    });
  }
});

export default router;
