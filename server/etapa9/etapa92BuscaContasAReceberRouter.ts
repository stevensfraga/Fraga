import express from "express";
import { getContaAzulToken } from "../contaAzul/contaAzulAuth";

const router = express.Router();

/**
 * ETAPA 9.2 — PASSO 1: Buscar contas a receber em aberto via API oficial
 * 
 * GET /api/test/etapa9/r7/busca-contas-receber
 * 
 * Objetivo:
 * - Buscar contas a receber em aberto
 * - Identificar parcela da venda 14464 (R7 Geradores)
 * - Confirmar valor e vencimento
 * 
 * Critério de Done:
 * - HTTP 200
 * - totalFetched > 0
 * - Encontrar parcela com referência a venda 14464
 * - Retornar ID da parcela para PASSO 2
 */
router.get("/busca-contas-receber", async (req, res) => {
  try {
    const token = await getContaAzulToken();
    if (!token) {
      return res.status(401).json({
        ok: false,
        decision: "NO_TOKEN",
        message: "Token OAuth não disponível",
      });
    }

    // PASSO 1: Buscar contas a receber em aberto
    const baseUrl = "https://api.contaazul.com/v1";
    const endpoint = "/financeiro/eventos-financeiros/contas-a-receber/buscar";
    const url = `${baseUrl}${endpoint}`;

    console.log(`[ETAPA 9.2-1] Buscando contas a receber em: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const statusCode = response.status;
    const contentType = response.headers.get("content-type");
    const bodyText = await response.text();

    console.log(`[ETAPA 9.2-1] Status: ${statusCode}, Content-Type: ${contentType}`);
    console.log(`[ETAPA 9.2-1] Body Preview: ${bodyText.substring(0, 500)}`);

    if (statusCode !== 200) {
      return res.status(statusCode).json({
        ok: false,
        decision: "API_ERROR",
        statusCode,
        contentType,
        bodyPreview: bodyText.substring(0, 300),
        message: "Erro ao buscar contas a receber",
      });
    }

    // Parse JSON
    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch (e) {
      return res.status(400).json({
        ok: false,
        decision: "JSON_PARSE_ERROR",
        message: "Resposta não é JSON válido",
        bodyPreview: bodyText.substring(0, 300),
      });
    }

    // Analisar resposta
    const items = Array.isArray(data) ? data : data.data || data.items || [];
    console.log(`[ETAPA 9.2-1] Total de itens: ${items.length}`);

    // Procurar por venda 14464 (R7)
    const r7Items = items.filter((item: any) => {
      const descricao = item.descricao || item.description || "";
      const referencia = item.referencia || item.reference || "";
      const numero = item.numero || item.number || "";
      
      return (
        descricao.includes("14464") ||
        descricao.includes("R7") ||
        referencia.includes("14464") ||
        referencia.includes("R7") ||
        numero === "14464"
      );
    });

    console.log(`[ETAPA 9.2-1] Itens com referência a R7/14464: ${r7Items.length}`);

    // Retornar resultado
    return res.json({
      ok: true,
      decision: r7Items.length > 0 ? "R7_FOUND" : "R7_NOT_FOUND",
      totalFetched: items.length,
      r7ItemsFound: r7Items.length,
      r7Items: r7Items.map((item: any) => ({
        id: item.id,
        descricao: item.descricao || item.description,
        referencia: item.referencia || item.reference,
        numero: item.numero || item.number,
        valor: item.valor || item.amount,
        vencimento: item.vencimento || item.dueDate,
        status: item.status,
        rawKeys: Object.keys(item),
      })),
      nextAction: r7Items.length > 0 ? "PASSO_2_BUSCAR_DETALHES" : "BUSCAR_MANUALMENTE",
    });
  } catch (error) {
    console.error("[ETAPA 9.2-1] Erro:", error);
    return res.status(500).json({
      ok: false,
      decision: "SERVER_ERROR",
      message: String(error),
    });
  }
});

export default router;
