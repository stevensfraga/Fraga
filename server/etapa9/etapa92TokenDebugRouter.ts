import express from "express";
import { getValidAccessToken } from "../contaAzulOAuthManager";
import { getContaAzulTokenCacheStatus } from "../contaAzul/contaAzulAuth";

const router = express.Router();

/**
 * DEBUG: Verificar qual token está no banco e no cache
 */
router.get("/token-debug", async (req, res) => {
  try {
    console.log("[token-debug] Iniciando debug de token...");

    // 1. Verificar cache
    const cacheStatus = getContaAzulTokenCacheStatus();
    console.log("[token-debug] Cache status:", cacheStatus);

    // 2. Obter token do banco
    const token = await getValidAccessToken();
    console.log("[token-debug] Token obtido:", token ? `${token.substring(0, 50)}...` : "null");

    // 3. Testar token
    if (token) {
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

      console.log(`[token-debug] Test status: ${testStatus}`);
      console.log(`[token-debug] Test body: ${testBody.substring(0, 200)}`);

      return res.json({
        ok: testStatus === 200,
        decision: testStatus === 200 ? "TOKEN_VALID" : "TOKEN_INVALID",
        cacheStatus,
        tokenPreview: token.substring(0, 50),
        testStatus,
        testBodyPreview: testBody.substring(0, 300),
      });
    } else {
      return res.json({
        ok: false,
        decision: "NO_TOKEN",
        cacheStatus,
        message: "getValidAccessToken() retornou null",
      });
    }
  } catch (error) {
    console.error("[token-debug] Erro:", error);
    return res.status(500).json({
      ok: false,
      decision: "SERVER_ERROR",
      message: String(error),
    });
  }
});

export default router;
