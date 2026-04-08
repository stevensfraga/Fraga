import { Router, Request, Response } from "express";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { getSyncStatus, getLastSyncResult } from "../jobs/certSyncScheduler.js";

const router = Router();
const DB_URL = process.env.DATABASE_URL || "";
const CERT_PATH = process.env.CERTIFICATES_PATH || "/data/certificados";

// Middleware de autenticação
function authMiddleware(req: Request, res: Response, next: Function) {
  const adminKey = req.headers["x-admin-key"];
  const expectedKey = process.env.FRAGA_ADMIN_KEY || "Fraga@123";
  
  if (adminKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

router.use(authMiddleware);

// GET /api/admin/cert-sync-status
router.get("/", async (req: Request, res: Response) => {
  try {
    const conn = await mysql.createConnection(DB_URL);

    // Contar certificados no banco
    const [dashboardCerts] = await conn.execute(
      "SELECT COUNT(*) as total, SUM(CASE WHEN file_path IS NOT NULL AND file_path != '' THEN 1 ELSE 0 END) as with_file FROM certificates WHERE is_active = 1"
    ) as any[];

    // Contar arquivos no servidor
    let serverFiles = 0;
    if (fs.existsSync(CERT_PATH)) {
      serverFiles = fs.readdirSync(CERT_PATH).filter(f => 
        f.endsWith(".pfx") || f.endsWith(".p12")
      ).length;
    }

    // Certificados sem arquivo
    const [missingFiles] = await conn.execute(
      "SELECT COUNT(*) as total FROM certificates WHERE is_active = 1 AND (file_path IS NULL OR file_path = '')"
    ) as any[];

    // Status de sincronização
    const syncStatus = getSyncStatus();
    const lastResult = getLastSyncResult();

    await conn.end();

    res.json({
      status: "success",
      timestamp: new Date().toISOString(),
      dashboard: {
        total_certificates: dashboardCerts[0].total,
        with_file: dashboardCerts[0].with_file,
        without_file: missingFiles[0].total,
      },
      server: {
        total_files: serverFiles,
        path: CERT_PATH,
      },
      sync: {
        in_progress: syncStatus.inProgress,
        last_result: lastResult,
        next_run: syncStatus.nextRun,
      },
      summary: {
        elegible_for_activation: dashboardCerts[0].with_file,
        missing_files: missingFiles[0].total,
        sync_percentage: dashboardCerts[0].total > 0 
          ? Math.round((dashboardCerts[0].with_file / dashboardCerts[0].total) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error("[CertSyncStatus] Erro:", (error as any).message);
    res.status(500).json({
      error: "Erro ao obter status de sincronização",
      message: (error as any).message,
    });
  }
});

export default router;
