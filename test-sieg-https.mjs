// test-sieg-https.mjs — Testa SIEG com https nativo (sem fetch)
import https from "node:https";
import { URL } from "node:url";

const key = process.env.SIEG_API_KEY;
const urlStr = `https://api.sieg.com/api/Certificado/ListarCertificados?api_key=${encodeURIComponent(key)}&active=true`;
const parsed = new URL(urlStr);

console.log("Testando via https nativo:", parsed.hostname, parsed.pathname);

function httpsGet(urlStr, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "GET",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      timeout: timeoutMs,
      rejectUnauthorized: false, // Ignora erros de certificado SSL
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

try {
  const start = Date.now();
  const result = await httpsGet(urlStr, 45000);
  console.log("HTTP Status:", result.status, "Tempo:", Date.now() - start, "ms");
  
  try {
    const arr = JSON.parse(result.data);
    console.log("Total ativos:", Array.isArray(arr) ? arr.length : "não é array");
    if (Array.isArray(arr) && arr.length > 0) {
      console.log("Campos:", Object.keys(arr[0]).join(", "));
      console.log("Primeiro:", JSON.stringify(arr[0]).substring(0, 250));
    } else {
      console.log("Resposta:", result.data.substring(0, 200));
    }
  } catch {
    console.log("Resposta raw:", result.data.substring(0, 200));
  }
} catch (err) {
  console.log("Erro:", err.message);
}
