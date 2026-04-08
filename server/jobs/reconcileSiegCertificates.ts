/**
 * reconcileSiegCertificates.ts
 *
 * Rotina de reconciliação SIEG ↔ banco local.
 *
 * Fluxo:
 *  1. Listar todos os certificados do SIEG (ativos + inativos)
 *  2. Cruzar por CNPJ com a tabela certificates local
 *  3. Atualizar registros locais com dados do SIEG
 *  4. Se existir no SIEG mas não localmente → criar registro mínimo (sieg_remote)
 *  5. Se existir localmente mas não no SIEG → manter como local_only
 *  6. Classificar: local_ok | sieg_only | local_only | divergent
 *
 * Classificações visuais:
 *  - local_ok:    Existe local + SIEG, dados consistentes
 *  - sieg_only:   Existe no SIEG mas não há arquivo local nem registro local
 *  - local_only:  Existe localmente mas não foi encontrado no SIEG
 *  - divergent:   Existe em ambos mas há divergência (status, expiração)
 *
 * Campos atualizados:
 *  - sieg_remote_active, sieg_remote_expiry, sieg_remote_status
 *  - sieg_synced_at, sieg_source, sieg_recon_status
 */

import mysql from "mysql2/promise";
import { ENV } from "../_core/env.js";
import { listarCertificadosSieg } from "../services/siegService.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SiegRemoteItem {
  Id: string;
  Nome: string;
  CnpjCpf: string;
  DataExpira?: string;
  DataVencimento?: string;
  Ativo?: boolean;
  Deletado?: boolean;
  Status?: string;
  TipoCertificado?: string;
}

interface LocalCertificate {
  id: number;
  cnpj: string;
  company_name: string | null;
  file_path: string | null;
  sieg_status: string | null;
  sieg_id: string | null;
  sieg_remote_active: boolean | null;
  sieg_remote_status: string | null;
  sieg_source: string | null;
  sieg_recon_status: string | null;
  valid_to: Date | null;
  is_active: boolean;
}

