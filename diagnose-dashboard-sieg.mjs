import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { listarCertificadosSieg } from "./server/services/siegService.js";

const DB_URL = process.env.DATABASE_URL;
const CERT_PATH = process.env.CERTIFICATES_PATH || "/data/certificados";

const conn = await mysql.createConnection(DB_URL);

// Buscar certificados válidos do dashboard
const [dashboardCerts] = await conn.execute(`
  SELECT 
    id, cnpj, company_name, status, valid_from, valid_to, 
    file_path, file_name, sieg_status, sieg_remote_active, sieg_remote_expiry
  FROM certificates 
  WHERE is_active = 1 AND status = 'valid'
  ORDER BY cnpj
`);

console.log(`\n[DIAGNÓSTICO] ${dashboardCerts.length} certificados válidos encontrados no dashboard\n`);

// Buscar certificados do SIEG
let siegCerts = [];
try {
  const result = await listarCertificadosSieg();
  siegCerts = Array.isArray(result) ? result : (result?.data || []);
  console.log(`[DIAGNÓSTICO] ${siegCerts.length} certificados encontrados no SIEG\n`);
} catch (e) {
  console.error("Erro ao buscar SIEG:", e.message);
  await conn.end();
  process.exit(1);
}

// Mapa de SIEG por CNPJ
const siegMap = new Map();
for (const cert of siegCerts) {
  const cnpj = String(cert.CnpjCpf || "").replace(/\D/g, "");
  if (cnpj && !siegMap.has(cnpj)) {
    siegMap.set(cnpj, cert);
  }
}

// Classificar certificados
const groups = {
  elegivel: [],
  sem_arquivo: [],
  senha_incorreta: [],
  expirado_sieg: [],
  outro_bloqueio: [],
};

for (const cert of dashboardCerts) {
  const cnpj = String(cert.cnpj).replace(/\D/g, "");
  const siegCert = siegMap.get(cnpj);

  // Verificar se tem arquivo
  let hasFile = false;
  if (cert.file_path && fs.existsSync(cert.file_path)) {
    hasFile = true;
  } else {
    try {
      const files = fs.readdirSync(CERT_PATH);
      const found = files.find(f => f.includes(cnpj) && (f.endsWith(".pfx") || f.endsWith(".p12")));
      if (found) hasFile = true;
    } catch (e) {}
  }

  if (!hasFile) {
    groups.sem_arquivo.push({ cnpj, company_name: cert.company_name, valid_to: cert.valid_to });
    continue;
  }

  // Verificar status no SIEG
  if (!siegCert) {
    groups.outro_bloqueio.push({ cnpj, company_name: cert.company_name, motivo: "Não encontrado no SIEG" });
    continue;
  }

  // Verificar expiração no SIEG
  const expiry = new Date(siegCert.DataExpira || "");
  if (expiry < new Date()) {
    groups.expirado_sieg.push({ cnpj, company_name: cert.company_name, expiry });
    continue;
  }

  // Verificar se está ativo e elegível
  if (siegCert.Ativo && cert.sieg_status !== "sent") {
    groups.elegivel.push({ cnpj, company_name: cert.company_name, sieg_status: cert.sieg_status });
  } else if (!siegCert.Ativo) {
    groups.outro_bloqueio.push({ cnpj, company_name: cert.company_name, motivo: "Inativo no SIEG" });
  } else {
    groups.outro_bloqueio.push({ cnpj, company_name: cert.company_name, motivo: "Já enviado ao SIEG" });
  }
}

// Gerar relatório
console.log("================================================================================");
console.log("📊 DIAGNÓSTICO DE RECONCILIAÇÃO — DASHBOARD vs SIEG");
console.log("================================================================================\n");

