/**
 * adminSiegEnableConsultation.ts
 * Endpoint para ativar consulta automática em massa no SIEG
 * GET /api/admin/sieg-enable-consultation-all
 */

import { Router } from "express";
import { enableConsultaAutomaticaSieg } from "../jobs/enableConsultaAutomaticaSieg.js";

const router = Router();

/**
 * GET /api/admin/sieg-enable-consultation-all
 * Ativa consulta automática para todos os certificados com status "Não" no SIEG
 *
 * Headers obrigatórios:
 *   x-admin-key: Fraga@123 (ou chave configurada em FRAGA_ADMIN_KEY)
 *
 * Resposta:
 *   {
 *     "success": true,
 *     "summary": {
 *       "total_analyzed": 100,
 *       "total_enabled": 45,
 *       "already_enabled": 30,
 *       "expired_ignored": 15,
 *       "no_file_ignored": 10,
 *       "auth_errors": 0,
 *       "other_errors": 0,
 *       "duration_ms": 15000
 *     },
 *     "results": [
 *       {
 *         "cnpj": "12345678000100",
 *         "company_name": "Empresa XYZ",
 *         "status": "success",
 *         "consulta_before": { ... },
 *         "consulta_after": { ... }
 *       },
 *       ...
 *     ]
 *   }
 */
router.get("/sieg-enable-consultation-all", async (req, res) => {
  try {
    // Validar admin key
    const adminKey = req.headers["x-admin-key"] as string;
    const expectedKey = process.env.FRAGA_ADMIN_KEY || "Fraga@123";

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: x-admin-key inválida ou ausente",
      });
    }

    console.log("[AdminSiegEnableConsultation] Iniciando ativação em massa...");

    // Executar ativação
    const summary = await enableConsultaAutomaticaSieg();

    console.log("[AdminSiegEnableConsultation] Ativação concluída");

    res.json({
      success: true,
      summary: {
        total_analyzed: summary.total_analyzed,
        total_enabled: summary.total_enabled,
        already_enabled: summary.already_enabled,
        expired_ignored: summary.expired_ignored,
        no_file_ignored: summary.no_file_ignored,
        auth_errors: summary.auth_errors,
        other_errors: summary.other_errors,
        duration_ms: summary.duration_ms,
      },
      results: summary.results,
    });
  } catch (error) {
    console.error("[AdminSiegEnableConsultation] Erro:", (error as any).message);
    res.status(500).json({
      success: false,
      error: (error as any).message || "Erro ao ativar consulta automática",
    });
  }
});

export default router;
