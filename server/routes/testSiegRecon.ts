/**
 * testSiegRecon.ts
 * Endpoint manual para executar reconcileSiegCertificates() em produção assistida.
 * Protegido por x-admin-key.
 */

import { Router } from "express";
import { reconcileSiegCertificates } from "../jobs/reconcileSiegCertificates.js";

const router = Router();

const ADMIN_KEY = process.env.FRAGA_ADMIN_KEY || "Fraga@123";

function adminAuth(req: any, res: any, next: any) {
  const key = req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * GET /api/test/sieg-recon
 * Executa reconciliação SIEG ↔ banco local e retorna relatório completo.
 */
router.get("/sieg-recon", adminAuth, async (_req, res) => {
  console.log("[TEST-SIEG-RECON] Iniciando reconciliação manual...");
  try {
    const result = await reconcileSiegCertificates();
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[TEST-SIEG-RECON] Erro:", msg);
    return res.status(500).json({ error: msg });
  }
});

export default router;