export interface ReconcileResult {
  success: boolean;
  duration_ms: number;
  sieg_total: number;
  local_total: number;
  stats: {
    local_ok: number;
    sieg_only: number;
    local_only: number;
    divergent: number;
    updated: number;
    created: number;
    errors: number;
  };
  created_cnpjs: string[];
  divergent_cnpjs: string[];
  errors: Array<{ cnpj: string; error: string }>;
  synced_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normaliza CNPJ/CPF removendo pontuação */
function normalizeCnpj(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

/** Converte string de data do SIEG para Date ou null */
function parseSiegDate(raw?: string): Date | null {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** Classifica a divergência entre local e SIEG */
function classifyReconStatus(
  local: LocalCertificate | undefined,
  sieg: SiegRemoteItem | undefined
): "local_ok" | "sieg_only" | "local_only" | "divergent" {
  if (!local && sieg) return "sieg_only";
  if (local && !sieg) return "local_only";
  if (!local || !sieg) return "local_only";

  // Ambos existem — verificar divergências
  const siegActive = sieg.Ativo === true && sieg.Deletado !== true;
  const siegExpiry = parseSiegDate(sieg.DataExpira || sieg.DataVencimento);

  // Divergência de status ativo
  if (local.is_active !== siegActive) return "divergent";

  // Divergência de expiração (tolerância de 30 dias)
  if (local.valid_to && siegExpiry) {
    const diffDays = Math.abs(
      (local.valid_to.getTime() - siegExpiry.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays > 30) return "divergent";
  }

  return "local_ok";
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function reconcileSiegCertificates(): Promise<ReconcileResult> {
  const startTime = Date.now();
  const syncedAt = new Date().toISOString();

  const result: ReconcileResult = {
    success: false,
    duration_ms: 0,
    sieg_total: 0,
    local_total: 0,
    stats: {
      local_ok: 0,
      sieg_only: 0,
      local_only: 0,
      divergent: 0,
      updated: 0,
      created: 0,
      errors: 0,
    },
    created_cnpjs: [],
    divergent_cnpjs: [],
    errors: [],
    synced_at: syncedAt,
  };

  console.log("[SIEG_RECON] Iniciando reconciliação SIEG ↔ banco local...");

  // ── PASSO 1: Listar certificados do SIEG ────────────────────────────────────
  const siegResult = await listarCertificadosSieg();
  if (!siegResult.success || !siegResult.data) {
    result.duration_ms = Date.now() - startTime;
    result.errors.push({ cnpj: "*", error: siegResult.error || "Falha ao listar SIEG" });
    console.error("[SIEG_RECON] Falha ao listar certificados do SIEG:", siegResult.error);
    return result;
  }

  const siegItems = siegResult.data as SiegRemoteItem[];
  result.sieg_total = siegItems.length;
  console.log(`[SIEG_RECON] SIEG retornou ${siegItems.length} certificados`);

  // Montar mapa SIEG por CNPJ normalizado (pode haver múltiplos por CNPJ — pegar o mais recente/ativo)
  const siegByCnpj = new Map<string, SiegRemoteItem>();
  for (const item of siegItems) {
    const cnpj = normalizeCnpj(item.CnpjCpf);
    if (!cnpj) continue;
    const existing = siegByCnpj.get(cnpj);
    // Preferir ativo sobre inativo, e mais recente
    if (!existing) {
      siegByCnpj.set(cnpj, item);
    } else {
      // Preferir ativo
      if (item.Ativo && !existing.Ativo) {
        siegByCnpj.set(cnpj, item);
      }
    }
  }

  // ── PASSO 2: Carregar todos os registros locais ─────────────────────────────
  const conn = await mysql.createConnection(ENV.databaseUrl);
  try {
    const [localRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, cnpj, company_name, file_path, sieg_status, sieg_id,
              sieg_remote_active, sieg_remote_status, sieg_source, sieg_recon_status,
              valid_to, is_active
       FROM certificates
       WHERE is_active = 1
       ORDER BY id DESC`
    );

    result.local_total = localRows.length;
    console.log(`[SIEG_RECON] Banco local tem ${localRows.length} certificados ativos`);

    // Montar mapa local por CNPJ (pegar o mais recente por CNPJ)
    const localByCnpj = new Map<string, LocalCertificate>();
    for (const row of localRows as LocalCertificate[]) {
      const cnpj = normalizeCnpj(row.cnpj);
      if (!localByCnpj.has(cnpj)) {
        localByCnpj.set(cnpj, row);
      }
    }

    // ── PASSO 3: Atualizar locais que existem no SIEG ──────────────────────────
    const allCnpjs = Array.from(new Set([...Array.from(localByCnpj.keys()), ...Array.from(siegByCnpj.keys())]));

    for (const cnpj of allCnpjs) {
      const local = localByCnpj.get(cnpj);
      const sieg = siegByCnpj.get(cnpj);

      const reconStatus = classifyReconStatus(local, sieg);

      try {
        if (local && sieg) {
          // ── Caso: Existe em ambos → atualizar campos de reconciliação ──────
          const siegActive = sieg.Ativo === true && sieg.Deletado !== true;
          const siegExpiry = parseSiegDate(sieg.DataExpira || sieg.DataVencimento);
          const siegRemoteStatus = sieg.Deletado
            ? "Deletado"
            : sieg.Ativo
            ? "Ativo"
            : "Inativo";

          // Determinar sieg_source: se tem arquivo local → reconciled, senão → sieg_remote
          const hasLocalFile = !!local.file_path;
          const siegSource = hasLocalFile ? "reconciled" : "sieg_remote";

          await conn.execute(
            `UPDATE certificates
             SET sieg_remote_active = ?,
                 sieg_remote_expiry = ?,
                 sieg_remote_status = ?,
                 sieg_synced_at = NOW(),
                 sieg_source = ?,
                 sieg_recon_status = ?,
                 sieg_id = COALESCE(sieg_id, ?)
             WHERE id = ?`,
            [
              siegActive ? 1 : 0,
              siegExpiry ? siegExpiry.toISOString().slice(0, 19).replace("T", " ") : null,
              siegRemoteStatus,
              siegSource,
              reconStatus,
              sieg.Id || null,
              local.id,
            ]
          );

          result.stats.updated++;

          if (reconStatus === "divergent") {
            result.stats.divergent++;
            result.divergent_cnpjs.push(cnpj);
          } else {
            result.stats.local_ok++;
          }
        } else if (!local && sieg) {
          // ── Caso: Existe no SIEG mas não localmente → criar registro mínimo ─
          const siegActive = sieg.Ativo === true && sieg.Deletado !== true;
          const siegExpiry = parseSiegDate(sieg.DataExpira || sieg.DataVencimento);
          const siegRemoteStatus = sieg.Deletado
            ? "Deletado"
            : sieg.Ativo
            ? "Ativo"
            : "Inativo";

          // Extrair nome da empresa do campo Nome do SIEG
          const companyName = sieg.Nome
            ? sieg.Nome.replace(/\s*\(.*\)$/, "").trim()
            : null;

          await conn.execute(
            `INSERT INTO certificates
               (cnpj, company_name, status, source, is_active,
                sieg_status, sieg_id,
                sieg_remote_active, sieg_remote_expiry, sieg_remote_status,
                sieg_synced_at, sieg_source, sieg_recon_status,
                created_at, updated_at)
             VALUES
               (?, ?, 'unknown', 'manual', 1,
                'sent', ?,
                ?, ?, ?,
                NOW(), 'sieg_remote', 'sieg_only',
                NOW(), NOW())`,
            [
              cnpj,
              companyName,
              sieg.Id || null,
              siegActive ? 1 : 0,
              siegExpiry ? siegExpiry.toISOString().slice(0, 19).replace("T", " ") : null,
              siegRemoteStatus,
            ]
          );

          result.stats.sieg_only++;
          result.stats.created++;
          result.created_cnpjs.push(cnpj);
          console.log(`[SIEG_RECON] Criado registro para CNPJ ${cnpj} (${companyName || "sem nome"})`);
        } else if (local && !sieg) {
          // ── Caso: Existe localmente mas não no SIEG → marcar como local_only ─
          await conn.execute(
            `UPDATE certificates
             SET sieg_synced_at = NOW(),
                 sieg_source = 'local',
                 sieg_recon_status = 'local_only'
             WHERE id = ?`,
            [local.id]
          );

          result.stats.local_only++;
          result.stats.updated++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.stats.errors++;
        result.errors.push({ cnpj, error: msg });
        console.error(`[SIEG_RECON] Erro ao processar CNPJ ${cnpj}:`, msg);
      }
    }

    result.success = true;
    result.duration_ms = Date.now() - startTime;

    console.log(
      `[SIEG_RECON] Concluído em ${result.duration_ms}ms | ` +
      `local_ok=${result.stats.local_ok} | sieg_only=${result.stats.sieg_only} | ` +
      `local_only=${result.stats.local_only} | divergent=${result.stats.divergent} | ` +
      `criados=${result.stats.created} | erros=${result.stats.errors}`
    );
  } finally {
    await conn.end();
  }

  return result;
}
