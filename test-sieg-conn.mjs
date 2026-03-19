// test-sieg-conn.mjs — Testa conectividade com a API SIEG
const key = process.env.SIEG_API_KEY;
console.log("SIEG_API_KEY presente:", !!key, key ? "("+key.substring(0,8)+"...)" : "(vazia)");

if (!key) {
  console.log("ERRO: SIEG_API_KEY não configurada no ambiente");
  process.exit(1);
}

try {
  const url = `https://api.sieg.com/api/Certificado/ListarCertificados?api_key=${key}`;
  console.log("Testando:", url.replace(key, "***"));
  
  const resp = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  
  console.log("HTTP Status:", resp.status, resp.statusText);
  const text = await resp.text();
  
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  
  if (parsed && Array.isArray(parsed)) {
    console.log("Total certificados no SIEG:", parsed.length);
    if (parsed.length > 0) {
      console.log("Primeiro item:", JSON.stringify(parsed[0]).substring(0, 200));
    }
  } else {
    console.log("Resposta (200 chars):", text.substring(0, 200));
  }
} catch (err) {
  console.log("Erro de conexão:", err.message);
  console.log("Causa:", err.cause?.message || "(sem causa)");
}
