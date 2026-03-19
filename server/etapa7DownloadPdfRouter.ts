/**
 * PASSO 3: TESTAR DOWNLOAD DO PDF REAL
 * 
 * Endpoint: GET /api/test/etapa7/download-pdf/:contaAzulId
 */

import express from 'express';
import { downloadContaAzulPdf } from './contaAzulApiClient';

const router = express.Router();

const API_BASE = 'https://api.contaazul.com/v1';

/**
 * GET /api/test/etapa7/download-pdf/:contaAzulId
 * 
 * Baixa PDF real do Conta Azul
 */
router.get('/download-pdf/:contaAzulId', async (req, res) => {
  try {
    const { contaAzulId } = req.params;

    if (!contaAzulId) {
      return res.status(400).json({
        success: false,
        error: 'contaAzulId é obrigatório',
        apiBase: API_BASE
      });
    }

    console.log('[DownloadPdf] Iniciando download do PDF:', contaAzulId);

    // Usar função já testada
    const buffer = await downloadContaAzulPdf(contaAzulId);

    if (!buffer) {
      console.error('[DownloadPdf] Falha ao baixar PDF');
      return res.status(404).json({
        success: false,
        error: 'PDF não disponível ou falha ao baixar',
        contaAzulId,
        apiBase: API_BASE
      });
    }

    // Validar resposta
    const isValidPdf = buffer.length > 1000;

    console.log('[DownloadPdf] ✅ PDF baixado com sucesso');
    console.log('[DownloadPdf] Buffer size:', buffer.length);

    // Retornar como JSON com buffer em base64
    return res.json({
      success: isValidPdf,
      httpStatus: 200,
      contentType: 'application/pdf',
      bufferSize: buffer.length,
      bufferBase64: buffer.toString('base64').substring(0, 100) + '...',
      message: isValidPdf ? 'PDF baixado com sucesso!' : 'PDF inválido ou muito pequeno',
      nextStep: isValidPdf ? 'PASSO 4: Executar E2E real com PDF' : 'ERRO: PDF inválido',
      contaAzulId,
      apiBase: API_BASE
    });
  } catch (error: any) {
    console.error('[DownloadPdf] Erro geral:', error.message);

    return res.status(500).json({
      success: false,
      error: error.message,
      contaAzulId: req.params.contaAzulId,
      apiBase: API_BASE
    });
  }
});

export default router;
