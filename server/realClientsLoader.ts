import fs from 'fs';
import path from 'path';

interface RealClient {
  nome: string;
  cnpj: string;
  telefone: string;
  email: string;
  source: 'conta_azul' | 'acessorias';
}

let cachedClients: RealClient[] | null = null;

/**
 * Carrega dados reais dos clientes do arquivo JSON unificado
 */
export function loadRealClients(): RealClient[] {
  if (cachedClients) {
    return cachedClients;
  }

  try {
    const filePath = path.join(process.cwd(), 'server', 'realClientsData.json');
    
    if (!fs.existsSync(filePath)) {
      console.warn('[RealClientsLoader] Arquivo realClientsData.json não encontrado');
      return [];
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    cachedClients = JSON.parse(data) as RealClient[];
    
    console.log(`[RealClientsLoader] Carregados ${cachedClients.length} clientes reais`);
    return cachedClients;
  } catch (error) {
    console.error('[RealClientsLoader] Erro ao carregar dados reais:', error);
    return [];
  }
}

/**
 * Busca cliente real por CNPJ
 */
export function getRealClientByCnpj(cnpj: string): RealClient | undefined {
  const clients = loadRealClients();
  return clients.find(c => c.cnpj === cnpj || c.cnpj.replace(/[^\d]/g, '') === cnpj.replace(/[^\d]/g, ''));
}

/**
 * Busca cliente real por nome (busca parcial)
 */
export function getRealClientByName(name: string): RealClient | undefined {
  const clients = loadRealClients();
  const searchName = name.toUpperCase();
  return clients.find(c => c.nome.toUpperCase().includes(searchName) || searchName.includes(c.nome.toUpperCase()));
}

/**
 * Busca cliente real por telefone
 */
export function getRealClientByPhone(phone: string): RealClient | undefined {
  const clients = loadRealClients();
  const cleanPhone = phone.replace(/[^\d]/g, '');
  return clients.find(c => c.telefone.replace(/[^\d]/g, '') === cleanPhone);
}

/**
 * Retorna todos os clientes reais com telefone
 */
export function getAllRealClientsWithPhone(): RealClient[] {
  const clients = loadRealClients();
  return clients.filter(c => c.telefone && c.telefone.length > 0);
}

/**
 * Retorna estatísticas dos clientes reais
 */
export function getRealClientsStats() {
  const clients = loadRealClients();
  const withPhone = clients.filter(c => c.telefone);
  const bySource = {
    conta_azul: clients.filter(c => c.source === 'conta_azul').length,
    acessorias: clients.filter(c => c.source === 'acessorias').length,
  };

  return {
    total: clients.length,
    withPhone: withPhone.length,
    bySource,
  };
}

/**
 * Formata número de telefone para WhatsApp
 */
export function formatPhoneForWhatsApp(phone: string): string {
  if (!phone) return '';

  // Remove tudo que não é número
  let cleaned = phone.replace(/[^\d]/g, '');

  // Se tem 10 dígitos, adiciona código do país e DDD
  if (cleaned.length === 10) {
    cleaned = '55' + cleaned;
  }
  // Se tem 11 dígitos, adiciona código do país
  else if (cleaned.length === 11) {
    cleaned = '55' + cleaned;
  }
  // Se já tem 13 dígitos (55 + DDD + número), usa como está
  else if (cleaned.length === 13 && cleaned.startsWith('55')) {
    // OK
  }
  // Se tem 12 dígitos e começa com 55, usa como está
  else if (cleaned.length === 12 && cleaned.startsWith('55')) {
    // OK
  }
  // Caso contrário, retorna vazio
  else {
    return '';
  }

  return cleaned;
}

/**
 * Valida se é um número de WhatsApp válido
 */
export function isValidWhatsAppNumber(phone: string): boolean {
  const formatted = formatPhoneForWhatsApp(phone);
  return formatted.length >= 12 && formatted.startsWith('55');
}
