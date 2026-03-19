import { Router, Request, Response } from 'express';
import { getValidAccessToken } from './contaAzulOAuthManager';
import axios from 'axios';

const router = Router();

/**
 * GET /api/test/introspect/conta-azul
 * Faz introspecção de todos os endpoints para descobrir estrutura real
 */
router.get('/conta-azul', async (req: Request, res: Response) => {
  const correlationId = Math.random().toString(36).substring(7);
  const logs: any[] = [];

  try {
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Token not available',
        correlationId,
        logs,
      });
    }

    const baseUrl = 'https://api-v2.contaazul.com';
    const endpoints = [
      '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?data_vencimento_de=2025-01-01&data_vencimento_ate=2026-12-31&pagina=1&tamanho_pagina=50',
      '/v1/bank-billets?pagina=1&tamanho_pagina=50',
      '/v1/bank-billets/search?pagina=1&tamanho_pagina=50',
      '/v1/cobrancas?pagina=1&tamanho_pagina=50',
      '/v1/financeiro/receitas?pagina=1&tamanho_pagina=50',
      '/v1/financeiro/titulos?pagina=1&tamanho_pagina=50',
    ];

    const results: any[] = [];

    for (const endpoint of endpoints) {
      const url = baseUrl + endpoint;
      const log: any = {
        endpoint,
        url,
        status: null,
        contentType: null,
        keys: [],
        arrayKey: null,
        arrayLength: 0,
        firstItem: null,
        error: null,
      };

      try {
        const res = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
          validateStatus: () => true,
        });

        log.status = res.status;
        log.contentType = res.headers['content-type'];

        if (res.status === 200) {
          // Procurar estrutura
          log.keys = Object.keys(res.data);

          // Se é array direto
          if (Array.isArray(res.data)) {
            log.arrayKey = '__root__';
            log.arrayLength = res.data.length;
            if (res.data.length > 0) {
              log.firstItem = res.data[0];
            }
          } else {
            // Procurar por arrays dentro do objeto
            for (const key of Object.keys(res.data)) {
              if (Array.isArray(res.data[key])) {
                log.arrayKey = key;
                log.arrayLength = res.data[key].length;
                if (res.data[key].length > 0) {
                  log.firstItem = res.data[key][0];
                }
                break; // Pega o primeiro array encontrado
              }
            }
          }
        } else {
          log.error = `HTTP ${res.status}`;
          if (res.data?.error) log.error += `: ${res.data.error}`;
          if (res.data?.message) log.error += `: ${res.data.message}`;
        }
      } catch (err: any) {
        log.error = err.message;
      }

      results.push(log);
    }

    res.json({
      ok: true,
      correlationId,
      baseUrl,
      token: token.substring(0, 50) + '...',
      results,
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
 * GET /api/test/introspect/boleto-search
 * Busca específica por boleto com Nosso Número
 */
router.get('/boleto-search', async (req: Request, res: Response) => {
  const correlationId = Math.random().toString(36).substring(7);
  const nossoNumero = req.query.nosso_numero as string || '141571260467466';
  const valor = parseFloat(req.query.valor as string) || 255.60;
  const vencimento = req.query.vencimento as string || '2026-02-15';

  const logs: string[] = [];

  try {
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Token not available',
        correlationId,
        logs,
      });
    }

    const baseUrl = 'https://api-v2.contaazul.com';
    const attempts: any[] = [];
    let boleto: any = null;

    logs.push(`[${correlationId}] Buscando boleto: nosso_numero=${nossoNumero}, valor=${valor}, vencimento=${vencimento}`);

    // Tentar diferentes endpoints
    const endpoints = [
      {
        name: 'bank-billets',
        url: `${baseUrl}/v1/bank-billets?pagina=1&tamanho_pagina=200`,
      },
      {
        name: 'bank-billets-search',
        url: `${baseUrl}/v1/bank-billets/search?pagina=1&tamanho_pagina=200`,
      },
      {
        name: 'contas-a-receber',
        url: `${baseUrl}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?data_vencimento_de=2025-01-01&data_vencimento_ate=2026-12-31&pagina=1&tamanho_pagina=200`,
      },
    ];

    for (const ep of endpoints) {
      logs.push(`[${correlationId}] Tentando: ${ep.name}`);

      try {
        const res = await axios.get(ep.url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
          validateStatus: () => true,
        });

        attempts.push({
          name: ep.name,
          status: res.status,
          itemsFound: 0,
          matchFound: false,
        });

        if (res.status === 200) {
          // Encontrar array
          let items: any[] = [];
          if (Array.isArray(res.data)) {
            items = res.data;
          } else {
            for (const key of Object.keys(res.data)) {
              if (Array.isArray(res.data[key])) {
                items = res.data[key];
                break;
              }
            }
          }

          attempts[attempts.length - 1].itemsFound = items.length;
          logs.push(`[${correlationId}] ${ep.name}: ${items.length} itens encontrados`);

          // Procurar por match
          for (const item of items) {
            // Procurar por nosso_numero
            if (item.nosso_numero === nossoNumero || item.nosso_numero?.toString() === nossoNumero) {
              logs.push(`[${correlationId}] ✅ Match por nosso_numero!`);
              boleto = item;
              attempts[attempts.length - 1].matchFound = true;
              break;
            }

            // Procurar por valor + vencimento
            const itemValor = parseFloat(item.valor || item.amount || 0);
            const itemVencimento = item.data_vencimento?.split('T')[0] || item.due_date?.split('T')[0] || item.vencimento?.split('T')[0];
            if (Math.abs(itemValor - valor) < 0.01 && itemVencimento === vencimento) {
              logs.push(`[${correlationId}] ✅ Match por valor + vencimento!`);
              boleto = item;
              attempts[attempts.length - 1].matchFound = true;
              break;
            }
          }

          if (boleto) break;
        } else {
          logs.push(`[${correlationId}] ${ep.name}: HTTP ${res.status}`);
        }
      } catch (err: any) {
        logs.push(`[${correlationId}] ${ep.name}: Erro - ${err.message}`);
      }
    }

    res.json({
      ok: !!boleto,
      correlationId,
      searchParams: { nossoNumero, valor, vencimento },
      boleto,
      attempts,
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

export default router;
