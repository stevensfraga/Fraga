/**
 * Adapter para endpoints descobertos no painel Conta Azul
 * Endpoints: services.contaazul.com/finance-pro-reader e /finance-pro
 * 
 * Descoberta realizada em 2026-02-22:
 * - Financial Event Summary: /contaazul-bff/finance/v1/financial-events/{id}/summary
 * - Charge Request Details: /finance-pro/v1/charge-requests/{id}
 * - Installment View: /finance-pro-reader/v1/installment-view
 * 
 * Usa helper contaAzulRequest() para gerenciamento robusto de token e retry
 */

import { contaAzulGet } from './contaAzulRequest';

interface FinancialEventSummary {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  status: string;
  customer_id?: string;
  customer_name?: string;
  boleto_url?: string;
  boleto_pdf_url?: string;
  pix_copy_paste?: string;
  nossa_numero?: string;
  linha_digitavel?: string;
  [key: string]: any;
}

interface ChargeRequestDetails {
  id: string;
  financial_event_id: string;
  boleto_url?: string;
  pdf_url?: string;
  pix?: string;
  nossa_numero?: string;
  linha_digitavel?: string;
  status: string;
  [key: string]: any;
}

interface InstallmentViewItem {
  id: string;
  financial_event_id: string;
  charge_request_id?: string;
  description: string;
  amount: number;
  due_date: string;
  status: string;
  customer?: string;
  [key: string]: any;
}

/**
 * Obter resumo do evento financeiro
 * Endpoint: /contaazul-bff/finance/v1/financial-events/{id}/summary
 */
export async function getFinancialEventSummary(
  financialEventId: string,
  correlationId?: string
): Promise<FinancialEventSummary | null> {
  try {
    const result = await contaAzulGet<FinancialEventSummary>(
      `/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`,
      undefined,
      correlationId
    );

    if (!result.ok) {
      console.error(`[PanelAdapter] Erro ao obter Financial Event Summary:`, result.error);
      return null;
    }

    console.log(`[PanelAdapter] Financial Event Summary obtido: ${financialEventId}`);
    console.log('[PanelAdapter] Response keys:', Object.keys(result.data || {}));

    return result.data || null;
  } catch (error: any) {
    console.error(`[PanelAdapter] Erro ao obter Financial Event Summary:`, error.message);
    return null;
  }
}

/**
 * Obter detalhes da solicitação de cobrança
 * Endpoint: /finance-pro/v1/charge-requests/{id}
 */
export async function getChargeRequestDetails(
  chargeRequestId: string,
  correlationId?: string
): Promise<ChargeRequestDetails | null> {
  try {
    const result = await contaAzulGet<ChargeRequestDetails>(
      `/finance-pro/v1/charge-requests/${chargeRequestId}`,
      undefined,
      correlationId
    );

    if (!result.ok) {
      console.error(`[PanelAdapter] Erro ao obter Charge Request Details:`, result.error);
      return null;
    }

    console.log(`[PanelAdapter] Charge Request Details obtido: ${chargeRequestId}`);
    console.log('[PanelAdapter] Response keys:', Object.keys(result.data || {}));

    return result.data || null;
  } catch (error: any) {
    console.error(`[PanelAdapter] Erro ao obter Charge Request Details:`, error.message);
    return null;
  }
}

/**
 * Listar parcelas/boletos
 * Endpoint: /finance-pro-reader/v1/installment-view
 */
export async function listInstallments(
  page: number = 1,
  pageSize: number = 10,
  correlationId?: string
): Promise<InstallmentViewItem[]> {
  try {
    const result = await contaAzulGet(
      `/finance-pro-reader/v1/installment-view`,
      { page, page_size: pageSize },
      correlationId
    );

    if (!result.ok) {
      console.error(`[PanelAdapter] Erro ao listar installments:`, result.error);
      return [];
    }

    console.log(`[PanelAdapter] Installments listados: página ${page}, tamanho ${pageSize}`);

    // Extrair array de itens (pode estar em diferentes chaves)
    const data = result.data;
    let items: InstallmentViewItem[] = [];

    if (Array.isArray(data)) {
      items = data;
    } else if (data?.data && Array.isArray(data.data)) {
      items = data.data;
    } else if (data?.items && Array.isArray(data.items)) {
      items = data.items;
    } else if (data?.installments && Array.isArray(data.installments)) {
      items = data.installments;
    }

    console.log(`[PanelAdapter] Total de itens retornados: ${items.length}`);

    return items;
  } catch (error: any) {
    console.error(`[PanelAdapter] Erro ao listar installments:`, error.message);
    return [];
  }
}

