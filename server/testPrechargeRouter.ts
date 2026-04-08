import { Router } from "express";
import * as crypto from 'crypto';
import { sendPrecharge } from "./services/prechargeService";
import { handleInboundMessage } from "./handlers/inboundMessageHandler";

const router = Router();

/**
 * DEV ONLY: Middleware para validar X-Dev-Secret
 */
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

/**
 * POST /api/test/send-precharge-manual/:receivableId
 * Enviar pré-cobrança manualmente (para testes)
 */
router.post("/send-precharge-manual/:receivableId", async (req, res) => {
  if (!devOnly(req, res)) return;
  try {
    const receivableId = Number(req.params.receivableId);
    if (!receivableId) {
      return res.status(400).json({ success: false, error: "receivableId obrigatório" });
    }

    console.log(`[TestPrecharge] Iniciando envio manual para receivableId=${receivableId}`);
    const result = await sendPrecharge(receivableId);

    return res.json({
      success: result.success,
      receivableId,
      messageId: result.messageId,
      error: result.error,
      reason: result.reason,
    });
  } catch (err: any) {
    console.error("[TestPrecharge] Error:", err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

/**
 * POST /api/test/inbound-message
 * Simular mensagem inbound para teste de opt-out
 */
router.post("/inbound-message", async (req, res) => {
  if (!devOnly(req, res)) return;
  try {
    const { whatsappNumber, messageText } = req.body;

    if (!whatsappNumber || !messageText) {
      return res.status(400).json({
        success: false,
        error: "whatsappNumber e messageText obrigatórios",
      });
    }

    console.log(`[TestInbound] Processando mensagem inbound de ${whatsappNumber}`);
    const result = await handleInboundMessage({
      whatsappNumber,
      messageText,
      timestamp: new Date(),
    });

    return res.json({
      success: result.success,
      optOutDetected: result.optOutDetected,
      clientId: result.clientId,
      reason: result.reason,
    });
  } catch (err: any) {
    console.error("[TestInbound] Error:", err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

export default router;
