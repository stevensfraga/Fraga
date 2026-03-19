/**
 * siegService.ts
 * Integração com a API SIEG para upload automático de certificados digitais.
 *
 * Endpoints usados:
 *   POST https://api.sieg.com/api/Certificado/Registrar  — cadastrar certificado
 *   POST https://api.sieg.com/api/Certificado/Editar     — atualizar certificado existente
 *   GET  https://api.sieg.com/api/Certificado/ListarCertificados — listar certificados
 *
 * Autenticação: query param ?api_key={SIEG_API_KEY}
 * O certificado deve ser enviado em Base64 no campo "Certificado".
 *
 * Descobertas técnicas (validadas em produção):
 *   - /Editar: campo correto é "CertificadoId" (não "Id"), valor = "34316-CNPJ"
 *   - /Registrar: campo "UfCertificado" deve ser 32 (código IBGE do ES) para novos CNPJs
 *   - ConsultaNfse: false (evita erro "Erro ao buscar UF" para CNPJs municipais)
 *   - ConsultaNfce: false (apenas RS suporta NFC-e)
 *   - Senhas testadas em ordem: abc123, Abcd@1234, Fraga@123
 */
import { ENV } from "../_core/env";

const SIEG_BASE_URL = "https://api.sieg.com";

interface SiegCertificadoRequest {
  Nome: string;
  CnpjCpf: string;
  Certificado: string;       // Base64 do PFX
  SenhaCertificado: string;
  TipoCertificado: string;   // "Pfx" ou "P12"
  ConsultaNfe: boolean;
  ConsultaCte: boolean;
  ConsultaNfse: boolean;     // false para evitar erro de UF municipal
  ConsultaNfce: boolean;     // false (apenas RS)
  BaixarCancelados: boolean;
  ConsultaNoturna: boolean;
  IntegracaoEstadual: boolean;
  UfCertificado?: number;    // 32 = ES (necessário para novos CNPJs)
  // Campos para /Editar
  CertificadoId?: string;    // ID do certificado no SIEG (formato "34316-CNPJ")
}

interface SiegCertificadoResponse {
  Id: string;
  Status: string;
  Message?: string;
  Errors?: string[];
}

interface SiegCertificadoListItem {
  Id: string;
  Nome: string;
  CnpjCpf: string;
  UfCertificado?: number;
  DataExpira?: string;
  ConsultaNoturna?: boolean;
  Ativo?: boolean;
  Deletado?: boolean;
  // campos legados
  Status?: string;
  DataVencimento?: string;
  TipoCertificado?: string;
}

/**
 * Verifica se um CNPJ/CPF é CPF (pessoa física — 11 dígitos).
 */
function isCpf(cnpjCpf: string): boolean {
  return cnpjCpf.replace(/\D/g, "").length === 11;
}

/**
 * Faz o POST para um endpoint SIEG e retorna o resultado parseado.
 */
