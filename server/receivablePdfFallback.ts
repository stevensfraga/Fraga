/**
 * Fallback de Produção para Extração de PDF de Boletos
 * 
 * Quando o boleto não está disponível via API Conta Azul,
 * este módulo implementa estratégias de fallback:
 * 1. Tentar obter PDF do painel (services.contaazul.com)
 * 2. Extrair linha digitável/PIX do PDF
 * 3. Armazenar no banco de dados para reutilização
 * 4. Usar dados armazenados em futuras tentativas
 */

import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';
import {
  getFinancialEventSummary,
  extractPdfUrl,
  extractPix,
  extractLinhaDigitavel,
} from './contaAzulPanelAdapter';

interface BoletoData {
  nossoNumero?: string;
  linhaDigitavel?: string;
  pix?: string;
  pdfUrl?: string;
  pdfBytes?: Buffer;
  source: 'api' | 'panel' | 'stored' | 'fallback';
  timestamp: Date;
}

/**
 * Obter dados do boleto com fallback automático
 */
export async function getReceivableBoletoData(
  receivableId: string,
  financialEventId?: string
): Promise<BoletoData | null> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Passo 1: Verificar se há dados armazenados
    const stored = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, parseInt(receivableId)))
      .limit(1);

    if (stored.length > 0 && stored[0].paymentInfoPublic) {
      try {
        // Dados armazenados em campos separados
        const boletoData: BoletoData = {
          nossoNumero: stored[0].documento || undefined,
          linhaDigitavel: stored[0].linhaDigitavel || undefined,
          pdfUrl: stored[0].pdfStorageUrl || undefined,
          source: 'stored',
          timestamp: new Date(),
        };
        return boletoData;
      } catch (error) {
        console.warn(`[BoletoFallback] Erro ao parsear dados armazenados:`, error);
      }
    }

    // Passo 2: Tentar obter do painel (se financialEventId fornecido)
    if (financialEventId) {
      try {
        const summary = await getFinancialEventSummary(financialEventId);
        if (!summary) {
          console.warn(`[BoletoFallback] Summary nulo para ${financialEventId}`);
          throw new Error('Summary nulo');
        }
        const pdfUrl = extractPdfUrl(summary);
        const pix = extractPix(summary);
        const linhaDigitavel = extractLinhaDigitavel(summary);

        if (pdfUrl || pix || linhaDigitavel) {
          const boletoData: BoletoData = {
            nossoNumero: summary.nossa_numero,
            linhaDigitavel: linhaDigitavel || undefined,
            pix: pix || undefined,
            pdfUrl: pdfUrl || undefined,
            source: 'panel',
            timestamp: new Date(),
          };

      // Armazenar para futuras tentativas
        if (db) {
          await db
            .update(receivables)
            .set({
              documento: boletoData.nossoNumero,
              linhaDigitavel: boletoData.linhaDigitavel,
              pdfStorageUrl: boletoData.pdfUrl,
              paymentInfoPublic: true,
              paymentInfoSource: boletoData.source,
              paymentInfoUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(receivables.id, parseInt(receivableId)));
        }

          console.log(`[BoletoFallback] Dados obtidos do painel para ${receivableId}`);
          return boletoData;
        }
      } catch (error) {
        console.warn(`[BoletoFallback] Erro ao obter dados do painel:`, error);
      }
    }

    // Passo 3: Tentar fazer download do PDF se URL disponível
    if (stored.length > 0 && stored[0].pdfStorageUrl) {
      try {
        const pdfBytes = await downloadBoleto(stored[0].pdfStorageUrl || '');
        if (pdfBytes) {
          const boletoData: BoletoData = {
          nossoNumero: stored[0].documento || undefined,
          linhaDigitavel: stored[0].linhaDigitavel || undefined,
          pdfUrl: stored[0].pdfStorageUrl || undefined,
            pdfBytes,
            source: 'fallback',
            timestamp: new Date(),
          };

          console.log(`[BoletoFallback] PDF baixado com sucesso para ${receivableId}`);
          return boletoData;
        }
      } catch (error) {
        console.warn(`[BoletoFallback] Erro ao baixar PDF:`, error);
      }
    }

    console.log(`[BoletoFallback] Nenhum dado de boleto encontrado para ${receivableId}`);
    return null;
  } catch (error: any) {
    console.error(`[BoletoFallback] Erro ao obter dados do boleto:`, error.message);
    return null;
  }
}

