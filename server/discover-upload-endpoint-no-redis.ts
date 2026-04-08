/**
 * Scanner de Upload Endpoint - SEM REDIS
 * Usa: ENV → memCache → fileCache → discovery
 */

import express, { Router } from 'express';
import axios from 'axios';
import { simpleCache } from './utils/simpleCache';
import { fileCache } from './utils/fileCache';
import { ZapAuthManager } from './zapcontabilAuthManager';

const router: Router = express.Router();

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
const CACHE_KEY = 'zap_upload_endpoint_discovery';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

interface DiscoveryResult {
  ok: boolean;
  source: 'env' | 'memory_cache' | 'file_cache' | 'discovery';
  uploadEndpoint?: string;
  fieldName?: string;
  contentType?: string;
  signedUrlEndpoint?: string;
  messageEndpoint?: string;
  notes: string[];
  logs: string[];
  timestamp: string;
}

/**
 * GET /api/discover/upload-endpoint
 * Descobre ou retorna endpoint de upload do ZapContábil
 */
router.get('/upload-endpoint', async (req, res) => {
  const result: DiscoveryResult = {
    ok: false,
    source: 'discovery',
    notes: [],
    logs: [],
    timestamp: new Date().toISOString(),
  };

  try {
    // 1. Verificar ENV override
    const envEndpoint = process.env.ZAP_UPLOAD_ENDPOINT_URL;
    if (envEndpoint) {
      result.ok = true;
      result.source = 'env';
      result.uploadEndpoint = envEndpoint;
      result.fieldName = process.env.ZAP_UPLOAD_FIELD_NAME || 'file';
      result.contentType = 'multipart/form-data';
      result.signedUrlEndpoint = 'GET /storage/signedUrl/{filename}?expiresInSeconds=900';
      result.messageEndpoint = 'POST /messages/{ticketId}';
      result.notes.push('Using ENV override ZAP_UPLOAD_ENDPOINT_URL');
      result.logs.push('[Discovery] Using ENV configuration');
      return res.json(result);
    }

    result.logs.push('[Discovery] ENV not set, checking caches...');

    // 2. Verificar memCache
    const memCached = simpleCache.get<any>(CACHE_KEY);
    if (memCached) {
      result.ok = true;
      result.source = 'memory_cache';
      result.uploadEndpoint = memCached.uploadEndpoint;
      result.fieldName = memCached.fieldName;
      result.contentType = memCached.contentType;
      result.signedUrlEndpoint = memCached.signedUrlEndpoint;
      result.messageEndpoint = memCached.messageEndpoint;
      result.notes.push('Loaded from memory cache (TTL 24h)');
      result.logs.push('[Discovery] Found in memory cache');
      return res.json(result);
    }

    result.logs.push('[Discovery] Not in memory cache, checking file cache...');

    // 3. Verificar fileCache
    const fileCached = fileCache.get<any>(CACHE_KEY);
    if (fileCached) {
      result.ok = true;
      result.source = 'file_cache';
      result.uploadEndpoint = fileCached.uploadEndpoint;
      result.fieldName = fileCached.fieldName;
      result.contentType = fileCached.contentType;
      result.signedUrlEndpoint = fileCached.signedUrlEndpoint;
      result.messageEndpoint = fileCached.messageEndpoint;
      result.notes.push('Loaded from file cache (TTL 24h)');
      result.logs.push('[Discovery] Found in file cache, restoring to memory');
      
      // Restaurar em memCache
      simpleCache.set(CACHE_KEY, fileCached, CACHE_TTL);
      
      return res.json(result);
    }

    result.logs.push('[Discovery] No cache found, running discovery...');

    // 4. Executar discovery real
    result.source = 'discovery';
    
    // Para este MVP, retornar endpoint conhecido
    // Em produção, aqui rodaria o scanner de endpoints
    result.ok = true;
    result.uploadEndpoint = 'POST /files/upload'; // Endpoint padrão
    result.fieldName = 'file';
    result.contentType = 'multipart/form-data';
    result.signedUrlEndpoint = 'GET /storage/signedUrl/{filename}?expiresInSeconds=900';
    result.messageEndpoint = 'POST /messages/{ticketId}';
    result.notes.push('Using default endpoint (discovery not implemented yet)');
    result.logs.push('[Discovery] Using default endpoint');

    // Salvar em caches
    const cacheData = {
      uploadEndpoint: result.uploadEndpoint,
      fieldName: result.fieldName,
      contentType: result.contentType,
      signedUrlEndpoint: result.signedUrlEndpoint,
      messageEndpoint: result.messageEndpoint,
    };

    simpleCache.set(CACHE_KEY, cacheData, CACHE_TTL);
    fileCache.set(CACHE_KEY, cacheData, CACHE_TTL);
    result.logs.push('[Discovery] Saved to memory and file cache');

    return res.json(result);
  } catch (error: any) {
    result.ok = false;
    result.logs.push(`[Error] ${error.message}`);
    result.notes.push('Discovery failed, but caches may have data');
    return res.status(500).json(result);
  }
});

export default router;
