import express from 'express';

const router = express.Router();

/**
 * GET /api/test/zap/env-debug
 * 
 * Mostra quais valores estão sendo lidos das variáveis de ambiente
 */

router.get('/env-debug', async (req, res) => {
  const username = process.env.ZAP_CONTABIL_USER;
  const password = process.env.ZAP_CONTABIL_PASS;
  const baseUrl = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';
  
  return res.json({
    baseUrl,
    username,
    usernameLength: username?.length,
    passwordLength: password?.length,
    hasUsername: !!username,
    hasPassword: !!password,
    allZapEnvs: Object.keys(process.env).filter(k => k.includes('ZAP')),
  });
});

export default router;
