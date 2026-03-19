/**
 * Endpoint para executar scanner de descoberta de upload
 * GET /api/discover/upload-endpoint
 */

import express, { Router } from 'express';
import { discoverUploadEndpointAuto } from './discover-zap-upload-auto';

const router: Router = express.Router();

/**
 * GET /api/discover/upload-endpoint
 * Executar scanner para descobrir endpoint real de upload
 */
router.get('/upload-endpoint', async (req, res) => {
  try {
    console.log('[Discover] Iniciando scanner de upload...');
    
    const result = await discoverUploadEndpointAuto();
    
    res.json(result);
  } catch (error: any) {
    console.error('[Discover] Erro:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

export default router;
