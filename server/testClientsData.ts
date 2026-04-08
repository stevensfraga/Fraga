/**
 * Dados de teste de clientes em atraso com números de telefone
 * Usado para testar o sistema de cobrança via WhatsApp
 */

export interface TestClient {
  id: string;
  nome: string;
  cnpj: string;
  dias_atraso: number;
  valor_atraso: number;
  faixa: "friendly" | "administrative" | "formal";
  num_parcelas: number;
  vencimento_mais_antigo: string;
  telefone: string; // Número de telefone para teste
  email?: string;
}

export const TEST_CLIENTS: TestClient[] = [
  {
    id: "3232776000125.0",
    nome: "ELLY PRODUTOS OTICOS",
    cnpj: "03.232.776/0001-25",
    dias_atraso: 636,
    valor_atraso: 19222.65,
    faixa: "formal",
    num_parcelas: 20,
    vencimento_mais_antigo: "2024-05-11",
    telefone: "5527981234567", // Número de teste
    email: "contato@ellyprodutos.com.br"
  },
  {
    id: "7485216000133.0",
    nome: "TCVV TERMINAL DE CONTAINER VILA VELHA LTDA",
    cnpj: "74.852.160/0001-33",
    dias_atraso: 212,
    valor_atraso: 20650.0,
    faixa: "formal",
    num_parcelas: 4,
    vencimento_mais_antigo: "2025-07-09",
    telefone: "5527987654321",
    email: "financeiro@tcvv.com.br"
  },
  {
    id: "25186264000102.0",
    nome: "JU AGUIAR - ESTÉTICA, CURSOS E TREINAMENTOS LTDA",
    cnpj: "25.186.264/0001-02",
    dias_atraso: 273,
    valor_atraso: 15529.02,
    faixa: "formal",
    num_parcelas: 22,
    vencimento_mais_antigo: "2025-05-09",
    telefone: "5527988765432",
    email: "admin@juaguiar.com.br"
  },
  {
    id: "36060609000101.0",
    nome: "NVS - TRANSPORTES DE CONTAINERES",
    cnpj: "36.060.609/0001-01",
    dias_atraso: 212,
    valor_atraso: 9180.0,
    faixa: "formal",
    num_parcelas: 5,
    vencimento_mais_antigo: "2025-07-09",
    telefone: "5527989876543",
    email: "financeiro@nvstransportes.com.br"
  },
  {
    id: "31494039000136.0",
    nome: "DU VALLE MATOS MOVEIS E DECORACAO LTDA",
    cnpj: "31.494.039/0001-36",
    dias_atraso: 274,
    valor_atraso: 7573.15,
    faixa: "formal",
    num_parcelas: 10,
    vencimento_mais_antigo: "2025-05-08",
    telefone: "5527985432109",
    email: "vendas@duvalle.com.br"
  },
  {
    id: "47454499000170.0",
    nome: "TAELHO LTDA",
    cnpj: "47.454.499/0001-70",
    dias_atraso: 272,
    valor_atraso: 6209.9,
    faixa: "formal",
    num_parcelas: 18,
    vencimento_mais_antigo: "2025-05-10",
    telefone: "5527984321098",
    email: "contato@taelho.com.br"
  },
  {
    id: "50486746000125.0",
    nome: "LABORATORIO OTICO VISION VIX LTDA",
    cnpj: "50.486.746/0001-25",
    dias_atraso: 272,
    valor_atraso: 5549.8,
    faixa: "formal",
    num_parcelas: 13,
    vencimento_mais_antigo: "2025-05-10",
    telefone: "5527983210987",
    email: "lab@visionvix.com.br"
  },
  {
    id: "54861486000181.0",
    nome: "J&L ADMINISTRACAO E CONSULTORIA IMOBILIARIAS",
    cnpj: "54.861.486/0001-81",
    dias_atraso: 271,
    valor_atraso: 5461.6,
    faixa: "formal",
    num_parcelas: 17,
    vencimento_mais_antigo: "2025-05-11",
    telefone: "5527982109876",
    email: "admin@jlconsultoria.com.br"
  },
  {
    id: "50270561000189.0",
    nome: "LUCINEA ARCHANGELO TITONELLI",
    cnpj: "50.270.561/0001-89",
    dias_atraso: 272,
    valor_atraso: 5169.09,
    faixa: "formal",
    num_parcelas: 19,
    vencimento_mais_antigo: "2025-05-10",
    telefone: "5527981098765",
    email: "lucinea@email.com.br"
  },
  {
    id: "12345678000190.0",
    nome: "COMERCIO DE ELETRONICOS LTDA",
    cnpj: "12.345.678/0001-90",
    dias_atraso: 45,
    valor_atraso: 3500.0,
    faixa: "administrative",
    num_parcelas: 3,
    vencimento_mais_antigo: "2025-12-20",
    telefone: "5527980987654",
    email: "vendas@eletronicos.com.br"
  },
  {
    id: "98765432000191.0",
    nome: "SERVICOS DE LIMPEZA PROFISSIONAL",
    cnpj: "98.765.432/0001-91",
    dias_atraso: 15,
    valor_atraso: 2100.0,
    faixa: "friendly",
    num_parcelas: 2,
    vencimento_mais_antigo: "2026-01-15",
    telefone: "5527989876543",
    email: "admin@limpezapro.com.br"
  }
];

/**
 * Buscar cliente de teste por ID
 */
export function getTestClientById(clientId: string): TestClient | undefined {
  return TEST_CLIENTS.find(c => c.id === clientId);
}

/**
 * Buscar cliente de teste por nome
 */
export function getTestClientByName(name: string): TestClient | undefined {
  return TEST_CLIENTS.find(c => c.nome.toLowerCase().includes(name.toLowerCase()));
}

/**
 * Buscar cliente de teste por CNPJ
 */
export function getTestClientByCnpj(cnpj: string): TestClient | undefined {
  const cleanCnpj = cnpj.replace(/\D/g, '');
  return TEST_CLIENTS.find(c => c.cnpj.replace(/\D/g, '') === cleanCnpj);
}

/**
 * Buscar todos os clientes de teste em uma faixa específica
 */
export function getTestClientsByRange(range: "friendly" | "administrative" | "formal"): TestClient[] {
  return TEST_CLIENTS.filter(c => c.faixa === range);
}

/**
 * Buscar todos os clientes de teste
 */
export function getAllTestClients(): TestClient[] {
  return TEST_CLIENTS;
}

/**
 * Formatar número de telefone para WhatsApp
 */
export function formatPhoneForWhatsApp(phone: string): string {
  if (!phone) return "";
  
  // Remover caracteres especiais
  const cleaned = phone.replace(/\D/g, '');
  
  // Se começar com 0, remover
  let formatted = cleaned.startsWith('0') ? cleaned.slice(1) : cleaned;
  
  // Se tiver menos de 10 dígitos, é inválido
  if (formatted.length < 10) return "";
  
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
export function isValidWhatsAppNumber(phone: string): boolean {
  if (!phone) return false;
  
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}
