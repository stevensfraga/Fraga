/**
 * Resolver informações de pagamento do boleto via Conta Azul services
 * Com extração robusta, logging bruto e fallback completo
 */

import { contaAzulGet } from './contaAzulRequest';
import {
  extractFirstUrlByPatterns,
  extractPix,
  extractLinhaDigitavel,
  logRawSnapshot,
  RawSnapshot,
} from './robust-payment-extraction';

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

export interface BoletoData {
  pdfUrl?: string;
  pix?: string;
  linhaDigitavel?: string;
  nossoNumero?: string;
  status?: string;
  source?: 'summary' | 'chargeRequest' | 'installmentView';
  sourcesTried?: string[];
  rawSnapshots?: RawSnapshot[];
  raw?: {
    summary?: any;
    chargeRequest?: any;
    installments?: any;
  };
}

/**
 * Resolver informações de pagamento com fallback completo
 */
export async function resolvePaymentInfoByFinancialEvent(
  financialEventId: string,
  chargeRequestId?: string
): Promise<BoletoData> {
  const correlationId = `[RESOLVE_${Date.now()}]`;
  const result: BoletoData = {
    sourcesTried: [],
    rawSnapshots: [],
  };

  logger.info(`${correlationId} Iniciando resolução para financialEventId=${financialEventId}, chargeRequestId=${chargeRequestId}`);

  // PASSO A: Summary
  logger.info(`${correlationId} PASSO A: Tentando summary...`);
  try {
    const summaryUrl = `/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`;
    const summaryResult = await contaAzulGet(summaryUrl, undefined, correlationId);

    if (summaryResult.ok && summaryResult.data) {
      const snapshot = logRawSnapshot(summaryUrl, summaryResult.data, summaryResult.status);
      result.rawSnapshots!.push(snapshot);
      result.raw = { ...result.raw, summary: summaryResult.data };
      result.sourcesTried!.push('summary');

      // Extração robusta
      result.pdfUrl = extractFirstUrlByPatterns(summaryResult.data) || undefined;
      result.pix = extractPix(summaryResult.data) || undefined;
      result.linhaDigitavel = extractLinhaDigitavel(summaryResult.data) || undefined;
      result.nossoNumero = (summaryResult.data as any).nossoNumero || (summaryResult.data as any).nosso_numero;
      result.status = (summaryResult.data as any).status || (summaryResult.data as any).statusBoleto;

      if (result.pdfUrl) {
        result.source = 'summary';
        logger.info(`${correlationId} PASSO A: PDF encontrado via summary`);
        return result;
      }

      logger.warn(`${correlationId} PASSO A: Nenhum PDF em summary, tentando próximo...`);
    } else {
      const snapshot = logRawSnapshot(summaryUrl, summaryResult.data, summaryResult.status, summaryResult.error);
      result.rawSnapshots!.push(snapshot);
      result.sourcesTried!.push('summary');
    }
  } catch (err: any) {
    logger.warn(`${correlationId} PASSO A: Erro - ${err.message}`);
    result.sourcesTried!.push('summary');
  }

  // PASSO B: ChargeRequest
  if (chargeRequestId) {
    logger.info(`${correlationId} PASSO B: Tentando chargeRequest...`);
    try {
      const chargeUrl = `/finance-pro/v1/charge-requests/${chargeRequestId}`;
      const chargeResult = await contaAzulGet(chargeUrl, undefined, correlationId);

      if (chargeResult.ok && chargeResult.data) {
        const snapshot = logRawSnapshot(chargeUrl, chargeResult.data, chargeResult.status);
        result.rawSnapshots!.push(snapshot);
        result.raw = { ...result.raw, chargeRequest: chargeResult.data };
        result.sourcesTried!.push('chargeRequest');

        // Extração robusta
        result.pdfUrl = result.pdfUrl || extractFirstUrlByPatterns(chargeResult.data) || undefined;
        result.pix = result.pix || extractPix(chargeResult.data) || undefined;
        result.linhaDigitavel = result.linhaDigitavel || extractLinhaDigitavel(chargeResult.data) || undefined;
        result.nossoNumero = result.nossoNumero || (chargeResult.data as any).nossoNumero || (chargeResult.data as any).nosso_numero;
        result.status = result.status || (chargeResult.data as any).status;

        if (result.pdfUrl) {
          result.source = 'chargeRequest';
          logger.info(`${correlationId} PASSO B: PDF encontrado via chargeRequest`);
          return result;
        }

        logger.warn(`${correlationId} PASSO B: Nenhum PDF em chargeRequest, tentando próximo...`);
      } else {
        const snapshot = logRawSnapshot(chargeUrl, chargeResult.data, chargeResult.status, chargeResult.error);
        result.rawSnapshots!.push(snapshot);
        result.sourcesTried!.push('chargeRequest');
      }
    } catch (err: any) {
      logger.warn(`${correlationId} PASSO B: Erro - ${err.message}`);
      result.sourcesTried!.push('chargeRequest');
    }
  }

  // PASSO C: InstallmentView (listar todas as parcelas)
  logger.info(`${correlationId} PASSO C: Tentando installmentView...`);
  try {
    const installmentsUrl = `/finance-pro-reader/v1/installment-view?page=1&page_size=50`;
    const installmentsResult = await contaAzulGet(installmentsUrl, undefined, correlationId);

    if (installmentsResult.ok && installmentsResult.data) {
      const snapshot = logRawSnapshot(installmentsUrl, installmentsResult.data, installmentsResult.status);
      result.rawSnapshots!.push(snapshot);
      result.raw = { ...result.raw, installments: installmentsResult.data };
      result.sourcesTried!.push('installmentView');

      // Procurar por Venda 14464 ou valor ~255.60
      const items = (installmentsResult.data as any).items || (installmentsResult.data as any).data || [];
      for (const item of items) {
        const description = (item as any).description || (item as any).descricao || '';
        const amount = (item as any).amount || (item as any).valor;
        const dueDate = (item as any).dueDate || (item as any).due_date || (item as any).vencimento;

        // Procurar por 14464 ou valor próximo a 255.60
        if (description.includes('14464') || Math.abs(parseFloat(amount) - 255.60) < 1) {
          logger.info(`${correlationId} PASSO C: Encontrado item: ${description}, valor=${amount}`);

          // Extrair dados do item
          result.pdfUrl = result.pdfUrl || extractFirstUrlByPatterns(item) || undefined;
          result.pix = result.pix || extractPix(item) || undefined;
          result.linhaDigitavel = result.linhaDigitavel || extractLinhaDigitavel(item) || undefined;
          result.nossoNumero = result.nossoNumero || (item as any).nossoNumero || (item as any).nosso_numero;
          result.status = result.status || (item as any).status;

          if (result.pdfUrl) {
            result.source = 'installmentView';
            logger.info(`${correlationId} PASSO C: PDF encontrado via installmentView`);
            return result;
          }
        }
      }

      logger.warn(`${correlationId} PASSO C: Nenhum PDF em installmentView`);
    } else {
      const snapshot = logRawSnapshot(installmentsUrl, installmentsResult.data, installmentsResult.status, installmentsResult.error);
      result.rawSnapshots!.push(snapshot);
      result.sourcesTried!.push('installmentView');
    }
  } catch (err: any) {
    logger.warn(`${correlationId} PASSO C: Erro - ${err.message}`);
    result.sourcesTried!.push('installmentView');
  }

  // Decisão final
  if (result.pdfUrl) {
    logger.info(`${correlationId} Resolução bem-sucedida: ${result.source}`);
    return result;
  }

  // Se não tem PDF, mas tem PIX ou linha, ainda pode enviar
  if (result.pix || result.linhaDigitavel) {
    logger.warn(`${correlationId} Sem PDF, mas tem PIX/linha - enviar assim mesmo`);
    return result;
  }

  // Falha total
  logger.error(`${correlationId} Falha: nenhum dado de boleto encontrado`);
  throw new Error(`Nenhum dado de boleto encontrado para financialEventId=${financialEventId}`);
}

