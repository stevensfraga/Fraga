/**
 * Sincronização de Contas a Receber do Conta Azul
 * 
 * Busca parcelas OVERDUE da API Conta Azul, busca detalhes (URL fatura),
 * e persiste no banco local (tabelas clients + receivables).
 */
import { Router, Request, Response } from "express";
import mysql from "mysql2/promise";

const router = Router();

const CA_BASE = "https://api-v2.contaazul.com";

async function getToken(conn: mysql.Connection): Promise<string> {
  const [rows] = await conn.execute(
    "SELECT accessToken FROM contaAzulTokens ORDER BY createdAt DESC LIMIT 1"
  ) as any;
  if (!rows.length) throw new Error("No Conta Azul token found");
  return rows[0].accessToken;
}

async function caFetch(path: string, token: string): Promise<any> {
  const url = `${CA_BASE}${path}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`CA API ${resp.status}: ${body.substring(0, 200)}`);
  }
  return resp.json();
}

/**
 * Busca ou cria cliente no banco local a partir do ID do Conta Azul
 */
async function upsertClient(
  conn: mysql.Connection,
  caClientId: string,
  clientName: string
): Promise<number> {
  // Buscar cliente existente
  const [existing] = await conn.execute(
    "SELECT id FROM clients WHERE contaAzulId = ?",
    [caClientId]
  ) as any;

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Criar novo cliente
  const [result] = await conn.execute(
    `INSERT INTO clients (contaAzulId, name, status, createdAt, updatedAt)
     VALUES (?, ?, 'active', NOW(), NOW())
     ON DUPLICATE KEY UPDATE name = VALUES(name), updatedAt = NOW()`,
    [caClientId, clientName]
  ) as any;

  return result.insertId || existing[0]?.id;
}

/**
 * Upsert receivable no banco local
 */
async function upsertReceivable(
  conn: mysql.Connection,
  data: {
    contaAzulId: string;
    clientId: number;
    amount: number;
    dueDate: string;
    status: string;
    description: string;
    link: string | null;
    paymentLinkCanonical?: string | null;
    paymentInfoPublic: boolean;
    paymentInfoSource: string | null;
  }
): Promise<{ action: "inserted" | "updated"; id: number }> {
  // Verificar se já existe
  const [existing] = await conn.execute(
    "SELECT id, status, link FROM receivables WHERE contaAzulId = ?",
    [data.contaAzulId]
  ) as any;

  const mapStatus = (caStatus: string): string => {
    switch (caStatus) {
      case "OVERDUE":
      case "ATRASADO":
        return "overdue";
      case "PENDING":
      case "PENDENTE":
        return "pending";
      case "ACQUITTED":
      case "RECEBIDO":
        return "paid";
      case "LOST":
      case "PERDIDO":
        return "cancelled";
      default:
        return "pending";
    }
  };

  const dbStatus = mapStatus(data.status);
  const monthsOverdue = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(data.dueDate).getTime()) / (30 * 24 * 60 * 60 * 1000)
    )
  );

  if (existing.length > 0) {
    await conn.execute(
      `UPDATE receivables SET
        amount = ?, dueDate = ?, status = ?, description = ?,
        link = COALESCE(?, link), paymentLinkCanonical = COALESCE(?, paymentLinkCanonical),
        monthsOverdue = ?,
        paymentInfoPublic = ?, paymentInfoSource = COALESCE(?, paymentInfoSource),
        paymentInfoUpdatedAt = NOW(), source = 'conta-azul', updatedAt = NOW()
       WHERE contaAzulId = ?`,
      [
        data.amount,
        data.dueDate,
        dbStatus,
        data.description,
        data.link,
        data.paymentLinkCanonical,
        monthsOverdue,
        data.paymentInfoPublic,
        data.paymentInfoSource,
        data.contaAzulId,
      ]
    );
    return { action: "updated", id: existing[0].id };
  }

  const [result] = await conn.execute(
    `INSERT INTO receivables
      (contaAzulId, clientId, amount, dueDate, status, description, link, paymentLinkCanonical,
       monthsOverdue, paymentInfoPublic, paymentInfoSource, paymentInfoUpdatedAt,
       source, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'conta-azul', NOW(), NOW())`,
    [
      data.contaAzulId,
      data.clientId,
      data.amount,
      data.dueDate,
      dbStatus,
      data.description,
      data.link,
      data.paymentLinkCanonical,
      monthsOverdue,
      data.paymentInfoPublic,
      data.paymentInfoSource,
    ]
  ) as any;

  return { action: "inserted", id: result.insertId };
}

/**
 * POST /api/test/sync-receivables
 * 
 * Sincroniza contas a receber do Conta Azul para o banco local.
 * Query params:
 *   - limit: número máximo de parcelas (default: 50)
 *   - fetchDetails: se deve buscar detalhes de cada parcela (default: true)
 */
router.post("/sync-receivables", async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const fetchDetails = req.query.fetchDetails !== "false";

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const token = await getToken(conn);

    // Buscar parcelas OVERDUE
    const hoje = new Date().toISOString().split("T")[0];
    const umAnoAtras = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    console.log(`[Sync] Buscando parcelas OVERDUE de ${umAnoAtras} a ${hoje}, limit=${limit}`);

    const listData = await caFetch(
      `/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=${limit}&data_vencimento_de=${umAnoAtras}&data_vencimento_ate=${hoje}&status=OVERDUE`,
      token
    );

    console.log(`[Sync] Total parcelas OVERDUE: ${listData.itens_totais}`);
    console.log(`[Sync] Processando ${listData.itens.length} parcelas`);

    const stats = {
      total: listData.itens_totais,
      processed: 0,
      inserted: 0,
      updated: 0,
      clientsCreated: 0,
      withFaturaLink: 0,
      errors: 0,
      errorDetails: [] as string[],
    };

    for (const item of listData.itens) {
      try {
        // Upsert client
        const clientId = await upsertClient(
          conn,
          item.cliente.id,
          item.cliente.nome
        );

        // Buscar detalhes da parcela (URL da fatura)
        let faturaUrl: string | null = null;
        let paymentInfoPublic = false;
        let paymentInfoSource: string | null = null;

        if (fetchDetails) {
          try {
            const detail = await caFetch(
              `/v1/financeiro/eventos-financeiros/parcelas/${item.id}`,
              token
            );

            // Extrair URL da fatura das solicitações de cobrança
            if (detail.solicitacoes_cobrancas?.length > 0) {
              // Pegar a cobrança mais recente com URL
              const cobrancaComUrl = detail.solicitacoes_cobrancas.find(
                (sc: any) => sc.url
              );
              if (cobrancaComUrl) {
                faturaUrl = cobrancaComUrl.url;
                paymentInfoPublic = true;
                paymentInfoSource = "contaazul";
                stats.withFaturaLink++;
              }
            }
          } catch (detailErr: any) {
            console.log(
              `[Sync] Erro ao buscar detalhes de ${item.id}: ${detailErr.message}`
            );
          }
        }

        // Resolver link canônico de pagamento
        const paymentLinkCanonical = faturaUrl || null;

        // Upsert receivable
        const result = await upsertReceivable(conn, {
          contaAzulId: item.id,
          clientId,
          amount: item.nao_pago || item.total,
          dueDate: item.data_vencimento,
          status: item.status,
          description: item.descricao,
          link: faturaUrl,
          paymentLinkCanonical,
          paymentInfoPublic,
          paymentInfoSource,
        });

        stats.processed++;
        if (result.action === "inserted") stats.inserted++;
        else stats.updated++;
      } catch (itemErr: any) {
        stats.errors++;
        stats.errorDetails.push(
          `${item.id}: ${itemErr.message.substring(0, 100)}`
        );
        console.log(`[Sync] Erro processando ${item.id}: ${itemErr.message}`);
      }
    }

    console.log(`[Sync] Resultado: ${JSON.stringify(stats)}`);

    res.json({
      success: true,
      stats,
      totais: listData.totais,
    });
  } catch (err: any) {
    console.error("[Sync] Erro fatal:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    await conn.end();
  }
});

/**
 * GET /api/test/sync-receivables/status
 * 
 * Retorna estatísticas do banco local de receivables.
 */
router.get("/sync-receivables/status", async (_req: Request, res: Response) => {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const [total] = await conn.execute(
      "SELECT COUNT(*) as total FROM receivables WHERE source = 'conta-azul'"
    ) as any;
    const [byStatus] = await conn.execute(
      "SELECT status, COUNT(*) as count FROM receivables WHERE source = 'conta-azul' GROUP BY status"
    ) as any;
    const [withLink] = await conn.execute(
      "SELECT COUNT(*) as total FROM receivables WHERE source = 'conta-azul' AND link IS NOT NULL AND link != ''"
    ) as any;
    const [withPaymentInfo] = await conn.execute(
      "SELECT COUNT(*) as total FROM receivables WHERE source = 'conta-azul' AND paymentInfoPublic = true"
    ) as any;

    res.json({
      total: total[0].total,
      byStatus: byStatus.reduce((acc: any, row: any) => {
        acc[row.status] = row.count;
        return acc;
      }, {}),
      withLink: withLink[0].total,
      withPaymentInfo: withPaymentInfo[0].total,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.end();
  }
});

export default router;
