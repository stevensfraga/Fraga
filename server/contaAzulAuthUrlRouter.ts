import express from 'express';
import crypto from 'crypto';

const router = express.Router();

/**
 * CONSTANTES FIXAS — REDIRECT_URI É /api/oauth/callback
 * Este é o URI cadastrado no painel do app Conta Azul.
 * Interceptamos /api/oauth/callback via state detection (ver index.ts):
 * state hex 64 chars = Conta Azul, state base64 = OAuth principal.
 */
const SCOPE = 'openid profile aws.cognito.signin.user.admin';
const REDIRECT_URI = process.env.CONTA_AZUL_REDIRECT_URI || 'https://dashboard.fragacontabilidade.com.br/api/oauth/callback';
const CLIENT_ID = '6gsibk3vp3fd4lk4m70hb39vf3';

// Store de states pendentes (in-memory, limpa a cada restart)
// Previne replay de authorization codes e valida CSRF
const pendingStates = new Map<string, { createdAt: number; expiresAt: number }>();

// Limpar states expirados a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  Array.from(pendingStates.entries()).forEach(([state, data]) => {
    if (now > data.expiresAt) {
      pendingStates.delete(state);
    }
  });
}, 5 * 60 * 1000);

router.get('/auth-url', async (req: express.Request, res: express.Response) => {
  try {
    const clientId = process.env.CONTA_AZUL_CLIENT_ID || CLIENT_ID;

    // Gerar state único (anti-CSRF) — novo a cada chamada
    const state = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 min TTL (mais curto para segurança)

    // Registrar state pendente
    pendingStates.set(state, { createdAt: now, expiresAt });

    console.log('[AuthUrl] AUTH_URL_GENERATED');
    console.log('[AuthUrl] timestamp:', new Date().toISOString());
    console.log('[AuthUrl] scope:', SCOPE);
    console.log('[AuthUrl] redirectUri:', REDIRECT_URI);
    console.log('[AuthUrl] state:', state.substring(0, 12) + '...');
    console.log('[AuthUrl] expiresIn: 10 minutos');
    console.log('[AuthUrl] pendingStates count:', pendingStates.size);

    // Construir URL com URLSearchParams (garante encoding correto)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state,
    });

    const authorizeUrl = `https://auth.contaazul.com/login?${params.toString()}`;

    return res.json({
      success: true,
      authorizeUrl,
      state,
      expiresAt: new Date(expiresAt).toISOString(),
      scope: SCOPE,
      redirectUri: REDIRECT_URI,
    });
  } catch (error) {
    console.error('[AuthUrl] Erro ao gerar URL:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

/**
 * Validar state recebido no callback
 * Retorna true se válido, false se inválido/expirado/já usado
 */
export function validateAndConsumeState(state: string): { valid: boolean; reason?: string } {
  if (!state) return { valid: false, reason: 'state ausente' };

  const data = pendingStates.get(state);
  if (!data) return { valid: false, reason: 'state desconhecido ou já consumido' };

  const now = Date.now();
  if (now > data.expiresAt) {
    pendingStates.delete(state);
    return { valid: false, reason: 'state expirado' };
  }

  // Consumir state (uso único)
  pendingStates.delete(state);
  console.log('[AuthUrl] STATE_CONSUMED:', state.substring(0, 12) + '...');
  return { valid: true };
}

export default router;