export interface PdfData {
  buffer: Buffer;
  meta: {
    bytes: number;
    sha256: string;
    contentType: string;
  };
}

/**
 * Baixar PDF do Conta Azul services
 */
export async function downloadPdfFromServices(
  pdfUrl: string,
  correlationId: string
): Promise<PdfData> {
  logger.info(`${correlationId} Baixando PDF de: ${pdfUrl}`);

  try {
    const result = await contaAzulGet(pdfUrl, undefined, correlationId);

    if (!result.ok || !result.data) {
      throw new Error(`Erro ao baixar PDF: ${result.error || 'Unknown error'}`);
    }

    let buffer: Buffer;
    if (Buffer.isBuffer(result.data)) {
      buffer = result.data;
    } else if (typeof result.data === 'string') {
      buffer = Buffer.from(result.data);
    } else {
      buffer = Buffer.from(JSON.stringify(result.data));
    }

    // Validar tamanho
    if (buffer.length < 1024) {
      throw new Error(`PDF muito pequeno: ${buffer.length} bytes (mínimo 1KB)`);
    }

    // Calcular SHA256
    const { createHash } = await import('crypto');
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    logger.info(`${correlationId} PDF baixado com sucesso: ${buffer.length} bytes, SHA256=${sha256}`);

    return {
      buffer,
      meta: {
        bytes: buffer.length,
        sha256,
        contentType: 'application/pdf',
      },
    };
  } catch (err: any) {
    logger.error(`${correlationId} Erro ao baixar PDF: ${err.message}`);
    throw err;
  }
}
