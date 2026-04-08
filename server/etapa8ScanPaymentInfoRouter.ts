/**
 * ETAPA 8 — PASSO 8.1: PROBE DE "PAGAMENTO DISPONÍVEL" POR RECEIVABLE
 * 
 * Endpoint: GET /api/test/etapa8/scan-payment-info?limit=200&from=2025-01-01&to=2026-12-31
 * 
 * Escaneia quais receivables reais têm dados de pagamento (PIX/linha/PDF)
 */

import express from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = express.Router();

const API_V2_BASE = 'https://api-v2.contaazul.com';

interface PaymentInfo {
  receivableId: number;
  contaAzulId: string;
  dueDate: Date | null;
  amount: string;
  evidenceKeys: string[];
  paymentFields: Record<string, any>;
}

/**
 * GET /api/test/etapa8/scan-payment-info
 * 
 * Escaneia receivables para identificar quais têm dados de pagamento
 */
router.get('/scan-payment-info', async (req, res) => {
  try {
    const { limit = 200, from = '2025-01-01', to = '2026-12-31' } = req.query;

    console.log('[ScanPaymentInfo] Iniciando scan...');
    console.log('[ScanPaymentInfo] Limite:', limit, 'Período:', from, 'a', to);

    // 1) Obter DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database connection failed'
      });
    }

    // 2) Buscar receivables reais do DB
    const items = await db
      .select()
      .from(receivables)
      .limit(Number(limit));

    const realItems = items.filter(r => r.contaAzulId && !r.contaAzulId.startsWith('mock-'));

    console.log('[ScanPaymentInfo] Total no DB:', items.length, 'Reais:', realItems.length);

    // 3) Obter token
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err: any) {
      console.error('[ScanPaymentInfo] Erro ao obter token:', err.message);
      return res.status(401).json({
        ok: false,
        error: 'Falha ao obter token',
        details: err.message
      });
    }

    // 4) Escanear cada receivable
    const withPaymentInfo: PaymentInfo[] = [];
    const withoutPaymentInfo: PaymentInfo[] = [];

    for (const item of realItems) {
      try {
        console.log('[ScanPaymentInfo] Escaneando:', item.contaAzulId);

        // Tentar buscar evento financeiro
        const eventUrl = `${API_V2_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/${item.contaAzulId}`;

        try {
          const eventResponse = await axios.get(eventUrl, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
            timeout: 5000,
          });

          const eventData = eventResponse.data;
          const evidenceKeys: string[] = [];
          const paymentFields: Record<string, any> = {};

          // Verificar campos de pagamento
          if (eventData.linha_digitavel) {
            evidenceKeys.push('linha_digitavel');
            paymentFields.linha_digitavel = eventData.linha_digitavel;
          }
          if (eventData.pix) {
            evidenceKeys.push('pix');
            paymentFields.pix = eventData.pix;
          }
          if (eventData.url_boleto || eventData.boleto_url || eventData.pdf_url) {
            evidenceKeys.push('url_boleto');
            paymentFields.url_boleto = eventData.url_boleto || eventData.boleto_url || eventData.pdf_url;
          }
          if (eventData.nosso_numero) {
            evidenceKeys.push('nosso_numero');
            paymentFields.nosso_numero = eventData.nosso_numero;
          }
          if (eventData.status === 'registrado' || eventData.status === 'REGISTRADO') {
            evidenceKeys.push('status_registrado');
            paymentFields.status = eventData.status;
          }

          // Se tem algum campo de pagamento, adicionar à lista
          if (evidenceKeys.length > 0) {
            withPaymentInfo.push({
              receivableId: item.id,
              contaAzulId: item.contaAzulId,
              dueDate: item.dueDate,
              amount: item.amount,
              evidenceKeys,
              paymentFields
            });
            console.log('[ScanPaymentInfo] ✅ Com pagamento:', item.contaAzulId, 'evidência:', evidenceKeys.join(','));
          } else {
            withoutPaymentInfo.push({
              receivableId: item.id,
              contaAzulId: item.contaAzulId,
              dueDate: item.dueDate,
              amount: item.amount,
              evidenceKeys: [],
              paymentFields: {}
            });
            console.log('[ScanPaymentInfo] ❌ Sem pagamento:', item.contaAzulId);
          }
        } catch (eventErr: any) {
          const status = eventErr.response?.status;
          
          if (status === 404) {
            // Evento não encontrado
            withoutPaymentInfo.push({
              receivableId: item.id,
              contaAzulId: item.contaAzulId,
              dueDate: item.dueDate,
              amount: item.amount,
              evidenceKeys: [],
              paymentFields: {}
            });
            console.log('[ScanPaymentInfo] ❌ Evento não encontrado:', item.contaAzulId);
          } else {
            // Erro na API
            console.error('[ScanPaymentInfo] Erro ao buscar evento:', item.contaAzulId, status);
            withoutPaymentInfo.push({
              receivableId: item.id,
              contaAzulId: item.contaAzulId,
              dueDate: item.dueDate,
              amount: item.amount,
              evidenceKeys: [],
              paymentFields: {}
            });
          }
        }
      } catch (err: any) {
        console.error('[ScanPaymentInfo] Erro geral ao escanear:', err.message);
      }
    }

    console.log('[ScanPaymentInfo] ✅ Scan completo');
    console.log('[ScanPaymentInfo] Com pagamento:', withPaymentInfo.length);
    console.log('[ScanPaymentInfo] Sem pagamento:', withoutPaymentInfo.length);

    return res.json({
      ok: true,
      totalChecked: realItems.length,
      withPaymentInfo: withPaymentInfo.length,
      withoutPaymentInfo: withoutPaymentInfo.length,
      samples: {
        with: withPaymentInfo.slice(0, 3),
        without: withoutPaymentInfo.slice(0, 3),
      },
      nextAction: withPaymentInfo.length > 0 ? 'DOWNLOAD_FIRST_AVAILABLE' : 'NO_PAYMENT_INFO_FOUND',
      message: withPaymentInfo.length > 0 
        ? `${withPaymentInfo.length} receivables com dados de pagamento encontrados` 
        : 'Nenhum receivable com dados de pagamento encontrado'
    });
  } catch (error: any) {
    console.error('[ScanPaymentInfo] Erro:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
