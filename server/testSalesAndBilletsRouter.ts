import { Router } from "express";
import axios from "axios";
import { ContaAzulTokenManager } from "./contaAzulTokenManager";
import { getDb } from "./db";
import { contaAzulTokens } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * GET /api/test/sales-and-billets
 * Testa API de Vendas e Cobranças do Conta Azul
 */
router.get("/sales-and-billets", async (req, res) => {
  try {
    // Tentar obter token com fallback
    let token: string | null = null;
    try {
      token = await ContaAzulTokenManager.getValidAccessToken();
    } catch (err: any) {
      console.log("[testSalesAndBilletsRouter] TokenManager error:", err.message);
      console.log("[testSalesAndBilletsRouter] Tentando obter token diretamente do banco...");
      
      // Fallback: obter token diretamente do banco
      const db = await getDb();
      if (db) {
        const result = await db
          .select()
          .from(contaAzulTokens)
          .where(eq(contaAzulTokens.userId, 1))
          .limit(1);
        if (result && result.length > 0) {
          token = result[0].accessToken;
          console.log("[testSalesAndBilletsRouter] ✅ Token obtido do banco");
        }
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Token inválido" });
    }

    const BASE = "https://api-v2.contaazul.com";
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    // ========================================================================
    // TESTE 1: GET /v1/sales
    // ========================================================================
    console.log("\n📍 TESTE 1: GET /v1/sales");
    let salesResult: any = { ok: false, error: "Não testado" };
    try {
      const salesRes = await axios.get(`${BASE}/v1/sales?limit=10`, {
        headers,
        timeout: 30000,
        validateStatus: () => true,
      });

      console.log(`   HTTP: ${salesRes.status}`);
      if (salesRes.status === 200) {
        console.log(`   ✅ Endpoint existe`);
        console.log(`   Keys: ${Object.keys(salesRes.data).join(", ")}`);
        console.log(`   Items: ${Array.isArray(salesRes.data) ? salesRes.data.length : "N/A"}`);

        // Procurar por Venda 14464
        let venda14464 = null;
        if (Array.isArray(salesRes.data)) {
          venda14464 = salesRes.data.find((v: any) => v.id === 14464 || v.numero === 14464);
        } else if (salesRes.data.items) {
          venda14464 = salesRes.data.items.find((v: any) => v.id === 14464 || v.numero === 14464);
        }

        salesResult = {
          ok: true,
          http: salesRes.status,
          keys: Object.keys(salesRes.data),
          itemCount: Array.isArray(salesRes.data) ? salesRes.data.length : salesRes.data.items?.length || 0,
          venda14464: venda14464 || null,
          firstItem: Array.isArray(salesRes.data) ? salesRes.data[0] : salesRes.data.items?.[0] || null,
        };
      } else {
        salesResult = {
          ok: false,
          http: salesRes.status,
          error: salesRes.data,
        };
      }
    } catch (err: any) {
      salesResult = {
        ok: false,
        error: err.message,
      };
    }

    // ========================================================================
    // TESTE 2: GET /v1/bank-billets
    // ========================================================================
    console.log("\n📍 TESTE 2: GET /v1/bank-billets");
    let billetsResult: any = { ok: false, error: "Não testado" };
    try {
      const billetsRes = await axios.get(`${BASE}/v1/bank-billets?limit=10`, {
        headers,
        timeout: 30000,
        validateStatus: () => true,
      });

      console.log(`   HTTP: ${billetsRes.status}`);
      if (billetsRes.status === 200) {
        console.log(`   ✅ Endpoint existe`);
        console.log(`   Keys: ${Object.keys(billetsRes.data).join(", ")}`);

        // Procurar por nosso_numero 141571260467466
        let boleto = null;
        if (Array.isArray(billetsRes.data)) {
          boleto = billetsRes.data.find((b: any) => b.our_number === "141571260467466" || b.nosso_numero === "141571260467466");
        } else if (billetsRes.data.items) {
          boleto = billetsRes.data.items.find((b: any) => b.our_number === "141571260467466" || b.nosso_numero === "141571260467466");
        }

        billetsResult = {
          ok: true,
          http: billetsRes.status,
          keys: Object.keys(billetsRes.data),
          itemCount: Array.isArray(billetsRes.data) ? billetsRes.data.length : billetsRes.data.items?.length || 0,
          boleto141571260467466: boleto || null,
          firstItem: Array.isArray(billetsRes.data) ? billetsRes.data[0] : billetsRes.data.items?.[0] || null,
        };
      } else {
        billetsResult = {
          ok: false,
          http: billetsRes.status,
          error: billetsRes.data,
        };
      }
    } catch (err: any) {
      billetsResult = {
        ok: false,
        error: err.message,
      };
    }

    // ========================================================================
    // TESTE 3: GET /v1/bank-billets com filtro nosso_numero
    // ========================================================================
    console.log("\n📍 TESTE 3: GET /v1/bank-billets?our_number=141571260467466");
    let billetsFilterResult: any = { ok: false, error: "Não testado" };
    try {
      const billetsFilterRes = await axios.get(
        `${BASE}/v1/bank-billets?our_number=141571260467466&limit=10`,
        {
          headers,
          timeout: 30000,
          validateStatus: () => true,
        }
      );

      console.log(`   HTTP: ${billetsFilterRes.status}`);
      if (billetsFilterRes.status === 200) {
        console.log(`   ✅ Endpoint existe`);
        billetsFilterResult = {
          ok: true,
          http: billetsFilterRes.status,
          keys: Object.keys(billetsFilterRes.data),
          itemCount: Array.isArray(billetsFilterRes.data) ? billetsFilterRes.data.length : billetsFilterRes.data.items?.length || 0,
          data: billetsFilterRes.data,
        };
      } else {
        billetsFilterResult = {
          ok: false,
          http: billetsFilterRes.status,
          error: billetsFilterRes.data,
        };
      }
    } catch (err: any) {
      billetsFilterResult = {
        ok: false,
        error: err.message,
      };
    }

    // ========================================================================
    // RESPOSTA FINAL
    // ========================================================================
    res.json({
      ok: true,
      tests: {
        sales: salesResult,
        billets: billetsResult,
        billetsFilter: billetsFilterResult,
      },
      summary: {
        salesOk: salesResult.ok,
        billetsOk: billetsResult.ok,
        billetsFilterOk: billetsFilterResult.ok,
        venda14464Found: salesResult.venda14464 ? true : false,
        boleto141571260467466Found: billetsResult.boleto141571260467466 ? true : false,
        boleto141571260467466FoundViaFilter: billetsFilterResult.itemCount > 0,
      },
    });
  } catch (err: any) {
    console.error(`❌ Erro: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
