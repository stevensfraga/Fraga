/**
 * sync-active-sieg.mjs
 * Sincroniza apenas certificados ATIVOS e VÁLIDOS no SIEG com o banco local.
 * Ignora expirados, divergentes e erros de senha.
 * 
 * Classificação:
 *   Grupo A: Ativo no SIEG + existe localmente → marcar como sincronizado
 *   Grupo B: Ativo no SIEG + sem arquivo local → manter registro remoto
 *   Grupo C: Existe local + não está no SIEG → adicionar à fila de envio
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
console.log(`📋 Certificados locais: ${localRows.length} (${localMap.size} CNPJs únicos)`);

// ─── Buscar certificados ATIVOS e VÁLIDOS no SIEG ───────────────────────────
async function fetchSiegActive() {
  const url = `${SIEG_BASE}/api/Certificado/ListarCertificados?api_key=${encodeURIComponent(SIEG_KEY)}&active=true`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

console.log("🔄 Buscando certificados ATIVOS no SIEG...");
let siegAll = [];
try {
  siegAll = await fetchSiegActive();
  console.log(`  ✅ Total: ${siegAll.length}`);
} catch (e) {
  console.error(`  ❌ Erro: ${e.message}`);
  await conn.end();
  process.exit(1);
}

if (siegAll.length === 0) {
  console.error("❌ Nenhum certificado ativo retornado pelo SIEG");
  await conn.end();
  process.exit(1);
}

// ─── Filtrar apenas os VÁLIDOS (não expirados) ────────────────────────────────
const now = new Date();
const siegValid = siegAll.filter(item => {
  const expiry = new Date(item.DataExpira || item.dataExpira || "");
  return expiry > now;
});

console.log(`\n📅 Certificados VÁLIDOS (não expirados): ${siegValid.length} de ${siegAll.length}`);
console.log(`   Expirados (ignorados): ${siegAll.length - siegValid.length}`);

// Mapear por CNPJ
const siegMap = new Map();
for (const item of siegValid) {
  const cnpj = String(item.CnpjCpf || item.cnpjCpf || "").replace(/\D/g, "");
  if (cnpj && !siegMap.has(cnpj)) siegMap.set(cnpj, item);
}

// ─── Classificar em 3 grupos ─────────────────────────────────────────────────
const groupA = []; // Ativo no SIEG + existe localmente
const groupB = []; // Ativo no SIEG + sem arquivo local
const groupC = []; // Existe local + não está no SIEG

// Grupo A + B: Para cada CNPJ ativo e válido no SIEG
for (const [cnpj, siegItem] of siegMap) {
  const localCert = localMap.get(cnpj);
  
  if (localCert) {
    // Grupo A: existe em ambos
    groupA.push({
      cnpj,
      company_name: localCert.company_name || siegItem.Nome,
      siegId: siegItem.Id,
      siegExpiry: siegItem.DataExpira,
      localStatus: localCert.sieg_status,
    });
  } else {
    // Grupo B: só no SIEG
    groupB.push({
      cnpj,
      company_name: siegItem.Nome,
      siegId: siegItem.Id,
      siegExpiry: siegItem.DataExpira,
    });
  }
}

// Grupo C: Para cada CNPJ local não encontrado no SIEG
for (const [cnpj, localCert] of localMap) {
  if (!siegMap.has(cnpj)) {
    groupC.push({
      cnpj,
      company_name: localCert.company_name,
      localStatus: localCert.sieg_status,
    });
  }
}

// ─── Atualizar banco: Grupo A → marcar como sincronizado ──────────────────────
console.log(`\n🔄 Atualizando Grupo A (${groupA.length} certificados)...`);
let groupAUpdated = 0;
for (const cert of groupA) {
  try {
    // Se ainda não foi enviado, marcar como sent
    if (cert.localStatus !== "sent") {
      await conn.execute(
        `UPDATE certificates SET
           sieg_status = 'sent',
           sieg_id = ?,
           sieg_sent_at = NOW(),
           sieg_error = NULL,
           sieg_source = 'reconciled',
           sieg_recon_status = 'local_ok',
           updated_at = NOW()
         WHERE cnpj = ? AND is_active = 1`,
        [cert.siegId, cert.cnpj]
      );
      groupAUpdated++;
    }
  } catch (e) {
    console.error(`  ❌ ${cert.cnpj}: ${e.message.substring(0, 80)}`);
  }
}
console.log(`  ✅ ${groupAUpdated} atualizados`);

// ─── Atualizar banco: Grupo B → manter como remoto ──────────────────────────
console.log(`\n🔄 Atualizando Grupo B (${groupB.length} certificados)...`);
let groupBCreated = 0;
for (const cert of groupB) {
  try {
    await conn.execute(
      `INSERT INTO certificates 
        (cnpj, company_name, status, is_active, sieg_id, sieg_status, sieg_remote_active, sieg_remote_expiry, sieg_remote_status, sieg_synced_at, sieg_source, sieg_recon_status, created_at, updated_at)
       VALUES (?, ?, 'unknown', 0, ?, 'sent', 1, ?, 'Ativo', NOW(), 'sieg_remote', 'sieg_only', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         sieg_id = VALUES(sieg_id),
         sieg_status = 'sent',
         sieg_remote_active = 1,
         sieg_remote_expiry = VALUES(sieg_remote_expiry),
         sieg_remote_status = 'Ativo',
         sieg_synced_at = NOW(),
         sieg_source = 'sieg_remote',
         sieg_recon_status = 'sieg_only',
         updated_at = NOW()`,
      [
        cert.cnpj,
        cert.company_name,
        cert.siegId,
        new Date(cert.siegExpiry),
      ]
    );
    groupBCreated++;
  } catch (e) {
    console.error(`  ❌ ${cert.cnpj}: ${e.message.substring(0, 80)}`);
  }
}
console.log(`  ✅ ${groupBCreated} criados/atualizados`);

// ─── Atualizar banco: Grupo C → marcar como pendente para envio ──────────────
console.log(`\n🔄 Atualizando Grupo C (${groupC.length} certificados)...`);
let groupCUpdated = 0;
for (const cert of groupC) {
  try {
    // Se não foi enviado, manter como pending
    if (cert.localStatus !== "sent") {
      await conn.execute(
        `UPDATE certificates SET
           sieg_status = 'pending',
           sieg_source = 'local',
           sieg_recon_status = 'local_only',
           updated_at = NOW()
         WHERE cnpj = ? AND is_active = 1 AND sieg_status IS NULL`,
        [cert.cnpj]
      );
      groupCUpdated++;
    }
  } catch (e) {
    console.error(`  ❌ ${cert.cnpj}: ${e.message.substring(0, 80)}`);
  }
}
console.log(`  ✅ ${groupCUpdated} atualizados`);

// ─── Resultado final ──────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(70));
console.log("📊 SINCRONIZAÇÃO DE CERTIFICADOS ATIVOS NO SIEG");
console.log("=".repeat(70));

console.log(`\n🌐 CERTIFICADOS ATIVOS E VÁLIDOS NO SIEG: ${siegValid.length}`);
console.log(`   (Expirados ignorados: ${siegAll.length - siegValid.length})`);

console.log(`\n📋 GRUPO A — Ativo no SIEG + Existe Localmente: ${groupA.length}`);
console.log(`   Ação: Marcar como sincronizado (sieg_status = sent)`);
console.log(`   Resultado: ${groupAUpdated} atualizados`);
if (groupA.length > 0) {
  console.log(`   Exemplos:`);
  groupA.slice(0, 3).forEach(c => 
    console.log(`     • ${c.cnpj} — ${c.company_name} (status local: ${c.localStatus})`)
  );
}

console.log(`\n🌐 GRUPO B — Ativo no SIEG + Sem Arquivo Local: ${groupB.length}`);
console.log(`   Ação: Manter registro remoto (não enviar ao SIEG)`);
console.log(`   Resultado: ${groupBCreated} criados/atualizados`);
if (groupB.length > 0) {
  console.log(`   Exemplos:`);
  groupB.slice(0, 3).forEach(c => 
    console.log(`     • ${c.cnpj} — ${c.company_name} (expira ${new Date(c.siegExpiry).toLocaleDateString('pt-BR')})`)
  );
}

console.log(`\n💾 GRUPO C — Existe Localmente + Não está no SIEG: ${groupC.length}`);
console.log(`   Ação: Adicionar à fila de envio (sieg_status = pending)`);
console.log(`   Resultado: ${groupCUpdated} atualizados`);
if (groupC.length > 0) {
  console.log(`   Exemplos:`);
  groupC.slice(0, 3).forEach(c => 
    console.log(`     • ${c.cnpj} — ${c.company_name} (status local: ${c.localStatus})`)
  );
}

// ─── Distribuição final no banco ─────────────────────────────────────────────
const [distRows] = await conn.execute(
  "SELECT sieg_status, COUNT(*) as cnt FROM certificates WHERE is_active = 1 GROUP BY sieg_status ORDER BY cnt DESC"
);
console.log("\n📈 Distribuição final no banco (is_active=1):");
for (const row of distRows) {
  console.log(`   ${row.sieg_status || "null"}: ${row.cnt}`);
}

// ─── Verificar pendentes para envio ──────────────────────────────────────────
const [pendingRows] = await conn.execute(
  "SELECT COUNT(*) as cnt FROM certificates WHERE is_active = 1 AND sieg_status = 'pending'"
);
console.log(`\n⏳ Certificados pendentes para envio ao SIEG: ${pendingRows[0].cnt}`);

// ─── Verificar já sincronizados ─────────────────────────────────────────────
const [sentRows] = await conn.execute(
  "SELECT COUNT(*) as cnt FROM certificates WHERE is_active = 1 AND sieg_status = 'sent'"
);
console.log(`✅ Certificados já sincronizados no SIEG: ${sentRows[0].cnt}`);

await conn.end();
console.log("\n✅ Sincronização de certificados ativos concluída.");