async function postToSieg(
  endpoint: string,
  body: SiegCertificadoRequest,
  apiKey: string
): Promise<{ ok: boolean; data: SiegCertificadoResponse | null; rawText: string; httpStatus: number }> {
  const url = `${endpoint}?api_key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const rawText = await response.text();
  let data: SiegCertificadoResponse | null = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    // Resposta não é JSON
  }

  return { ok: response.ok, data, rawText, httpStatus: response.status };
}

/**
 * Verifica se a resposta do SIEG indica que o CNPJ já está cadastrado.
 */
function isCnpjJaCadastrado(rawText: string, data: SiegCertificadoResponse | null): boolean {
  const text = rawText.toLowerCase();
  if (text.includes("cnpj deste certificado já foi cadastrado") ||
      text.includes("cnpj deste certificado ja foi cadastrado")) {
    return true;
  }
  if (data?.Errors) {
    return data.Errors.some(e =>
      e.toLowerCase().includes("cnpj deste certificado já foi cadastrado") ||
      e.toLowerCase().includes("cnpj deste certificado ja foi cadastrado")
    );
  }
  return false;
}

/**
 * Faz upload (registro ou atualização) de um certificado digital no SIEG.
 * 
 * Lógica:
 * 1. Se siegId fornecido → tenta /Editar com CertificadoId
 * 2. Se não → tenta /Registrar com UfCertificado=32
 * 3. Se /Registrar retornar "CNPJ já cadastrado" → constrói ID (34316-CNPJ) e tenta /Editar
 *
 * @param cnpj CNPJ/CPF da empresa (apenas dígitos)
 * @param companyName Nome da empresa
 * @param pfxBuffer Buffer do arquivo PFX/P12
 * @param password Senha do certificado
 * @param tipoCertificado "Pfx" ou "P12" (default: "Pfx")
 * @param siegId Se informado, atualiza o certificado existente com este ID
 */
export async function uploadCertificadoSieg(
  cnpj: string,
  companyName: string,
  pfxBuffer: Buffer,
  password: string,
  tipoCertificado: "Pfx" | "P12" = "Pfx",
  siegId?: string
): Promise<{ success: boolean; siegId?: string; status?: string; error?: string }> {
  const apiKey = ENV.siegApiKey;
  if (!apiKey) {
    return { success: false, error: "SIEG_API_KEY não configurada" };
  }

  // Normalizar CNPJ (apenas dígitos)
  const cnpjNorm = cnpj.replace(/\D/g, "");

  // Converter PFX para Base64
  const pfxBase64 = pfxBuffer.toString("base64");

  // Payload base — ConsultaNfse controlado pela flag USE_NFSE_NACIONAL
  // Se habilitado, captura NFSe via modelo nacional (ADN) sem depender de portais municipais
  const buildBody = (certificadoId?: string): SiegCertificadoRequest => ({
    Nome: companyName || cnpjNorm,
    CnpjCpf: cnpjNorm,
    Certificado: pfxBase64,
    SenhaCertificado: password,
    TipoCertificado: tipoCertificado,
    ConsultaNfe: true,
    ConsultaCte: true,
    ConsultaNfse: ENV.useNfseNacional,  // true se USE_NFSE_NACIONAL=true (captura via ADN)
    ConsultaNfce: false,                // false (apenas RS suporta NFC-e)
    BaixarCancelados: true,
    ConsultaNoturna: ENV.useNfseNacional,  // true se usando ADN
    IntegracaoEstadual: false,
    UfCertificado: 32,                  // Código IBGE do ES (necessário para novos CNPJs)
    ...(certificadoId ? { CertificadoId: certificadoId } : {}),
  });

  try {
    // Log estruturado do payload fiscal
    const payloadLog = {
      timestamp: new Date().toISOString(),
      operation: siegId ? 'EDIT' : 'REGISTER',
      cnpj: cnpjNorm,
      company: companyName,
      fiscal_config: {
        ConsultaNfe: true,
        ConsultaCte: true,
        ConsultaNfse: ENV.useNfseNacional,
        ConsultaNfce: false,
        BaixarCancelados: true,
        ConsultaNoturna: ENV.useNfseNacional,
        IntegracaoEstadual: false,
        UfCertificado: 32,
      },
      use_nfse_nacional: ENV.useNfseNacional,
    };
    console.log('[SIEG_PAYLOAD_LOG]', JSON.stringify(payloadLog));

    // ── Passo 1: Se já temos o siegId, tentar /Editar com CertificadoId ──
    if (siegId) {
      const editEndpoint = `${SIEG_BASE_URL}/api/Certificado/Editar`;
      const result = await postToSieg(editEndpoint, buildBody(siegId), apiKey);
      if (result.ok) {
        return {
          success: true,
          siegId: result.data?.Id || siegId,
          status: result.data?.Status,
        };
      }
      // Se /Editar falhou, retornar erro
      console.log('[SIEG_ERROR_DETAIL] Editar falhou:', {
        cnpj: cnpjNorm,
        company: companyName,
        siegId: siegId,
        httpStatus: result.httpStatus,
        rawResponse: result.rawText,
        parsedData: result.data,
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        error: result.rawText.substring(0, 300),
      };
    }

    // ── Passo 2: Tentar /Registrar ──
    const registrarEndpoint = `${SIEG_BASE_URL}/api/Certificado/Registrar`;
    const regResult = await postToSieg(registrarEndpoint, buildBody(), apiKey);

    // LOG DETALHADO DE ERRO
    if (!regResult.ok) {
      console.log('[SIEG_ERROR_DETAIL] Registrar falhou:', {
        cnpj: cnpjNorm,
        company: companyName,
        httpStatus: regResult.httpStatus,
        rawResponse: regResult.rawText,
        parsedData: regResult.data,
        timestamp: new Date().toISOString(),
      });
    }

    if (regResult.ok) {
      return {
        success: true,
        siegId: regResult.data?.Id,
        status: regResult.data?.Status,
      };
    }

    // ── Passo 3: Se "CNPJ já cadastrado", construir ID e tentar /Editar ──
    if (isCnpjJaCadastrado(regResult.rawText, regResult.data)) {
      // O SIEG usa o formato "34316-CNPJ" como ID
      const constructedId = `34316-${cnpjNorm}`;
      
      // Tentar com ID construído primeiro
      const editEndpoint = `${SIEG_BASE_URL}/api/Certificado/Editar`;
      const editResult = await postToSieg(editEndpoint, buildBody(constructedId), apiKey);
      if (editResult.ok) {
        return {
          success: true,
          siegId: editResult.data?.Id || constructedId,
          status: editResult.data?.Status,
        };
      }
      
      // Fallback: buscar o ID real na listagem
      const listaResult = await listarCertificadosSieg();
      if (listaResult.success && listaResult.data) {
        const existing = listaResult.data.find(
          (c) => c.CnpjCpf?.replace(/\D/g, "") === cnpjNorm
        );
        if (existing?.Id) {
          const editResult2 = await postToSieg(editEndpoint, buildBody(existing.Id), apiKey);
          if (editResult2.ok) {
            return {
              success: true,
              siegId: editResult2.data?.Id || existing.Id,
              status: editResult2.data?.Status,
            };
          }
          return {
            success: false,
            error: `Editar falhou: ${editResult2.rawText.substring(0, 200)}`,
          };
        }
      }
      // Não encontrou o ID na listagem
      return {
        success: false,
        error: `CNPJ já cadastrado mas não encontrado na listagem: ${regResult.rawText.substring(0, 200)}`,
      };
    }

    // Outro erro
    console.log('[SIEG_ERROR_DETAIL] Outro erro no Registrar:', {
      cnpj: cnpjNorm,
      company: companyName,
      httpStatus: regResult.httpStatus,
      rawResponse: regResult.rawText,
      parsedData: regResult.data,
      timestamp: new Date().toISOString(),
    });
    return {
      success: false,
      error: `HTTP ${regResult.httpStatus}: ${regResult.rawText.substring(0, 200)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Lista todos os certificados cadastrados no SIEG (ativos e inativos).
 */
export async function listarCertificadosSieg(): Promise<{
  success: boolean;
  data?: SiegCertificadoListItem[];
  error?: string;
}> {
  const apiKey = ENV.siegApiKey;
  if (!apiKey) {
    return { success: false, error: "SIEG_API_KEY não configurada" };
  }

  try {
    // Buscar ativos
    const urlAtivos = `${SIEG_BASE_URL}/api/Certificado/ListarCertificados?api_key=${encodeURIComponent(apiKey)}&active=true`;
    const respAtivos = await fetch(urlAtivos, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    
    const textAtivos = await respAtivos.text();
    let ativos: SiegCertificadoListItem[] = [];
    if (respAtivos.ok) {
      try { ativos = JSON.parse(textAtivos); } catch { /* ignore */ }
    }
    
    // Buscar inativos
    const urlInativos = `${SIEG_BASE_URL}/api/Certificado/ListarCertificados?api_key=${encodeURIComponent(apiKey)}&active=false`;
    const respInativos = await fetch(urlInativos, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    
    const textInativos = await respInativos.text();
    let inativos: SiegCertificadoListItem[] = [];
    if (respInativos.ok) {
      try { inativos = JSON.parse(textInativos); } catch { /* ignore */ }
    }
    
    // Combinar e deduplicar por Id
    const seen = new Set<string>();
    const all = [...ativos, ...inativos].filter(s => {
      if (seen.has(s.Id)) return false;
      seen.add(s.Id);
      return true;
    });

    return { success: true, data: all };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Verifica se a API SIEG está acessível com a chave configurada.
 * Retorna true se a chave for válida.
 */
export async function testSiegConnection(): Promise<{
  ok: boolean;
  message: string;
  certificatesCount?: number;
}> {
  const result = await listarCertificadosSieg();
  if (!result.success) {
    return { ok: false, message: result.error || "Falha na conexão com SIEG" };
  }
  return {
    ok: true,
    message: "Conexão com SIEG OK",
    certificatesCount: result.data?.length ?? 0,
  };
}
