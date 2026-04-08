/**
 * ETAPA 8 — PASSO 8.2: DOWNLOAD PDF REAL (COM PROVAS)
 * 
 * Endpoint: GET /api/test/etapa8/download-first-available
 * 
 * Baixa PDF real com fallback para geração própria
 */

import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';

const router = express.Router();

interface DownloadResult {
  ok: boolean;
  source: 'DIRECT_URL' | 'V2_ENDPOINT' | 'GENERATED_FROM_PAYMENT_FIELDS' | 'FALLBACK_MOCK';
  sizeBytes: number;
  sha256: string;
  contaAzulId: string;
  receivableId: number;
  buffer?: Buffer;
}

/**
 * GET /api/test/etapa8/download-first-available
 * 
 * Baixa PDF do primeiro receivable com link direto disponível
 */
router.get('/download-first-available', async (req, res) => {
  try {
    console.log('[DownloadFirstAvailable] Iniciando...');

    // 1) Obter DB
    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        ok: false,
        error: 'Database connection failed'
      });
    }

    // 2) Buscar receivables com link direto
    const items = await db
      .select()
      .from(receivables)
      .limit(100);

    const realItems = items.filter(r => r.contaAzulId && !r.contaAzulId.startsWith('mock-'));

    console.log('[DownloadFirstAvailable] Total real:', realItems.length);

    // 3) Procurar primeiro com link
    let targetItem = null;
    for (const item of realItems) {
      if (item.link && (item.link.includes('http') || item.link.includes('pdf'))) {
        targetItem = item;
        console.log('[DownloadFirstAvailable] Encontrado com link:', item.contaAzulId);
        break;
      }
    }

    // Se não encontrou com link, usar o primeiro
    if (!targetItem) {
      targetItem = realItems[0];
      console.log('[DownloadFirstAvailable] Usando primeiro:', targetItem?.contaAzulId);
    }

    if (!targetItem) {
      return res.status(404).json({
        ok: false,
        error: 'Nenhum receivable encontrado'
      });
    }

    // 4) Tentar baixar PDF
    let buffer: Buffer | null = null;
    let source: DownloadResult['source'] = 'FALLBACK_MOCK';

    // Tentar link direto
    if (targetItem.link && targetItem.link.includes('http')) {
      try {
        console.log('[DownloadFirstAvailable] Tentando link direto:', targetItem.link);
        const response = await axios.get(targetItem.link, {
          responseType: 'arraybuffer',
          timeout: 10000,
        });

        if (response.status === 200 && response.data) {
          buffer = Buffer.from(response.data);
          source = 'DIRECT_URL';
          console.log('[DownloadFirstAvailable] ✅ Link direto OK:', buffer.length, 'bytes');
        }
      } catch (err: any) {
        console.error('[DownloadFirstAvailable] Link direto falhou:', err.message);
      }
    }

    // Se não conseguiu, gerar PDF simples
    if (!buffer) {
      console.log('[DownloadFirstAvailable] Gerando PDF fallback...');
      
      // Gerar PDF simples com dados do receivable
      const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 300 >>
stream
BT
/F1 12 Tf
50 750 Td
(Boleto - Fraga Dashboard) Tj
0 -20 Td
(Conta Azul ID: ${targetItem.contaAzulId}) Tj
0 -20 Td
(Valor: R$ ${targetItem.amount}) Tj
0 -20 Td
(Vencimento: ${targetItem.dueDate?.toLocaleDateString('pt-BR') || 'N/A'}) Tj
0 -20 Td
(Status: ${targetItem.status}) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
0000000301 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
651
%%EOF`;

      buffer = Buffer.from(pdfContent, 'utf-8');
      source = 'FALLBACK_MOCK';
      console.log('[DownloadFirstAvailable] ✅ PDF fallback gerado:', buffer.length, 'bytes');
    }

    // 5) Calcular SHA256
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    console.log('[DownloadFirstAvailable] ✅ Download completo');
    console.log('[DownloadFirstAvailable] Source:', source);
    console.log('[DownloadFirstAvailable] Size:', buffer.length);
    console.log('[DownloadFirstAvailable] SHA256:', sha256);

    return res.json({
      ok: true,
      source,
      sizeBytes: buffer.length,
      sha256,
      contaAzulId: targetItem.contaAzulId,
      receivableId: targetItem.id,
      bufferBase64: buffer.toString('base64').substring(0, 100) + '...',
      nextAction: 'E2E_REAL'
    });
  } catch (error: any) {
    console.error('[DownloadFirstAvailable] Erro:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
