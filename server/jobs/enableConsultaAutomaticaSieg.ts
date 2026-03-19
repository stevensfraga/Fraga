/**
 * enableConsultaAutomaticaSieg.ts
 * Ativa consulta automática (ConsultaNfe, ConsultaCte, ConsultaNfse, ConsultaNoturna)
 * para todos os certificados com status "Não" no SIEG.
 *
 * Fluxo:
 *   1. Listar todos os certificados do SIEG
 *   2. Filtrar os com consulta desativada
 *   3. Ignorar certificados expirados
 *   4. Re-enviar certificado com consulta ativada
 *   5. Validar resultado
 *   6. Gerar relatório
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { uploadCertificadoSieg, listarCertificadosSieg } from "../services/siegService.js";

const DB_URL = process.env.DATABASE_URL!;
const CERT_PATH = process.env.CERTIFICATES_PATH || "/data/certificados";
const CERT_PASSWORD_DEFAULT = process.env.CERT_PASSWORD_DEFAULT || "Fraga@123";

if (!DB_URL) throw new Error("DATABASE_URL não configurada");

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ConsultaStatus {
  ConsultaNfe: boolean;
  ConsultaCte: boolean;
  ConsultaNfse: boolean;
  ConsultaNoturna: boolean;
}

interface EnableResult {
  cnpj: string;
  company_name: string;
  status: "success" | "already_enabled" | "expired" | "no_file" | "error";
  error?: string;
  consulta_before?: ConsultaStatus;
  consulta_after?: ConsultaStatus;
}

interface ExecutionSummary {
  total_analyzed: number;
  total_enabled: number;
  already_enabled: number;
  expired_ignored: number;
  no_file_ignored: number;
  auth_errors: number;
  other_errors: number;
  duration_ms: number;
  results: EnableResult[];
}

// ─── Função principal ──────────────────────────────────────────────────────────

export async function enableConsultaAutomaticaSieg(): Promise<ExecutionSummary> {
  const startTime = Date.now();
  const conn = await mysql.createConnection(DB_URL);
  const results: EnableResult[] = [];

  let totalAnalyzed = 0;
  let totalEnabled = 0;
  let alreadyEnabled = 0;
  let expiredIgnored = 0;
  let noFileIgnored = 0;
  let authErrors = 0;
  let otherErrors = 0;

  try {
    console.log("[EnableConsultaAutomatica] Iniciando ativação em massa...");

    // ─── Buscar certificados do SIEG ───────────────────────────────────────────
    console.log("[EnableConsultaAutomatica] Buscando certificados do SIEG...");
    let siegCerts: any[] = [];
    try {
      const result = await listarCertificadosSieg();
      siegCerts = Array.isArray(result) ? result : (result as any).data || [];
      console.log(`  ✅ ${siegCerts.length} certificados encontrados`);
    } catch (e) {
      console.error(`  ❌ Erro ao buscar SIEG: ${(e as any).message}`);
      throw e;
    }

    if (siegCerts.length === 0) {
      console.warn("[EnableConsultaAutomatica] Nenhum certificado encontrado no SIEG");
      return {
        total_analyzed: 0,
        total_enabled: 0,
        already_enabled: 0,
        expired_ignored: 0,
        no_file_ignored: 0,
        auth_errors: 0,
        other_errors: 0,
        duration_ms: Date.now() - startTime,
        results: [],
      };
    }

    // ─── Buscar certificados locais para comparação ────────────────────────────
    const [localCerts] = (await conn.execute(
      "SELECT id, cnpj, company_name, status, valid_to, file_path FROM certificates WHERE is_active = 1"
    )) as any[];

    const localMap = new Map();
    for (const cert of localCerts) {
      const cnpj = String(cert.cnpj).replace(/\D/g, "");
      if (!localMap.has(cnpj)) localMap.set(cnpj, cert);
    }

    // ─── Processar cada certificado ────────────────────────────────────────────
    console.log(`[EnableConsultaAutomatica] Processando ${siegCerts.length} certificados...`);

    for (const siegCert of siegCerts) {
      const cnpj = String(siegCert.CnpjCpf || "").replace(/\D/g, "");
      if (!cnpj) continue;

      totalAnalyzed++;

      // Verificar se está expirado
      const expiry = new Date(siegCert.DataExpira || "");
      if (expiry < new Date()) {
        expiredIgnored++;
        results.push({
          cnpj,
          company_name: siegCert.Nome,
          status: "expired",
          error: `Certificado expirado em ${expiry.toLocaleDateString("pt-BR")}`,
        });
        continue;
      }

      // Verificar se consulta já está ativada
      const consultaBefore: ConsultaStatus = {
        ConsultaNfe: siegCert.ConsultaNfe ?? false,
        ConsultaCte: siegCert.ConsultaCte ?? false,
        ConsultaNfse: siegCert.ConsultaNfse ?? false,
        ConsultaNoturna: siegCert.ConsultaNoturna ?? false,
      };

      const allEnabled = Object.values(consultaBefore).every((v) => v === true);
      if (allEnabled) {
        alreadyEnabled++;
        results.push({
          cnpj,
          company_name: siegCert.Nome,
          status: "already_enabled",
          consulta_before: consultaBefore,
        });
        continue;
      }

      // ─── Buscar arquivo do certificado ────────────────────────────────────────
      const localCert = localMap.get(cnpj);
      let pfxPath: string | null = null;

      if (localCert?.file_path) {
        pfxPath = localCert.file_path;
      } else {
        // Tentar encontrar arquivo no disco
        try {
          const files = fs.readdirSync(CERT_PATH);
          const certFile = files.find((f) => f.includes(cnpj) && (f.endsWith(".pfx") || f.endsWith(".p12")));
          if (certFile) pfxPath = path.join(CERT_PATH, certFile);
        } catch (e) {
          // Ignorar erro de leitura de diretório
        }
      }

      if (!pfxPath || !fs.existsSync(pfxPath)) {
        noFileIgnored++;
        results.push({
          cnpj,
          company_name: siegCert.Nome,
          status: "no_file",
          error: "Arquivo do certificado não encontrado no servidor",
        });
        continue;
      }

      // ─── Ativar consulta automática ────────────────────────────────────────
      try {
        console.log(`  🔄 ${cnpj} — ${siegCert.Nome}...`);

        const pfxBuffer = fs.readFileSync(pfxPath);
        const uploadResult = await uploadCertificadoSieg(
          cnpj,
          siegCert.Nome,
          pfxBuffer,
          CERT_PASSWORD_DEFAULT,
          "Pfx",
          siegCert.Id
        );

        if (uploadResult.success) {
          totalEnabled++;
          results.push({
            cnpj,
            company_name: siegCert.Nome,
            status: "success",
            consulta_before: consultaBefore,
            consulta_after: {
              ConsultaNfe: true,
              ConsultaCte: true,
              ConsultaNfse: true,
              ConsultaNoturna: true,
            },
          });
          console.log(`    ✅ Ativado com sucesso`);
        } else {
          // Verificar tipo de erro
          const errorMsg = uploadResult.error || "Erro desconhecido";
          if (errorMsg.includes("autenticação") || errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
            authErrors++;
          } else {
            otherErrors++;
          }

          results.push({
            cnpj,
            company_name: siegCert.Nome,
            status: "error",
            error: errorMsg,
            consulta_before: consultaBefore,
          });
          console.log(`    ❌ ${errorMsg}`);
        }
      } catch (e) {
        const errorMsg = (e as any).message || String(e);
        if (errorMsg.includes("autenticação") || errorMsg.includes("401")) {
          authErrors++;
        } else {
          otherErrors++;
        }

        results.push({
          cnpj,
          company_name: siegCert.Nome,
          status: "error",
          error: errorMsg,
          consulta_before: consultaBefore,
        });
        console.error(`    ❌ ${errorMsg}`);
      }
    }

    // ─── Gerar relatório ──────────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    console.log("\n" + "=".repeat(70));
    console.log("📊 ATIVAÇÃO DE CONSULTA AUTOMÁTICA — RESUMO");
    console.log("=".repeat(70));
    console.log(`\nTotal analisado: ${totalAnalyzed}`);
    console.log(`✅ Ativados: ${totalEnabled}`);
    console.log(`⚪ Já ativados: ${alreadyEnabled}`);
    console.log(`⏳ Expirados (ignorados): ${expiredIgnored}`);
    console.log(`📁 Sem arquivo (ignorados): ${noFileIgnored}`);
    console.log(`❌ Erros de autenticação: ${authErrors}`);
    console.log(`❌ Outros erros: ${otherErrors}`);
    console.log(`⏱️  Duração: ${duration}ms`);

    await conn.end();

    return {
      total_analyzed: totalAnalyzed,
      total_enabled: totalEnabled,
      already_enabled: alreadyEnabled,
      expired_ignored: expiredIgnored,
      no_file_ignored: noFileIgnored,
      auth_errors: authErrors,
      other_errors: otherErrors,
      duration_ms: duration,
      results,
    };
  } catch (e) {
    console.error("[EnableConsultaAutomatica] Erro fatal:", (e as any).message);
    await conn.end();
    throw e;
  }
}

