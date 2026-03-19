import axios from 'axios';

const ACESSORIAS_API_URL = process.env.ACESSORIAS_API_URL || 'https://api.acessorias.com';
const ACESSORIAS_EMAIL = process.env.ACESSORIAS_EMAIL || '';
const ACESSORIAS_PASSWORD = process.env.ACESSORIAS_PASSWORD || '';

interface AcessoriasContact {
  id: string;
  name: string;
  phone?: string;
  cellphone?: string;
  email?: string;
}

interface ClientPhoneInfo {
  clientId: string;
  clientName: string;
  whatsappNumber?: string;
  phone?: string;
  email?: string;
}

let authToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Autenticar na API de acessórias
 */
async function authenticate(): Promise<string> {
  try {
    // Verificar se token ainda é válido
    if (authToken && Date.now() < tokenExpiry) {
      return authToken;
    }

    console.log('[Acessórias Auth] Autenticando...');

    const response = await axios.post(
      `${ACESSORIAS_API_URL}/auth/login`,
      {
        email: ACESSORIAS_EMAIL,
        password: ACESSORIAS_PASSWORD
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    authToken = (response.data.token || response.data.access_token) as string;
    tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000;

    console.log('[Acessórias Auth] Autenticação bem-sucedida');
    return authToken;
  } catch (error) {
    console.error('[Acessórias Auth] Erro na autenticação:', error);
    throw new Error('Falha ao autenticar na API de acessórias');
  }
}

/**
 * Buscar contatos de uma empresa no banco de acessórias
 */
async function getCompanyContacts(companyId: string): Promise<AcessoriasContact[]> {
  try {
    const token = await authenticate();

    const response = await axios.get(
      `${ACESSORIAS_API_URL}/contacts/list`,
      {
        params: {
          company_id: companyId,
          limit: 100
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.data || response.data || [];
  } catch (error) {
    console.error('[Acessórias Contacts] Erro ao buscar contatos:', error);
    return [];
  }
}

/**
 * Buscar número de WhatsApp de um cliente pelo ID do Conta Azul
 */
export async function getClientWhatsAppNumberFromAcessorias(
  clientName: string,
  clientId?: string
): Promise<ClientPhoneInfo | null> {
  try {
    console.log(`[Acessórias Client] Buscando número de WhatsApp para: ${clientName}`);

    const token = await authenticate();

    // Buscar empresa pelo nome
    const searchResponse = await axios.get(
      `${ACESSORIAS_API_URL}/companies/search`,
      {
        params: {
          name: clientName,
          limit: 5
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const companies = searchResponse.data.data || searchResponse.data || [];

    if (companies.length === 0) {
      console.log(`[Acessórias Client] Nenhuma empresa encontrada para: ${clientName}`);
      return null;
    }

    // Usar primeira empresa encontrada
    const company = companies[0];
    console.log(`[Acessórias Client] Empresa encontrada: ${company.name} (ID: ${company.id})`);

    // Buscar contatos da empresa
    const contacts = await getCompanyContacts(company.id);

    if (contacts.length === 0) {
      console.log(`[Acessórias Client] Nenhum contato encontrado para a empresa`);
      return {
        clientId: clientId || company.id,
        clientName: clientName,
        email: company.email
      };
    }

    // Priorizar: celular > telefone > email
    const mainContact = contacts[0];
    const whatsappNumber = formatPhoneForWhatsApp(
      mainContact.cellphone || mainContact.phone
    );

    console.log(`[Acessórias Client] Contato encontrado: ${mainContact.name}`);
    console.log(`[Acessórias Client] WhatsApp: ${whatsappNumber || 'não disponível'}`);

    return {
      clientId: clientId || company.id,
      clientName: clientName,
      whatsappNumber: whatsappNumber,
      phone: mainContact.phone,
      email: mainContact.email || company.email
    };
  } catch (error) {
    console.error('[Acessórias Client] Erro ao buscar número de WhatsApp:', error);
    return null;
  }
}

/**
 * Buscar números de WhatsApp para múltiplos clientes
 */
export async function getClientWhatsAppNumbersBatch(
  clients: Array<{ name: string; id?: string }>
): Promise<ClientPhoneInfo[]> {
  const results: ClientPhoneInfo[] = [];

  for (const client of clients) {
    try {
      const phoneInfo = await getClientWhatsAppNumberFromAcessorias(client.name, client.id);
      if (phoneInfo) {
        results.push(phoneInfo);
      }
      // Adicionar delay para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[Acessórias Batch] Erro ao buscar cliente ${client.name}:`, error);
    }
  }

  return results;
}

/**
 * Formatar número de telefone para WhatsApp (padrão internacional)
 */
function formatPhoneForWhatsApp(phone?: string): string | undefined {
  if (!phone) return undefined;

  // Remover caracteres especiais
  const cleaned = phone.replace(/\D/g, '');

  // Se começar com 0, remover
  let formatted = cleaned.startsWith('0') ? cleaned.slice(1) : cleaned;

  // Se tiver menos de 10 dígitos, é inválido
  if (formatted.length < 10) return undefined;

  // Se tiver exatamente 10 ou 11 dígitos (Brasil), adicionar código do país
  if (formatted.length === 10 || formatted.length === 11) {
    formatted = '55' + formatted;
  }

  // Se não começar com 55 (código Brasil), assumir que é Brasil
  if (!formatted.startsWith('55')) {
    formatted = '55' + formatted;
  }

  return formatted;
}

/**
 * Validar se número de WhatsApp é válido
 */
export function isValidWhatsAppNumber(phone?: string): boolean {
  if (!phone) return false;

  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}

/**
 * Testar conexão com API de acessórias
 */
export async function testAcessoriasConnection(): Promise<boolean> {
  try {
    const token = await authenticate();
    console.log('[Acessórias Test] Conexão bem-sucedida');
    return true;
  } catch (error) {
    console.error('[Acessórias Test] Falha na conexão:', error);
    return false;
  }
}