/**
 * Armazenar dados do boleto no banco de dados
 */
export async function storeBoletoData(
  receivableId: string,
  boletoData: BoletoData
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Atualizar registro com dados do boleto
    await db
      .update(receivables)
      .set({
        documento: boletoData.nossoNumero,
        linhaDigitavel: boletoData.linhaDigitavel,
        pdfStorageUrl: boletoData.pdfUrl,
        paymentInfoPublic: true,
        paymentInfoSource: boletoData.source,
        paymentInfoUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(receivables.id, parseInt(receivableId)));

    console.log(`[BoletoFallback] Dados armazenados para ${receivableId}`);
  } catch (error: any) {
    console.error(`[BoletoFallback] Erro ao armazenar dados:`, error.message);
  }
}

/**
 * Fazer download do PDF do boleto
 */
export async function downloadBoleto(pdfUrl: string): Promise<Buffer | null> {
  try {
    if (!pdfUrl.startsWith('http')) {
      console.warn(`[BoletoFallback] URL inválida: ${pdfUrl}`);
      return null;
    }

    const accessToken = await getValidAccessToken();
    const response = await axios.get(pdfUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    if (response.status !== 200) {
      console.warn(`[BoletoFallback] HTTP ${response.status} ao baixar PDF`);
      return null;
    }

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('pdf')) {
      console.warn(`[BoletoFallback] Content-Type inválido: ${contentType}`);
      return null;
    }

    const buffer = Buffer.from(response.data);
    if (buffer.length < 1000) {
      console.warn(`[BoletoFallback] PDF muito pequeno: ${buffer.length} bytes`);
      return null;
    }

    console.log(`[BoletoFallback] PDF baixado: ${buffer.length} bytes`);
    return buffer;
  } catch (error: any) {
    console.error(`[BoletoFallback] Erro ao baixar PDF:`, error.message);
    return null;
  }
}

/**
 * Extrair linha digitável do PDF (OCR/parsing)
 * Nota: Implementação simplificada - em produção usar biblioteca OCR
 */
export async function extractLinhaDigitavelFromPdf(
  pdfBuffer: Buffer
): Promise<string | null> {
  try {
    // TODO: Implementar OCR com pdfjs ou tesseract
    // Por enquanto, retorna null
    console.log(`[BoletoFallback] Extração de linha digitável do PDF não implementada`);
    return null;
  } catch (error: any) {
    console.error(`[BoletoFallback] Erro ao extrair linha digitável:`, error.message);
    return null;
  }
}

/**
 * Extrair PIX do PDF (OCR/parsing)
 * Nota: Implementação simplificada - em produção usar biblioteca OCR
 */
export async function extractPixFromPdf(
  pdfBuffer: Buffer
): Promise<string | null> {
  try {
    // TODO: Implementar OCR com pdfjs ou tesseract
    // Por enquanto, retorna null
    console.log(`[BoletoFallback] Extração de PIX do PDF não implementada`);
    return null;
  } catch (error: any) {
    console.error(`[BoletoFallback] Erro ao extrair PIX:`, error.message);
    return null;
  }
}

/**
 * Validar se dados do boleto estão completos
 */
export function isBoletDataComplete(boletoData: BoletoData): boolean {
  // Pelo menos um dos campos deve estar preenchido
  return !!(
    boletoData.nossoNumero ||
    boletoData.linhaDigitavel ||
    boletoData.pix ||
    boletoData.pdfUrl ||
    boletoData.pdfBytes
  );
}

/**
 * Validar se dados do boleto estão prontos para envio
 */
export function isBoletaReadyForSending(boletoData: BoletoData): boolean {
  // Precisa de pelo menos PDF ou PIX/linha digitável
  return !!(
    boletoData.pdfUrl ||
    boletoData.pdfBytes ||
    boletoData.pix ||
    boletoData.linhaDigitavel
  );
}
