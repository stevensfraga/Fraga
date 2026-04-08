/**
 * 🔍 Debug Router - Check environment variables
 * GET /api/test/debug/env
 */

import { Router } from 'express';
import * as crypto from 'crypto';

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  if (!devSecret) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }

  const headerSecret = req.headers['x-dev-secret'];
  let isValidSecret = false;
  try {
    const headerBuf = Buffer.from(headerSecret || '');
    const devSecretBuf = Buffer.from(devSecret);
    if (headerBuf.length === devSecretBuf.length) {
      isValidSecret = crypto.timingSafeEqual(headerBuf, devSecretBuf);
    }
  } catch (e) {
    isValidSecret = false;
  }

  if (!isValidSecret) {
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  return true;
}

router.get('/env', (req, res) => {
  if (!devOnly(req, res)) return;

  const vars = {
    CONTA_AZUL_CLIENT_ID: process.env.CONTA_AZUL_CLIENT_ID || 'NOT_SET',
    CONTA_AZUL_CLIENT_SECRET: process.env.CONTA_AZUL_CLIENT_SECRET ? '***SET***' : 'NOT_SET',
    CONTA_AZUL_REDIRECT_URI: process.env.CONTA_AZUL_REDIRECT_URI || 'NOT_SET',
    NODE_ENV: process.env.NODE_ENV,
    DEV_SECRET: process.env.DEV_SECRET ? '***SET***' : 'NOT_SET',
  };

  return res.json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: vars,
  });
});

export default router;
