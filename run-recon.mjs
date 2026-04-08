/**
 * run-recon.mjs
 * Executa a reconciliação SIEG diretamente, sem passar pelo servidor HTTP.
 * Usa o mesmo código do job reconcileSiegCertificates().
 */
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL;
const SIEG_KEY = process.env.SIEG_API_KEY;
const SIEG_BASE = "https://api.sieg.com";

if (!DB_URL) { console.error("DATABASE_URL não configurada"); process.exit(1); }
if (!SIEG_KEY) { console.error("SIEG_API_KEY não configurada"); process.exit(1); }

// ─── Conectar ao banco ────────────────────────────────────────────────────────
const conn = await mysql.createConnection(DB_URL);
console.log("✅ Conectado ao banco");

// ─── Buscar certificados locais ───────────────────────────────────────────────
const [localRows] = await conn.execute(
  "SELECT id, cnpj, company_name, sieg_status, sieg_id, status, is_active FROM certificates WHERE is_active = 1"
);
const localMap = new Map();
for (const row of localRows) {
  const cnpj = String(row.cnpj).replace(/\D/g, "");
  if (!localMap.has(cnpj)) localMap.set(cnpj, row);
}
console.log(`📋 Certificados locais (is_active=1): ${localRows.length} (${localMap.size} CNPJs únicos)`);

// ─── Buscar certificados do SIEG ──────────────────────────────────────────────
async function fetchSieg(active) {
  const url = `${SIEG_BASE}/api/Certificado/ListarCertificados?api_key=${encodeURIComponent(SIEG_KEY)}&active=${active}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.substring(0, 100)}`);
  }
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

console.log("🔄 Buscando certificados ativos no SIEG...");
let siegAtivos = [];
let siegInativos = [];

try {
  siegAtivos = await fetchSieg(true);
  console.log(`  ✅ Ativos: ${siegAtivos.length}`);
} catch (e) {
  console.error(`  ❌ Erro ao buscar ativos: ${e.message}`);
}

try {
  console.log("🔄 Buscando certificados inativos no SIEG...");
  siegInativos = await fetchSieg(false);
  console.log(`  ✅ Inativos: ${siegInativos.length}`);
} catch (e) {
  console.error(`  ❌ Erro ao buscar inativos: ${e.message}`);
}

const siegAll = [...siegAtivos, ...siegInativos];
console.log(`📊 Total SIEG: ${siegAll.length} (${siegAtivos.length} ativos + ${siegInativos.length} inativos)`);

if (siegAll.length === 0) {
  console.error("❌ Nenhum certificado retornado pelo SIEG. Abortando reconciliação.");
  await conn.end();
  process.exit(1);
}

// Mostrar campos disponíveis
if (siegAll.length > 0) {
  console.log("📌 Campos SIEG disponíveis:", Object.keys(siegAll[0]).join(", "));
  console.log("📌 Exemplo (primeiro):", JSON.stringify(siegAll[0]).substring(0, 250));
}

// ─── Cruzar por CNPJ ─────────────────────────────────────────────────────────
const siegMap = new Map();
for (const item of siegAll) {
  const cnpj = String(item.CnpjCpf || item.cnpjCpf || "").replace(/\D/g, "");
  if (cnpj && !siegMap.has(cnpj)) siegMap.set(cnpj, item);
}
console.log(`\n🔗 CNPJs únicos no SIEG: ${siegMap.size}`);

// ─── Reconciliar ─────────────────────────────────────────────────────────────
const stats = { local_ok: 0, sieg_only: 0, local_only: 0, divergent: 0, updated: 0, created: 0, errors: 0 };
const now = new Date();
const sieg_only_cnpjs = [];
const divergent_cnpjs = [];
const errors = [];

