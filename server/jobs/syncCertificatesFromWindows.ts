import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL || "";
const CERT_PATH = process.env.CERTIFICATES_PATH || "/data/certificados";
const WINDOWS_REMOTE = process.env.WINDOWS_CERTS_REMOTE || "windows-certs:";
const RCLONE_CONFIG = process.env.RCLONE_CONFIG || "/home/ubuntu/.config/rclone/rclone.conf";

interface SyncLog {
  timestamp: string;
  total_files_windows: number;
  total_files_linux: number;
  files_synced: string[];
  files_failed: string[];
  new_files: string[];
  sieg_activated: number;
  sieg_failed: number;
  sieg_errors: Record<string, string>;
  duration_ms: number;
  status: "success" | "partial" | "failed";
}

export async function syncCertificatesFromWindows(): Promise<SyncLog> {
  const startTime = Date.now();
  const log: SyncLog = {
    timestamp: new Date().toISOString(),
    total_files_windows: 0,
    total_files_linux: 0,
    files_synced: [],
    files_failed: [],
    new_files: [],
    sieg_activated: 0,
    sieg_failed: 0,
    sieg_errors: {},
    duration_ms: 0,
    status: "success",
  };

  try {
    console.log("[CertSync] Iniciando sincronização de certificados...");

    // Criar diretório se não existir
    if (!fs.existsSync(CERT_PATH)) {
      fs.mkdirSync(CERT_PATH, { recursive: true });
      console.log(`[CertSync] Diretório criado: ${CERT_PATH}`);
    }

    // Contar arquivos antes da sincronização
    const filesBeforeSync = fs.readdirSync(CERT_PATH).filter(f => 
      f.endsWith(".pfx") || f.endsWith(".p12")
    );
    log.total_files_linux = filesBeforeSync.length;

    // Executar sincronização com Rclone
    console.log("[CertSync] Executando Rclone sync...");
    try {
      const cmd = `rclone --config ${RCLONE_CONFIG} sync "${WINDOWS_REMOTE}" "${CERT_PATH}" --verbose --log-level INFO 2>&1`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 300000 });
      console.log("[CertSync] Rclone output:", output.substring(0, 500));
    } catch (e: any) {
      // Rclone pode retornar exit code não-zero mesmo com sucesso parcial
      console.warn("[CertSync] Rclone warning:", (e as any).message.substring(0, 200));
    }

    // Contar arquivos após sincronização
    const filesAfterSync = fs.readdirSync(CERT_PATH).filter(f => 
      f.endsWith(".pfx") || f.endsWith(".p12")
    );
    log.total_files_linux = filesAfterSync.length;

    // Identificar novos arquivos
    const newFiles = filesAfterSync.filter(f => !filesBeforeSync.includes(f));
    log.new_files = newFiles;
    log.files_synced = newFiles;

    console.log(`[CertSync] Sincronização concluída: ${newFiles.length} novos arquivos`);

    // Atualizar banco com novos certificados
    if (newFiles.length > 0) {
      const conn = await mysql.createConnection(DB_URL);
      
      for (const file of newFiles) {
        try {
          const filePath = path.join(CERT_PATH, file);
          const stat = fs.statSync(filePath);
          
          // Extrair CNPJ do nome do arquivo (formato: CNPJ_EMPRESA.pfx)
          const cnpjMatch = file.match(/^(\d{14})/);
          if (!cnpjMatch) continue;
          
          const cnpj = cnpjMatch[1];
          
          // Verificar se já existe no banco
          const [existing] = await conn.execute(
            "SELECT id FROM certificates WHERE cnpj = ?",
            [cnpj]
          ) as any[];
          
          if (existing.length === 0) {
            // Inserir novo certificado
            await conn.execute(
              `INSERT INTO certificates 
               (cnpj, company_name, file_path, file_name, status, source, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'valid', 'windows_sync', 1, NOW(), NOW())`,
              [cnpj, file.replace(/\.[^/.]+$/, ""), filePath, file]
            );
            console.log(`[CertSync] Novo certificado inserido: ${cnpj}`);
          } else {
            // Atualizar caminho do arquivo
            await conn.execute(
              "UPDATE certificates SET file_path = ?, file_name = ?, updated_at = NOW() WHERE cnpj = ?",
              [filePath, file, cnpj]
            );
            console.log(`[CertSync] Certificado atualizado: ${cnpj}`);
          }
        } catch (e) {
          console.error(`[CertSync] Erro ao processar ${file}:`, (e as any).message);
          log.files_failed.push(file);
        }
      }
      
      await conn.end();
    }

    // Tentar ativar consulta automática para novos certificados
    if (newFiles.length > 0) {
      console.log("[CertSync] Tentando ativar consulta automática no SIEG...");
      try {
        // Importar função de ativação
        const { enableConsultaAutomaticaSieg } = await import("./enableConsultaAutomaticaSieg.js");
        const activationResult = await enableConsultaAutomaticaSieg();
        log.sieg_activated = (activationResult as any).ativados || 0;
        log.sieg_failed = (activationResult as any).erros || 0;
        log.sieg_errors = (activationResult as any).detalhes || {};
      } catch (e) {
        console.warn("[CertSync] Erro ao ativar no SIEG:", (e as any).message);
      }
    }

    log.duration_ms = Date.now() - startTime;
    log.status = log.files_failed.length === 0 ? "success" : "partial";

    console.log("[CertSync] ✅ Sincronização concluída com sucesso");
    return log;
  } catch (e) {
    log.duration_ms = Date.now() - startTime;
    log.status = "failed";
    console.error("[CertSync] ❌ Erro na sincronização:", (e as any).message);
    throw e;
  }
}

