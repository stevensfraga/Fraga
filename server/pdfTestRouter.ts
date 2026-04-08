import { Router, Request, Response } from 'express';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';
import axios from 'axios';
import crypto from 'crypto';

const router = Router();

function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * GET /api/test/contaazul/receivables/sample
 */
router.get('/receivables/sample', async (req: Request, res: Response) => {
  const correlationId = generateCorrelationId();
  const logs: string[] = [];

  try {
    const clientId = parseInt(req.query.clientId as string) || 30004;
    const limit = parseInt(req.query.limit as string) || 10;

    logs.push(`[${correlationId}] Buscando receivables para clientId=${clientId}, limit=${limit}`);

    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database not available',
        correlationId,
        logs,
      });
    }

    const results = await db
      .select()
      .from(receivables)
      .where(eq(receivables.clientId, clientId))
      .limit(limit);

    logs.push(`[${correlationId}] Encontrados ${results.length} receivables`);

    const candidates = results
      .filter(r => r.contaAzulId)
      .map(r => ({
        receivableIdLocal: r.id,
        contaAzulReceivableId: r.contaAzulId,
        documentNumber: r.documento,
        status: r.status,
        dueDate: r.dueDate,
        amount: r.amount,
        pdfStorageUrl: r.pdfStorageUrl,
      }));

    logs.push(`[${correlationId}] Retornando ${candidates.length} candidatos com contaAzulId`);

    res.json({
      ok: true,
      correlationId,
      totalReceivablesFetched: results.length,
      totalReturned: candidates.length,
      filtrosAplicados: ['clientId', 'contaAzulId NOT NULL'],
      candidates,
      logs,
    });
  } catch (error: any) {
    console.error(`[${correlationId}] Erro:`, error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      correlationId,
      logs,
    });
  }
});

/**
 * GET /api/test/contaazul/receivable/:receivableId/pdf/probe
 * Fluxo correto com paginacao e match determinístico
 */
