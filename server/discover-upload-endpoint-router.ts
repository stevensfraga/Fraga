/**
 * Router para descobrir endpoint REAL de upload do ZapContábil
 * Executa scanner com validação de contrato
 */

import express, { Router } from 'express';
import { discoverUploadEndpointReal } from './discover-upload-real-validator';
import { simpleCache } from './utils/simpleCache';

const router: Router = express.Router();

// Cache para armazenar resultado da descoberta
const UPLOAD_ENDPOINT_CACHE_KEY = 'zap_upload_endpoint_real';

router.post('/upload-real', async (req, res) => {
  try {
    console.log('[discover-upload-endpoint] Iniciando descoberta...');
    
    // Verificar cache primeiro
    const cached = simpleCache.get(UPLOAD_ENDPOINT_CACHE_KEY);
    if (cached) {
      console.log('[discover-upload-endpoint] Usando resultado em cache');
      return res.json({
        ok: true,
        source: 'cache',
        ...cached,
      });
    }
    
    // Executar descoberta
    const result = await discoverUploadEndpointReal();
    
    // Se encontrou, armazenar em cache por 1 hora
    if (result.ok && result.uploadEndpoint) {
      simpleCache.set(UPLOAD_ENDPOINT_CACHE_KEY, {
        uploadEndpoint: result.uploadEndpoint,
        fieldName: result.fieldName,
      }, 3600);
      
      console.log(`[discover-upload-endpoint] Endpoint real descoberto: ${result.uploadEndpoint}`);
    }
    
    res.json({
      ok: result.ok,
      source: 'discovery',
      uploadEndpoint: result.uploadEndpoint,
      fieldName: result.fieldName,
      totalEndpointsTested: result.results?.length || 0,
      successfulEndpoints: result.results?.filter((r: any) => r.isRealUpload).length || 0,
      results: result.results,
      error: result.error,
    });
  } catch (err) {
    console.error('[discover-upload-endpoint] Error:', err);
    res.status(500).json({
      ok: false,
      error: (err as any).message,
    });
  }
});

// Endpoint para obter endpoint em cache
router.get('/upload-endpoint-cached', (req, res) => {
  const cached = simpleCache.get(UPLOAD_ENDPOINT_CACHE_KEY);
  res.json({
    ok: !!cached,
    cached,
  });
});

// Endpoint para limpar cache
router.post('/upload-endpoint-clear-cache', (req, res) => {
  simpleCache.delete(UPLOAD_ENDPOINT_CACHE_KEY);
  res.json({
    ok: true,
    message: 'Cache cleared',
  });
});

export default router;
