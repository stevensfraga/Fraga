import { Router } from "express";
import axios from "axios";
import { ContaAzulTokenManager } from "./contaAzulTokenManager";
import { getDb } from "./db";
import { contaAzulTokens } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const router = Router();

const BASE_URL = "https://api-v2.contaazul.com";
const ENDPOINT = "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar";

function pickArrayKey(data: any) {
  if (!data || typeof data !== "object") return { key: null, arr: [] };
  const candidates = ["itens", "dados", "items", "resultados", "resultado", "eventos", "data"];
  for (const k of candidates) {
    if (Array.isArray(data[k])) return { key: k, arr: data[k] };
  }
  // fallback: procurar primeiro array no objeto
  const firstArrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
  return { key: firstArrayKey ?? null, arr: firstArrayKey ? data[firstArrayKey] : [] };
}

function safeGetVenc(item: any) {
  return (
    item?.data_vencimento ??
    item?.vencimento ??
    item?.due_date ??
    item?.dataVencimento ??
    null
  );
}

async function runOnce(label: string, params: any, accessToken: string) {
  const url = `${BASE_URL}${ENDPOINT}`;

  const client = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "fraga-dashboard/contaazul-probe",
    },
  });

  // Montar "final URL" manualmente (prova!)
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") qs.set(k, String(v));
  });
  const finalUrl = `${url}?${qs.toString()}`;

  console.log(`\n📍 RUN: ${label}`);
  console.log(`   finalUrl: ${finalUrl}`);

  const res = await client.get(ENDPOINT, { params });

  const keys = Object.keys(res.data || {});
  const { key: arrayKey, arr } = pickArrayKey(res.data);

  const first = arr?.[0];
  const last = arr?.[arr.length - 1];

  console.log(`   http: ${res.status}`);
  console.log(`   response.keys: ${JSON.stringify(keys)}`);
  console.log(`   arrayKey: ${arrayKey} | arrayLen: ${arr?.length ?? 0}`);
  console.log(`   first.venc: ${safeGetVenc(first)} | last.venc: ${safeGetVenc(last)}`);

  return {
    label,
    finalUrl,
    status: res.status,
    arrayKey,
    len: arr?.length ?? 0,
    firstVenc: safeGetVenc(first),
    lastVenc: safeGetVenc(last),
    firstSample: first ? JSON.stringify(first).slice(0, 300) : null,
    lastSample: last && last !== first ? JSON.stringify(last).slice(0, 300) : null,
  };
}

/**
 * GET /api/test/prova-ignora-data
 * Executa 3 rodadas com datas diferentes para provar que o endpoint ignora parâmetros de data
 */
router.get("/prova-ignora-data", async (req, res) => {
  try {
    // Obter token do banco
    let accessToken: string | null = null;
    try {
      accessToken = await ContaAzulTokenManager.getValidAccessToken();
    } catch (err: any) {
      console.log("[provaIgnorDataRouter] TokenManager error, tentando fallback...");
      const db = await getDb();
      if (db) {
        const result = await db
          .select()
          .from(contaAzulTokens)
          .where(eq(contaAzulTokens.userId, 1))
          .limit(1);
        if (result && result.length > 0) {
          accessToken = result[0].accessToken;
        }
      }
    }

    if (!accessToken) {
      return res.status(401).json({ error: "Token inválido" });
    }

    const baseParams = {
      pagina: 1,
      tamanho_pagina: 200,
    };

    console.log("\n🔍 INICIANDO PROVA DE BUG: Endpoint ignora parâmetros de data");

    const r1 = await runOnce(
      "WIDE_2020_2030",
      { ...baseParams, data_vencimento_de: "2020-01-01", data_vencimento_ate: "2030-12-31" },
      accessToken
    );

    const r2 = await runOnce(
      "YEAR_2026",
      { ...baseParams, data_vencimento_de: "2026-01-01", data_vencimento_ate: "2026-12-31" },
      accessToken
    );

    const r3 = await runOnce(
      "MONTH_2026_02",
      { ...baseParams, data_vencimento_de: "2026-02-01", data_vencimento_ate: "2026-02-28" },
      accessToken
    );

    const same =
      r1.firstVenc === r2.firstVenc &&
      r2.firstVenc === r3.firstVenc &&
      r1.lastVenc === r2.lastVenc &&
      r2.lastVenc === r3.lastVenc;

    console.log("\n📊 COMPARATIVO:");
    console.log(`   r1.firstVenc: ${r1.firstVenc} | r1.lastVenc: ${r1.lastVenc}`);
    console.log(`   r2.firstVenc: ${r2.firstVenc} | r2.lastVenc: ${r2.lastVenc}`);
    console.log(`   r3.firstVenc: ${r3.firstVenc} | r3.lastVenc: ${r3.lastVenc}`);

    console.log("\n🔴 CONCLUSÃO:");
    console.log(same ? "BUG PROVADO: datas ignoradas (mesmo range retornado em 3 consultas)" : "OK: datas parecem afetar resultado");

    res.json({
      ok: true,
      bugProven: same,
      results: [r1, r2, r3],
      conclusion: same
        ? "🔴 BUG PROVADO: endpoint ignora parâmetros data_vencimento_de/ate (mesmo range retornado em 3 consultas com datas diferentes)"
        : "✅ OK: datas parecem afetar resultado",
    });
  } catch (err: any) {
    console.error(`❌ Erro: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