router.get('/receivable/:receivableId/pdf/probe', async (req: Request, res: Response) => {
  const correlationId = generateCorrelationId();
  const logs: string[] = [];
  const startTime = Date.now();

  try {
    const receivableId = parseInt(req.params.receivableId);
    logs.push(`[${correlationId}] Iniciando probe com fluxo correto para receivableId=${receivableId}`);

    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database not available',
        correlationId,
        logs,
      });
    }

    // Resolver identidade no DB local
    logs.push(`[${correlationId}] A) Resolvendo identidade no DB local...`);
    const receivable = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (!receivable || receivable.length === 0) {
      logs.push(`[${correlationId}] Receivable nao encontrado`);
      return res.status(422).json({
        ok: false,
        error: 'RECEIVABLE_NOT_FOUND',
        correlationId,
        logs,
      });
    }

    const rec = receivable[0];
    const contaAzulReceivableId = rec.contaAzulId;
    const dueDate = rec.dueDate;
    const amount = rec.amount;

    if (!contaAzulReceivableId) {
      logs.push(`[${correlationId}] contaAzulReceivableId nao preenchido`);
      return res.status(422).json({
        ok: false,
        error: 'RECEIVABLE_NOT_LINKED',
        correlationId,
        logs,
      });
    }

    logs.push(`[${correlationId}] Identidade resolvida: contaAzulReceivableId=${contaAzulReceivableId}`);
    logs.push(`[${correlationId}] Dados: dueDate=${dueDate?.toISOString()}, amount=${amount}`);

    const token = await getValidAccessToken();
    const baseUrl = 'https://api-v2.contaazul.com';
    const attempts: any[] = [];
    let found: any = {};

    // PASSO A: Buscar eventos financeiros com paginacao e match determinístico
    logs.push(`[${correlationId}] PASSO A: Buscando eventos de contas a receber (intervalo amplo)...`);

    try {
      // Usar intervalo amplo: 2025-01-01 a 2026-12-31
      const dateFromStr = '2025-01-01';
      const dateToStr = '2026-12-31';

      logs.push(`[${correlationId}] Intervalo: ${dateFromStr} a ${dateToStr}`);

      let allEventos: any[] = [];
      let pagina = 1;
      const maxPaginas = 50;
      const tamanho_pagina = 200;

      // Paginacao automatica
      while (pagina <= maxPaginas) {
        const filterUrl = `${baseUrl}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?data_vencimento_de=${dateFromStr}&data_vencimento_ate=${dateToStr}&pagina=${pagina}&tamanho_pagina=${tamanho_pagina}`;

        logs.push(`[${correlationId}] GET pagina ${pagina} (${tamanho_pagina} itens)`);

        const filterRes = await axios.get(filterUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
          validateStatus: () => true,
        });

        attempts.push({
          name: `buscar_contas_a_receber_pagina_${pagina}`,
          url: filterUrl,
          httpStatus: filterRes.status,
          contentType: filterRes.headers['content-type'] || '',
          itemsReturned: filterRes.data?.dados?.length || 0,
        });

        logs.push(`[${correlationId}] Status: ${filterRes.status}`);

        if (filterRes.status === 200 && filterRes.data && filterRes.data.dados) {
          const qtd = filterRes.data.dados.length;
          logs.push(`[${correlationId}] Pagina ${pagina}: ${qtd} eventos recebidos`);

          if (qtd === 0) {
            logs.push(`[${correlationId}] Fim da paginacao (pagina vazia)`);
            break;
          }

          allEventos = allEventos.concat(filterRes.data.dados);
          logs.push(`[${correlationId}] Total acumulado: ${allEventos.length} eventos`);

          pagina++;
        } else {
          logs.push(`[${correlationId}] Erro na pagina ${pagina} (status=${filterRes.status})`);
          break;
        }
      }

      logs.push(`[${correlationId}] Total de eventos encontrados: ${allEventos.length}`);

      if (allEventos.length > 0) {
        // Match determinístico: valor + vencimento + cliente
        logs.push(`[${correlationId}] Buscando match para: valor=${amount}, vencimento=${dueDate?.toISOString().split('T')[0]}`);

        const candidates: any[] = [];

        for (const evento of allEventos) {
          let score = 0;
          const details: string[] = [];

          // Comparar valor (tolerancia de 0.01)
          if (evento.valor && amount && Math.abs(Number(evento.valor) - Number(amount)) < 0.01) {
            score += 3;
            details.push('valor_match');
          }

          // Comparar vencimento
          if (evento.data_vencimento) {
            const eventoDate = evento.data_vencimento.split('T')[0];
            const dueDateStr = dueDate?.toISOString().split('T')[0];
            if (eventoDate === dueDateStr) {
              score += 3;
              details.push('vencimento_match');
            }
          }

          // Comparar cliente/descricao
          if (evento.cliente_nome || evento.descricao || evento.nome) {
            const clientName = (evento.cliente_nome || evento.descricao || evento.nome || '').toLowerCase();
            if (clientName.includes('r7') || clientName.includes('thiago') || clientName.includes('geradores')) {
              score += 1;
              details.push('cliente_match');
            }
          }

          if (score > 0) {
            candidates.push({
              evento,
              score,
              details,
              id: evento.id || evento.id_evento,
            });
          }
        }

        // Ordenar por score
        candidates.sort((a, b) => b.score - a.score);

        logs.push(`[${correlationId}] Encontrados ${candidates.length} candidatos`);

        if (candidates.length > 0) {
          const top5 = candidates.slice(0, 5);
          logs.push(`[${correlationId}] Top 5 candidatos:`);
          for (let i = 0; i < top5.length; i++) {
            logs.push(`[${correlationId}]   ${i + 1}. ID=${top5[i].id}, score=${top5[i].score}, details=${top5[i].details.join(',')}`);
          }

          // Usar o primeiro (maior score)
          found.idEvento = candidates[0].id;
          found.matchScore = candidates[0].score;
          found.matchDetails = candidates[0].details;
          logs.push(`[${correlationId}] Selecionado: id_evento=${found.idEvento} (score=${found.matchScore})`);
        }
      } else {
        logs.push(`[${correlationId}] Nenhum evento encontrado no intervalo`);
      }
    } catch (err: any) {
      logs.push(`[${correlationId}] Erro ao buscar eventos: ${err.message}`);
    }

    // PASSO B: Listar parcelas do evento (se encontrou)
    if (found.idEvento) {
      logs.push(`[${correlationId}] PASSO B: Listando parcelas do evento ${found.idEvento}...`);

      try {
        const parcelasUrl = `${baseUrl}/v1/financeiro/eventos-financeiros/${found.idEvento}/parcelas`;
        logs.push(`[${correlationId}] GET ${parcelasUrl}`);

        const parcelasRes = await axios.get(parcelasUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
          validateStatus: () => true,
        });

        attempts.push({
          name: 'listar_parcelas_evento',
          url: parcelasUrl,
          httpStatus: parcelasRes.status,
          contentType: parcelasRes.headers['content-type'] || '',
        });

        logs.push(`[${correlationId}] Status: ${parcelasRes.status}`);

        if (parcelasRes.status === 200 && parcelasRes.data && parcelasRes.data.dados && parcelasRes.data.dados.length > 0) {
          logs.push(`[${correlationId}] Encontradas ${parcelasRes.data.dados.length} parcelas`);

          const parcela = parcelasRes.data.dados[0];
          logs.push(`[${correlationId}] Parcela encontrada. Keys: ${Object.keys(parcela).slice(0, 10).join(', ')}`);

          if (parcela.id) {
            found.parcelaId = parcela.id;
            logs.push(`[${correlationId}] Encontrado parcela.id: ${found.parcelaId}`);
          }
        } else {
          logs.push(`[${correlationId}] Nenhuma parcela encontrada (status=${parcelasRes.status})`);
        }
      } catch (err: any) {
        logs.push(`[${correlationId}] Erro ao listar parcelas: ${err.message}`);
      }
    }

    // PASSO C: Metadata da parcela
    if (found.parcelaId) {
      logs.push(`[${correlationId}] PASSO C: Obtendo metadata da parcela ${found.parcelaId}...`);

      try {
        const parcelaUrl = `${baseUrl}/v1/financeiro/parcelas/${found.parcelaId}`;
        logs.push(`[${correlationId}] GET ${parcelaUrl}`);

        const parcelaRes = await axios.get(parcelaUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
          validateStatus: () => true,
        });

        attempts.push({
          name: 'metadata_parcela',
          url: parcelaUrl,
          httpStatus: parcelaRes.status,
          contentType: parcelaRes.headers['content-type'] || '',
        });

        logs.push(`[${correlationId}] Status: ${parcelaRes.status}`);

        if (parcelaRes.status === 200 && parcelaRes.data) {
          const data = parcelaRes.data;
          logs.push(`[${correlationId}] Metadata obtido. Keys: ${Object.keys(data).slice(0, 15).join(', ')}`);

          // Procurar campos de boleto/PDF
          if (data.url_boleto) {
            found.urlBoleto = data.url_boleto;
            logs.push(`[${correlationId}] Encontrado url_boleto`);
          }
          if (data.link_boleto) {
            found.linkBoleto = data.link_boleto;
            logs.push(`[${correlationId}] Encontrado link_boleto`);
          }
          if (data.url_pdf) {
            found.urlPdf = data.url_pdf;
            logs.push(`[${correlationId}] Encontrado url_pdf`);
          }
          if (data.id_boleto) {
            found.idBoleto = data.id_boleto;
            logs.push(`[${correlationId}] Encontrado id_boleto: ${found.idBoleto}`);
          }
        } else {
          logs.push(`[${correlationId}] Metadata nao disponivel (status=${parcelaRes.status})`);
        }
      } catch (err: any) {
        logs.push(`[${correlationId}] Erro ao obter metadata: ${err.message}`);
      }
    }

    const totalTime = Date.now() - startTime;
    logs.push(`[${correlationId}] Probe concluido em ${totalTime}ms`);

    res.json({
      ok: found.idEvento ? true : false,
      source: 'CONTA_AZUL_V2',
      contaAzulReceivableId,
      found,
      attempts,
      correlationId,
      totalTimeMs: totalTime,
      logs,
    });
  } catch (error: any) {
    console.error(`[${correlationId}] Erro:`, error.message);
    const totalTime = Date.now() - startTime;

    res.status(500).json({
      ok: false,
      error: error.message,
      correlationId,
      totalTimeMs: totalTime,
      logs,
    });
  }
});

export default router;
