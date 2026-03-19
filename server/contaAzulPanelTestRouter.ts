/**
 * Router de teste para endpoints descobertos do painel Conta Azul
 * Testa os endpoints: financial-events, charge-requests, installment-view
 */

import express from 'express';
import {
  getFinancialEventSummary,
  getChargeRequestDetails,
  listInstallments,
  findBoletoByNossoNumero,
  findBoletoByVenda,
  extractPdfUrl,
  extractPix,
  extractLinhaDigitavel,
} from './contaAzulPanelAdapter';

const router = express.Router();

/**
 * GET /api/test/panel/financial-event/:id
 * Teste: Obter resumo do evento financeiro
 */
router.get('/api/test/panel/financial-event/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[PanelTestRouter] Testando Financial Event: ${id}`);
    
    const summary = await getFinancialEventSummary(id);
    
    if (!summary) {
      return res.status(404).json({
        ok: false,
        error: 'Financial Event não encontrado',
        id,
      });
    }
    
    res.json({
      ok: true,
      source: 'financial-event-summary',
      id,
      summary: {
        description: summary.description,
        amount: summary.amount,
        due_date: summary.due_date,
        status: summary.status,
        nossa_numero: summary.nossa_numero,
        boleto_url: summary.boleto_url,
        boleto_pdf_url: summary.boleto_pdf_url,
        pix_copy_paste: summary.pix_copy_paste,
        linha_digitavel: summary.linha_digitavel,
      },
      fullResponse: summary,
    });
  } catch (error: any) {
    console.error('[PanelTestRouter] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

/**
 * GET /api/test/panel/charge-request/:id
 * Teste: Obter detalhes da solicitação de cobrança
 */
router.get('/api/test/panel/charge-request/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[PanelTestRouter] Testando Charge Request: ${id}`);
    
    const details = await getChargeRequestDetails(id);
    
    res.json({
      ok: true,
      source: 'charge-request-details',
      id,
      details: details ? {
        financial_event_id: details.financial_event_id,
        boleto_url: details.boleto_url,
        pdf_url: details.pdf_url,
        pix: details.pix,
        nossa_numero: details.nossa_numero,
        status: details.status,
      } : null,
      fullResponse: details,
    });
  } catch (error: any) {
    console.error('[PanelTestRouter] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

/**
 * GET /api/test/panel/installments
 * Teste: Listar parcelas
 */
router.get('/api/test/panel/installments', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    
    console.log(`[PanelTestRouter] Listando installments: página ${page}, tamanho ${pageSize}`);
    
    const installments = await listInstallments(page, pageSize);
    
    res.json({
      ok: true,
      source: 'installment-view',
      page,
      pageSize,
      count: installments.length,
      installments: installments.map(i => ({
        id: i.id,
        financial_event_id: i.financial_event_id,
        charge_request_id: i.charge_request_id,
        description: i.description,
        amount: i.amount,
        due_date: i.due_date,
        status: i.status,
      })),
    });
  } catch (error: any) {
    console.error('[PanelTestRouter] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

/**
 * GET /api/test/panel/boleto/nosso-numero/:nossoNumero
 * Teste: Buscar boleto por nosso_numero
 */
router.get('/api/test/panel/boleto/nosso-numero/:nossoNumero', async (req, res) => {
  try {
    const { nossoNumero } = req.params;
    console.log(`[PanelTestRouter] Buscando boleto: ${nossoNumero}`);
    
    const boleto = await findBoletoByNossoNumero(nossoNumero);
    
    if (!boleto) {
      return res.status(404).json({
        ok: false,
        error: 'Boleto não encontrado',
        nossoNumero,
      });
    }
    
    const pdfUrl = extractPdfUrl(boleto);
    const pix = extractPix(boleto);
    const linhaDigitavel = extractLinhaDigitavel(boleto);
    
    res.json({
      ok: true,
      source: 'financial-event-summary',
      nossoNumero,
      boleto: {
        description: boleto.description,
        amount: boleto.amount,
        due_date: boleto.due_date,
        status: boleto.status,
        nossa_numero: boleto.nossa_numero,
        pdfUrl,
        pix,
        linhaDigitavel,
      },
    });
  } catch (error: any) {
    console.error('[PanelTestRouter] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

/**
 * GET /api/test/panel/boleto/venda/:vendaNumber
 * Teste: Buscar boleto por Venda
 */
router.get('/api/test/panel/boleto/venda/:vendaNumber', async (req, res) => {
  try {
    const { vendaNumber } = req.params;
    console.log(`[PanelTestRouter] Buscando boleto para Venda: ${vendaNumber}`);
    
    const boleto = await findBoletoByVenda(vendaNumber);
    
    if (!boleto) {
      return res.status(404).json({
        ok: false,
        error: 'Boleto não encontrado',
        venda: vendaNumber,
      });
    }
    
    const pdfUrl = extractPdfUrl(boleto);
    const pix = extractPix(boleto);
    const linhaDigitavel = extractLinhaDigitavel(boleto);
    
    res.json({
      ok: true,
      source: 'financial-event-summary',
      venda: vendaNumber,
      boleto: {
        description: boleto.description,
        amount: boleto.amount,
        due_date: boleto.due_date,
        status: boleto.status,
        nossa_numero: boleto.nossa_numero,
        pdfUrl,
        pix,
        linhaDigitavel,
      },
    });
  } catch (error: any) {
    console.error('[PanelTestRouter] Erro:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

export default router;