/**
 * Buscar boleto por nosso_numero
 */
export async function findBoletoByNossoNumero(
  nossoNumero: string,
  correlationId?: string
): Promise<FinancialEventSummary | null> {
  try {
    // Listar todas as parcelas
    const installments = await listInstallments(1, 100, correlationId);

    if (installments.length === 0) {
      console.log(`[PanelAdapter] Nenhuma parcela encontrada`);
      return null;
    }

    // Procurar por nosso_numero em cada parcela
    for (const installment of installments) {
      try {
        // Tentar obter detalhes do evento financeiro
        if (installment.financial_event_id) {
          const summary = await getFinancialEventSummary(installment.financial_event_id, correlationId);

          if (summary && summary.nossa_numero === nossoNumero) {
            console.log(`[PanelAdapter] Boleto encontrado: ${nossoNumero}`);
            return summary;
          }
        }
      } catch (error) {
        console.warn(`[PanelAdapter] Erro ao processar installment ${installment.id}:`, error);
        continue;
      }
    }

    console.log(`[PanelAdapter] Boleto não encontrado: ${nossoNumero}`);
    return null;
  } catch (error: any) {
    console.error(`[PanelAdapter] Erro ao buscar boleto:`, error.message);
    return null;
  }
}

/**
 * Buscar boleto por Venda/Descrição
 */
export async function findBoletoByVenda(
  vendaNumber: string,
  correlationId?: string
): Promise<FinancialEventSummary | null> {
  try {
    // Listar todas as parcelas
    const installments = await listInstallments(1, 100, correlationId);

    if (installments.length === 0) {
      console.log(`[PanelAdapter] Nenhuma parcela encontrada`);
      return null;
    }

    // Procurar por venda em cada parcela
    for (const installment of installments) {
      try {
        if (installment.description && installment.description.includes(`Venda ${vendaNumber}`)) {
          // Tentar obter detalhes do evento financeiro
          if (installment.financial_event_id) {
            const summary = await getFinancialEventSummary(installment.financial_event_id, correlationId);
            if (summary) {
              console.log(`[PanelAdapter] Boleto encontrado para Venda ${vendaNumber}`);
              return summary;
            }
          }
        }
      } catch (error) {
        console.warn(`[PanelAdapter] Erro ao processar installment ${installment.id}:`, error);
        continue;
      }
    }

    console.log(`[PanelAdapter] Boleto não encontrado para Venda ${vendaNumber}`);
    return null;
  } catch (error: any) {
    console.error(`[PanelAdapter] Erro ao buscar boleto por venda:`, error.message);
    return null;
  }
}

/**
 * Extrair URL de PDF do boleto
 */
export function extractPdfUrl(summary: FinancialEventSummary): string | null {
  // Tentar diferentes campos que podem conter a URL do PDF
  const candidates = [
    summary.boleto_pdf_url,
    summary.pdf_url,
    summary.boleto_url,
    summary.url_pdf,
    summary.url_boleto,
  ];

  for (const url of candidates) {
    if (url && typeof url === 'string' && url.startsWith('http')) {
      console.log(`[PanelAdapter] URL de PDF encontrada: ${url.substring(0, 50)}...`);
      return url;
    }
  }

  console.log('[PanelAdapter] Nenhuma URL de PDF encontrada');
  return null;
}

/**
 * Extrair PIX do boleto
 */
export function extractPix(summary: FinancialEventSummary): string | null {
  const candidates = [
    summary.pix_copy_paste,
    summary.pix,
    summary.pix_qr_code,
  ];

  for (const pix of candidates) {
    if (pix && typeof pix === 'string' && pix.length > 0) {
      console.log(`[PanelAdapter] PIX encontrado`);
      return pix;
    }
  }

  console.log('[PanelAdapter] Nenhum PIX encontrado');
  return null;
}

/**
 * Extrair linha digitável do boleto
 */
export function extractLinhaDigitavel(summary: FinancialEventSummary): string | null {
  const candidates = [
    summary.linha_digitavel,
    summary.linhaDigitavel,
    summary.line_number,
  ];

  for (const linha of candidates) {
    if (linha && typeof linha === 'string' && linha.length > 0) {
      console.log(`[PanelAdapter] Linha digitável encontrada`);
      return linha;
    }
  }

  console.log('[PanelAdapter] Nenhuma linha digitável encontrada');
  return null;
}
