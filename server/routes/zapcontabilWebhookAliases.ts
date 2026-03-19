/**
 * Aliases para ZapContábil webhooks
 * O ZapContábil está enviando para rotas diferentes do que foi configurado
 * Este arquivo cria múltiplos paths que apontam para a mesma lógica
 */

import { Router, Request, Response, NextFunction } from "express";

const router = Router();

/**
 * Middleware que transfere a requisição para o caminho correto
 * Funciona como um redirecionador interno
 */
const redirectToSetor = (targetPath: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    console.log(`[ZAPCONTABIL-ALIAS] 🔀 ${req.method} ${req.path} → ${targetPath}`);
    // Transferir a requisição para o targetPath internamente
    req.url = targetPath;
    next();
  };
};

// Todos esses paths vão para /webhook-message-setor
router.post("/webhook-message", redirectToSetor("/webhook-message-setor"), (req, res) => res.status(200).json({ ok: true }));
router.post("/setor-nota-fiscal", redirectToSetor("/webhook-message-setor"), (req, res) => res.status(200).json({ ok: true }));
router.put("/setor-nota-fiscal", redirectToSetor("/webhook-message-setor"), (req, res) => res.status(200).json({ ok: true }));
router.put("/webhook-message", redirectToSetor("/webhook-message-setor"), (req, res) => res.status(200).json({ ok: true }));

export const zapcontabilWebhookAliasesRouter = router;
export default router;
