import { Router } from "express";
import { getValidAccessToken } from "./contaAzulOAuthManager";

const router = Router();

interface MatchScore {
  score: number;
  v: number | null;
  dv: string;
}

interface ScoredItem extends MatchScore {
  it: any;
}

function pickList(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.itens)) return data.itens;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.dados)) return data.dados;
  if (data.result && Array.isArray(data.result.itens)) return data.result.itens;
  if (data.data && Array.isArray(data.data.itens)) return data.data.itens;
  return [];
}

function keysPreview(obj: any): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj);
}

function numLike(x: any): number | null {
  if (x == null) return null;
  const s = String(x).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(x: any): string {
  if (!x) return "";
  return String(x).slice(0, 10); // yyyy-mm-dd
}

function deepFindString(obj: any, needle: string): boolean {
  if (!obj || !needle) return false;
  const n = String(needle);
  const stack: any[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (typeof cur === "string" || typeof cur === "number") {
      if (String(cur).includes(n)) return true;
      continue;
    }
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    if (typeof cur === "object") {
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  }
  return false;
}

function scoreMatch(item: any, alvo: any): MatchScore {
  let score = 0;

  // 1) Nosso número (se existir em algum campo)
  if (deepFindString(item, alvo.nossoNumero)) score += 100;

  // 2) Valor
  const v =
    numLike(item?.total) ??
    numLike(item?.valor) ??
    numLike(item?.detalhe_valor?.valor_bruto) ??
    numLike(item?.detalheValor?.valorBruto) ??
    numLike(item?.detalhe_valor?.valor_liquido) ??
    numLike(item?.detalheValor?.valorLiquido);

  if (v != null && Math.abs(v - alvo.valor) <= 1.0) score += 30; // tolerância R$ 1
  if (v != null && Math.abs(v - alvo.valor) <= 0.05) score += 50; // bem exato

  // 3) Vencimento
  const dv =
    dateOnly(item?.data_vencimento) ||
    dateOnly(item?.dataVencimento) ||
    dateOnly(item?.vencimento);

  if (dv && dv === alvo.vencimento) score += 30;

  // 4) Sacado (nome/cnpj em algum lugar)
  if (deepFindString(item, alvo.cnpj)) score += 30;
  if (deepFindString(item, alvo.sacadoHint)) score += 10;

  return { score, v, dv };
}

async function httpGet(url: string, token: string, params: Record<string, any> = {}) {
  const urlObj = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    urlObj.searchParams.set(k, String(v));
  }

  const res = await fetch(urlObj.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }

  return { status: res.status, data };
}

router.get("/api/test/introspect-boleto", async (req, res) => {
  try {
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(401).json({ error: "No valid token" });
    }

    const alvo = {
      nossoNumero: req.query.nosso_numero || "141571260467466",
      valor: Number(req.query.valor || "255.60"),
      vencimento: req.query.vencimento || "2026-02-15",
      sacadoHint: String(req.query.sacado || "R7 GERADORES").toLowerCase(),
      cnpj: req.query.cnpj || "21918918000194",
    };

    const BASE = "https://api-v2.contaazul.com";
    const buscarPath = "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar";

    const buscarParams = {
      pagina: 1,
      tamanho_pagina: 200,
      data_vencimento_de: "2025-01-01",
      data_vencimento_ate: "2026-12-31",
    };

    const r1 = await httpGet(`${BASE}${buscarPath}`, token, buscarParams);

    const list1 = pickList(r1.data);

    if (!list1.length) {
      return res.json({
        ok: false,
        message: "LISTA VAZIA",
        http: r1.status,
        topKeys: keysPreview(r1.data),
        listLength: 0,
        firstItemKeys: [],
      });
    }

    // Match determinístico
    const scored: ScoredItem[] = list1
      .map((it: any) => ({ it, ...scoreMatch(it, alvo) }))
      .sort((a: ScoredItem, b: ScoredItem) => b.score - a.score);

    const top = scored.slice(0, 5);

    const best = top[0];
    if (!best || best.score < 40) {
      return res.json({
        ok: false,
        message: "NENHUM MATCH FORTE",
        http: r1.status,
        topKeys: keysPreview(r1.data),
        listLength: list1.length,
        firstItemKeys: keysPreview(list1[0]),
        topMatches: top.map((t: ScoredItem) => ({
          score: t.score,
          id: t.it?.id,
          valor: t.v,
          venc: t.dv,
          descricao: t.it?.descricao || t.it?.observacao || t.it?.historico,
        })),
      });
    }

    const parcelaId = best.it?.id;
    if (!parcelaId) {
      return res.json({
        ok: false,
        message: "Melhor item sem campo 'id'",
        topMatches: top.map((t: ScoredItem) => ({
          score: t.score,
          id: t.it?.id,
          valor: t.v,
          venc: t.dv,
        })),
      });
    }

    // GET detalhes da parcela
    const parcelaPath = `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(parcelaId)}`;
    const r2 = await httpGet(`${BASE}${parcelaPath}`, token);

    const maybePix = deepFindString(r2.data, "pix") ? "FOUND_PIX_WORD" : null;
    const hasNossoNumero = deepFindString(r2.data, alvo.nossoNumero as string);

    res.json({
      ok: true,
      http: r1.status,
      topKeys: keysPreview(r1.data),
      listLength: list1.length,
      firstItemKeys: keysPreview(list1[0]),
      topMatches: top.map((t: ScoredItem) => ({
        score: t.score,
        id: t.it?.id,
        valor: t.v,
        venc: t.dv,
        descricao: t.it?.descricao || t.it?.observacao || t.it?.historico,
      })),
      bestMatch: {
        score: best.score,
        id: parcelaId,
        valor: best.v,
        venc: best.dv,
      },
      parcelaHttp: r2.status,
      parcelaKeys: keysPreview(r2.data),
      parcelaData: r2.data,
      extractions: {
        parcelaId,
        hasNossoNumero,
        maybePix,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || String(err),
    });
  }
});

export default router;