// 1. Para cada CNPJ no SIEG, cruzar com local
for (const [cnpj, siegItem] of siegMap) {
  const localCert = localMap.get(cnpj);
  
  const siegActive = !!(siegItem.Ativo || siegItem.ativo);
  const siegExpiry = siegItem.DataExpira || siegItem.DataVencimento || siegItem.dataExpira || null;
  const siegStatus = siegItem.Deletado ? "Deletado" : (siegActive ? "Ativo" : "Inativo");
  const siegId = siegItem.Id || siegItem.id || null;
  const siegSource = localCert ? "reconciled" : "sieg_remote";
  
  let reconStatus;
  
  if (!localCert) {
    // Existe no SIEG mas não localmente
    reconStatus = "sieg_only";
    stats.sieg_only++;
    sieg_only_cnpjs.push({ cnpj, siegId, siegStatus, siegExpiry });
    
    // Criar registro mínimo local
    try {
      await conn.execute(
        `INSERT INTO certificates 
          (cnpj, company_name, status, is_active, sieg_id, sieg_status, sieg_remote_active, sieg_remote_expiry, sieg_remote_status, sieg_synced_at, sieg_source, sieg_recon_status, created_at, updated_at)
         VALUES (?, ?, 'unknown', 0, ?, 'sent', ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           sieg_id = VALUES(sieg_id),
           sieg_remote_active = VALUES(sieg_remote_active),
           sieg_remote_expiry = VALUES(sieg_remote_expiry),
           sieg_remote_status = VALUES(sieg_remote_status),
           sieg_synced_at = VALUES(sieg_synced_at),
           sieg_source = VALUES(sieg_source),
           sieg_recon_status = VALUES(sieg_recon_status),
           updated_at = NOW()`,
        [
          cnpj,
          siegItem.Nome || siegItem.nome || cnpj,
          String(siegId || ""),
          siegActive ? 1 : 0,
          siegExpiry ? new Date(siegExpiry) : null,
          siegStatus,
          now,
          siegSource,
          reconStatus,
        ]
      );
      stats.created++;
    } catch (e) {
      errors.push({ cnpj, error: e.message.substring(0, 100) });
      stats.errors++;
    }
    
  } else {
    // Existe em ambos — verificar divergência
    const localSiegId = String(localCert.sieg_id || "");
    const expectedId = `34316-${cnpj}`;
    const hasIdMatch = localSiegId === String(siegId || "") || localSiegId === expectedId;
    const localSent = localCert.sieg_status === "sent";
    
    if (localSent && hasIdMatch) {
      reconStatus = "local_ok";
      stats.local_ok++;
    } else if (localSent && !hasIdMatch) {
      reconStatus = "divergent";
      stats.divergent++;
      divergent_cnpjs.push({ cnpj, localSiegId, siegId: String(siegId || ""), localStatus: localCert.sieg_status });
    } else {
      // Local não enviado mas existe no SIEG
      reconStatus = "divergent";
      stats.divergent++;
      divergent_cnpjs.push({ cnpj, localStatus: localCert.sieg_status, siegStatus });
    }
    
    // Atualizar campos de reconciliação
    try {
      await conn.execute(
        `UPDATE certificates SET
           sieg_remote_active = ?,
           sieg_remote_expiry = ?,
           sieg_remote_status = ?,
           sieg_synced_at = ?,
           sieg_source = ?,
           sieg_recon_status = ?,
           updated_at = NOW()
         WHERE cnpj = ? AND is_active = 1`,
        [
          siegActive ? 1 : 0,
          siegExpiry ? new Date(siegExpiry) : null,
          siegStatus,
          now,
          siegSource,
          reconStatus,
          cnpj,
        ]
      );
      stats.updated++;
    } catch (e) {
      errors.push({ cnpj, error: e.message.substring(0, 100) });
      stats.errors++;
    }
  }
}

// 2. Para cada CNPJ local sem correspondência no SIEG
for (const [cnpj, localCert] of localMap) {
  if (!siegMap.has(cnpj)) {
    stats.local_only++;
    try {
      await conn.execute(
        `UPDATE certificates SET
           sieg_recon_status = 'local_only',
           sieg_synced_at = ?,
           sieg_source = 'local',
           updated_at = NOW()
         WHERE cnpj = ? AND is_active = 1`,
        [now, cnpj]
      );
      stats.updated++;
    } catch (e) {
      errors.push({ cnpj, error: e.message.substring(0, 100) });
      stats.errors++;
    }
  }
}

// ─── Resultado final ──────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
console.log("📊 RESULTADO DA RECONCILIAÇÃO SIEG");
console.log("=".repeat(60));
console.log(`\n✅ Local + SIEG OK:     ${stats.local_ok}`);
console.log(`🌐 Só SIEG:             ${stats.sieg_only}`);
console.log(`💾 Só Local:            ${stats.local_only}`);
console.log(`⚠️  Divergente:          ${stats.divergent}`);
console.log(`❌ Erros:               ${stats.errors}`);
console.log(`\n📝 Registros atualizados: ${stats.updated}`);
console.log(`➕ Registros criados:    ${stats.created}`);

// Verificar pendentes
const [pendingRows] = await conn.execute(
  "SELECT COUNT(*) as cnt FROM certificates WHERE is_active = 1 AND (sieg_status = 'pending' OR sieg_status IS NULL)"
);
console.log(`⏳ Pendentes para envio: ${pendingRows[0].cnt}`);

if (sieg_only_cnpjs.length > 0) {
  console.log(`\n🌐 CNPJs só no SIEG (primeiros 10):`);
  sieg_only_cnpjs.slice(0, 10).forEach(c => 
    console.log(`   ${c.cnpj} | ID: ${c.siegId} | Status: ${c.siegStatus} | Expira: ${c.siegExpiry || "N/A"}`)
  );
}

if (divergent_cnpjs.length > 0) {
  console.log(`\n⚠️  CNPJs divergentes (primeiros 5):`);
  divergent_cnpjs.slice(0, 5).forEach(c => 
    console.log(`   ${c.cnpj} | Local: ${c.localStatus || "?"} | SIEG: ${c.siegStatus || "?"}`)
  );
}

if (errors.length > 0) {
  console.log(`\n❌ Primeiros erros:`);
  errors.slice(0, 5).forEach(e => console.log(`   ${e.cnpj}: ${e.error}`));
}

// ─── Distribuição final no banco ─────────────────────────────────────────────
const [distRows] = await conn.execute(
  "SELECT sieg_recon_status, COUNT(*) as cnt FROM certificates WHERE is_active = 1 GROUP BY sieg_recon_status ORDER BY cnt DESC"
);
console.log("\n📈 Distribuição final no banco (is_active=1):");
for (const row of distRows) {
  console.log(`   ${row.sieg_recon_status || "null"}: ${row.cnt}`);
}

await conn.end();
console.log("\n✅ Reconciliação concluída.");
