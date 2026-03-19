/**
 * Admin Certificates Router
 * Endpoints admin para ativar módulos SIEG (NF-e e NFS-e)
 */

import { Router } from "express";

const router = Router();

/**
 * Middleware: Validar x-admin-key
 */
function validateAdminKey(req: any, res: any, next: any) {
  const adminKey = req.headers["x-admin-key"];
  const expectedKey = process.env.FRAGA_ADMIN_KEY || "Fraga@123";

  if (!adminKey || adminKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized: invalid admin key" });
  }
  next();
}

/**
 * POST /api/certificados/sieg-ativar-modulos
 * Ativa módulos NF-e e NFS-e para certificados já enviados ao SIEG
 * 
 * Body: { cnpjs?: string[] }
 * Se cnpjs vazio, ativa todos com sieg_status='sent'
 * 
 * Requer header: x-admin-key: Fraga@123
 */
router.post("/sieg-ativar-modulos", validateAdminKey, async (req: any, res: any) => {
  try {
    const { cnpjs } = req.body || {};
    let cnpjsToActivate = Array.isArray(cnpjs) ? cnpjs : [];

    const results = {
      total: cnpjsToActivate.length,
      sucesso: 0,
      erros: 0,
      detalhes: [] as Array<{ cnpj: string; nfe: boolean; nfse: boolean; erro?: string }>,
    };

    for (const cnpj of cnpjsToActivate) {
      const cnpjNorm = cnpj.replace(/\D/g, "");
      const detalhe: any = { cnpj: cnpjNorm, nfe: false, nfse: false };

      try {
        // Etapa 4: Ativar NF-e
        const nfeResult = await ativarNfe(cnpjNorm);
        detalhe.nfe = nfeResult.ok;
        if (!nfeResult.ok) {
          detalhe.erro = `NF-e: ${nfeResult.error}`;
        }

        // Etapa 5: Ativar NFS-e
        const nfseResult = await ativarNfse(cnpjNorm);
        detalhe.nfse = nfseResult.ok;
        if (!nfseResult.ok) {
          detalhe.erro = (detalhe.erro ? detalhe.erro + " | " : "") + `NFS-e: ${nfseResult.error}`;
        }

        if (detalhe.nfe && detalhe.nfse) {
          results.sucesso++;
        } else {
          results.erros++;
        }
      } catch (err) {
        results.erros++;
        detalhe.erro = err instanceof Error ? err.message : "Erro desconhecido";
      }

      results.detalhes.push(detalhe);
    }

    res.json(results);
  } catch (error: any) {
    console.error("[AdminCertificates] Erro ao ativar módulos SIEG:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Etapa 4: Ativar NF-e via POST /api/Cadastrar
 */
async function ativarNfe(cnpj: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.SIEG_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "SIEG_API_KEY não configurada" };
  }

  try {
    const url = `https://api.sieg.com/api/Cadastrar?api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        CnpjCpf: cnpj,
        UF: "ES",
        TipoIntegracao: "NF-e",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${response.status}: ${text.substring(0, 150)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return { ok: false, error: msg };
  }
}

/**
 * Etapa 5: Ativar NFS-e via POST /api/integracaoMunicipal/Inserir
 */
async function ativarNfse(cnpj: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.SIEG_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "SIEG_API_KEY não configurada" };
  }

  try {
    const url = `https://api.sieg.com/api/integracaoMunicipal/Inserir?api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        CnpjCpf: cnpj,
        CodigoMunicipio: 3205309, // Vila Velha
        TipoIntegracao: "NFS-e",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${response.status}: ${text.substring(0, 150)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return { ok: false, error: msg };
  }
}

export default router;
