import express from 'express';
import { initZapAuthManager } from './zapcontabilAuthManager.js';

const router = express.Router();

/**
 * GET /api/test/zap/get-signed-url
 * 
 * Obtém signedUrl do Zap storage para upload de arquivo
 * 
 * Query params:
 * - filename: Nome do arquivo (ex: boleto-r7-test.pdf)
 * - expiresInSeconds: Tempo de expiração em segundos (default: 3600)
 * 
 * Output:
 * - ok: boolean
 * - signedUrl: string (URL pré-assinada para upload)
 * - filename: string
 * - expiresIn: number
 */

router.get('/get-signed-url', async (req, res) => {
  const correlationId = `zap-signed-url-${Date.now()}`;
  const { filename, expiresInSeconds } = req.query;
  
  console.log(`[ZapGetSignedUrl] Iniciando obtenção de signedUrl correlationId: ${correlationId}`);
  
  try {
    if (!filename) {
      return res.status(400).json({
        ok: false,
        error: 'filename é obrigatório',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Obter credenciais do ambiente
    const baseUrl = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
    const username = process.env.ZAP_CONTABIL_USER;
    const password = process.env.ZAP_CONTABIL_PASS;
    
    if (!username || !password) {
      return res.status(500).json({
        ok: false,
        error: 'ZAP_CONTABIL_USER e ZAP_CONTABIL_PASS não configurados',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    const authManager = initZapAuthManager({
      baseUrl,
      username,
      password,
    });
    
    // Fazer login
    await authManager.refreshOrLogin();
    
    console.log(`[ZapGetSignedUrl] Fazendo GET /storage/signedUrl/${filename}...`);
    
    // Obter signedUrl
    const response = await authManager.get(`/storage/signedUrl/${filename}`, {
      params: {
        expiresInSeconds: expiresInSeconds || 3600,
      },
      headers: {
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'Accept': 'application/json',
      },
    });
    
    console.log(`[ZapGetSignedUrl] SignedUrl obtida com sucesso`, {
      status: response.status,
      hasSignedUrl: !!response.data?.signedUrl,
      responseData: response.data,
    });
    
    return res.json({
      ok: true,
      signedUrl: response.data?.url || response.data?.signedUrl,
      filename,
      expiresIn: expiresInSeconds || 3600,
      rawResponse: response.data,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    console.error('[ZapGetSignedUrl] Erro fatal:', error);
    
    const errorDetails: any = {
      ok: false,
      error: error.message,
      correlationId,
      timestamp: new Date().toISOString(),
    };
    
    if (error.response) {
      errorDetails.httpStatus = error.response.status;
      errorDetails.httpData = error.response.data;
      errorDetails.url = error.config?.url;
    }
    
    return res.status(500).json(errorDetails);
  }
});

export default router;