console.log("RESUMO EXECUTIVO:");
console.log(`  Total no dashboard: ${dashboardCerts.length}`);
console.log(`  ✅ Elegíveis para ativação: ${groups.elegivel.length}`);
console.log(`  📁 Sem arquivo no servidor: ${groups.sem_arquivo.length}`);
console.log(`  🔐 Senha incorreta: ${groups.senha_incorreta.length}`);
console.log(`  ⏳ Expirados no SIEG: ${groups.expirado_sieg.length}`);
console.log(`  🚫 Outro bloqueio: ${groups.outro_bloqueio.length}`);
console.log(`\nTOTAL EXPLICADO: ${groups.elegivel.length + groups.sem_arquivo.length + groups.senha_incorreta.length + groups.expirado_sieg.length + groups.outro_bloqueio.length}\n`);

console.log("================================================================================");
console.log("GRUPO 1: ELEGÍVEIS PARA ATIVAÇÃO IMEDIATA (" + groups.elegivel.length + ")");
console.log("================================================================================");
groups.elegivel.slice(0, 10).forEach(c => console.log(`  ${c.cnpj} — ${c.company_name}`));
if (groups.elegivel.length > 10) console.log(`  ... e mais ${groups.elegivel.length - 10}`);

console.log("\n================================================================================");
console.log("GRUPO 2: SEM ARQUIVO NO SERVIDOR (" + groups.sem_arquivo.length + ")");
console.log("================================================================================");
groups.sem_arquivo.slice(0, 10).forEach(c => console.log(`  ${c.cnpj} — ${c.company_name}`));
if (groups.sem_arquivo.length > 10) console.log(`  ... e mais ${groups.sem_arquivo.length - 10}`);

console.log("\n================================================================================");
console.log("GRUPO 3: SENHA INCORRETA (" + groups.senha_incorreta.length + ")");
console.log("================================================================================");
groups.senha_incorreta.slice(0, 10).forEach(c => console.log(`  ${c.cnpj} — ${c.company_name}`));
if (groups.senha_incorreta.length > 10) console.log(`  ... e mais ${groups.senha_incorreta.length - 10}`);

console.log("\n================================================================================");
console.log("GRUPO 4: EXPIRADOS NO SIEG (" + groups.expirado_sieg.length + ")");
console.log("================================================================================");
groups.expirado_sieg.slice(0, 10).forEach(c => console.log(`  ${c.cnpj} — ${c.company_name} (expira ${c.expiry.toLocaleDateString('pt-BR')})`));
if (groups.expirado_sieg.length > 10) console.log(`  ... e mais ${groups.expirado_sieg.length - 10}`);

console.log("\n================================================================================");
console.log("GRUPO 5: OUTRO BLOQUEIO (" + groups.outro_bloqueio.length + ")");
console.log("================================================================================");
groups.outro_bloqueio.slice(0, 10).forEach(c => console.log(`  ${c.cnpj} — ${c.company_name} (${c.motivo})`));
if (groups.outro_bloqueio.length > 10) console.log(`  ... e mais ${groups.outro_bloqueio.length - 10}`);

console.log("\n================================================================================");
console.log("🎯 PRÓXIMOS PASSOS");
console.log("================================================================================");
console.log(`\n1. ATIVAR IMEDIATAMENTE (${groups.elegivel.length} certificados)`);
console.log(`   → Rodar: GET /api/admin/sieg-enable-consultation-all`);
console.log(`\n2. SINCRONIZAR ARQUIVO (${groups.sem_arquivo.length} certificados)`);
console.log(`   → Copiar arquivos para /data/certificados/`);
console.log(`   → Depois rodar ativação novamente`);
console.log(`\n3. CORRIGIR SENHA (${groups.senha_incorreta.length} certificados)`);
console.log(`   → Obter senhas corretas dos proprietários`);
console.log(`   → Atualizar no servidor`);
console.log(`   → Depois rodar ativação novamente`);
console.log(`\n4. RENOVAR CERTIFICADO (${groups.expirado_sieg.length} certificados)`);
console.log(`   → Contatar proprietários para renovação`);
console.log(`\n5. INVESTIGAR BLOQUEIOS (${groups.outro_bloqueio.length} certificados)`);
console.log(`   → Verificar motivo específico para cada um`);

await conn.end();
