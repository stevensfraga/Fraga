import axios from "axios";
import { executeWithRetry, createRetryConfig } from "./retryManager";
import { ENV } from "./_core/env";

interface AcessoriasCompany {
  ID: string;
  Identificador: string;
  Razao: string;
  Fantasia: string;
  Departamentos?: Array<{
    ID: string;
    Nome: string;
    RespNome: string;
    RespEmail: string;
  }>;
  Obrigacoes?: Array<{
    Nome: string;
    Status: string;
    Entregues: string;
    Atrasadas: string;
    Proximos30D: string;
    Futuras30Plus: string;
  }>;
}

interface AcessoriasContact {
  ID: string;
  Nome: string;
  email: string;
  cargo?: string;
  fone?: string;
  aptos?: string;
}

const API_BASE_URL = "https://api.acessorias.com";
const API_TOKEN = "T5c45793e1cc9f0d31c3caaddac173b99c"; // Token do usuário stevens@fragacontabilidade.com.br

/**
 * Retorna o token da API (usando Bearer token em vez de autenticação por email/senha)
 */
export async function getAcessoriasToken(): Promise<string> {
  // Token é estático, não precisa autenticar
  return API_TOKEN;
}

/**
 * Busca dados de uma empresa específica da API de acessórias
 */
export async function fetchAcessoriasCompanyData(identificador: string): Promise<AcessoriasCompany | null> {
  const retryConfig = createRetryConfig({
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    timeoutMs: 10000,
  });

  const result = await executeWithRetry(async () => {
    const token = await getAcessoriasToken();
    console.log(`[Acessórias] Buscando dados da empresa ${identificador}...`);

    const response = await axios.get(
      `${API_BASE_URL}/companies/${identificador}/?obligations&departments`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );
    return response.data;
  }, retryConfig);

  if (result.success) {

    console.log(`[Acessórias] Dados obtidos para ${identificador} em ${result.totalTimeMs}ms`);
    return result.data || null;
  } else {
    console.error(`[Acessórias] Erro ao buscar dados da empresa ${identificador}: ${result.error}`);
    return null;
  }
}

/**
 * Busca lista de empresas da API de acessórias
 */
export async function fetchAcessoriasCompanies(page: number = 1): Promise<AcessoriasCompany[]> {
  try {
    const token = await getAcessoriasToken();

    console.log(`[Acessórias] Buscando empresas (página ${page})...`);

    const response = await axios.get(
      `${API_BASE_URL}/companies/ListAll/?obligations&departments&Pagina=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );

    if (Array.isArray(response.data)) {
      console.log(`[Acessórias] ${response.data.length} empresas encontradas na página ${page}`);
      return response.data;
    }

    return [];
  } catch (error: any) {
    console.error("[Acessórias] Erro ao buscar empresas:", error.message);
    throw error;
  }
}

/**
 * Busca contatos de uma empresa específica
 */
export async function fetchAcessoriasContacts(
  identificador: string
): Promise<AcessoriasContact[]> {
  try {
    const token = await getAcessoriasToken();

    console.log(`[Acessórias] Buscando contatos para ${identificador}...`);

    const response = await axios.get(
      `${API_BASE_URL}/companies/${identificador}/?contacts`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );

    if (Array.isArray(response.data)) {
      console.log(`[Acessórias] ${response.data.length} contatos encontrados`);
      return response.data;
    }

    return [];
  } catch (error: any) {
    console.error("[Acessórias] Erro ao buscar contatos:", error.message);
    throw error;
  }
}

/**
 * Sincroniza todas as empresas e contatos da API de acessórias
 */
export async function syncAcessoriasData(): Promise<{
  totalCompanies: number;
  totalContacts: number;
  errors: string[];
}> {
  const result = {
    totalCompanies: 0,
    totalContacts: 0,
    errors: [] as string[],
  };

  try {
    console.log("[Acessórias] Iniciando sincronização...");

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const companies = await fetchAcessoriasCompanies(page);

        if (companies.length === 0) {
          hasMore = false;
          break;
        }

        for (const company of companies) {
          try {
            result.totalCompanies++;

            // Buscar contatos da empresa
            const contacts = await fetchAcessoriasContacts(company.Identificador);
            result.totalContacts += contacts.length;

            console.log(
              `[Acessórias] ${company.Fantasia || company.Razao}: ${contacts.length} contatos`
            );
          } catch (error: any) {
            const errorMsg = `Erro ao processar ${company.Razao}: ${error.message}`;
            console.error(`[Acessórias] ${errorMsg}`);
            result.errors.push(errorMsg);
          }
        }

        page++;
      } catch (error: any) {
        const errorMsg = `Erro ao buscar página ${page}: ${error.message}`;
        console.error(`[Acessórias] ${errorMsg}`);
        result.errors.push(errorMsg);
        hasMore = false;
      }
    }

    console.log(
      `[Acessórias] Sincronização concluída: ${result.totalCompanies} empresas, ${result.totalContacts} contatos`
    );

    return result;
  } catch (error: any) {
    const errorMsg = `Erro geral na sincronização: ${error.message}`;
    console.error(`[Acessórias] ${errorMsg}`);
    result.errors.push(errorMsg);
    throw error;
  }
}

/**
 * Formata telefone para WhatsApp (adiciona código do país se necessário)
 */
export function formatPhoneForWhatsApp(phone: string): string {
  if (!phone) return "";

  // Remove caracteres especiais
  const cleaned = phone.replace(/\D/g, "");

  // Se já tem 55 (código Brasil) no início, retorna
  if (cleaned.startsWith("55")) {
    return cleaned;
  }

  // Se tem 11 dígitos (com DDD), adiciona 55
  if (cleaned.length === 11) {
    return `55${cleaned}`;
  }

  // Se tem 10 dígitos (sem celular), adiciona 55 e 9
  if (cleaned.length === 10) {
    return `55${cleaned.slice(0, 2)}9${cleaned.slice(2)}`;
  }

  // Retorna como está
  return cleaned;
}
