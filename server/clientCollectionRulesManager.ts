/**
 * Gerenciador de Regras de Cobrança por Cliente
 * Responsável por:
 * 1. Buscar cliente no Conta Azul
 * 2. Extrair telefone/WhatsApp
 * 3. Armazenar no banco de dados
 * 4. Usar automaticamente em cobranças
 */

import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { collectionRules, clients } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

interface ClienteContaAzul {
  id: string;
  name: string;
  email?: string;
  celular?: string;
  telefone_comercial?: string;
  telefone?: string;
  whatsapp?: string;
  contato_principal?: {
    telefone?: string;
    celular?: string;
  };
  [key: string]: any;
}

/**
 * Extrair número de telefone/WhatsApp do cliente
 * Prioridade: celular > telefone_comercial > telefone > whatsapp > contato_principal.telefone
 */
function extrairTelefone(cliente: ClienteContaAzul): string | null {
  // Prioridade 1: celular
  if (cliente.celular) {
    return normalizarTelefone(cliente.celular);
  }

  // Prioridade 2: telefone_comercial
  if (cliente.telefone_comercial) {
    return normalizarTelefone(cliente.telefone_comercial);
  }

  // Prioridade 3: telefone
  if (cliente.telefone) {
    return normalizarTelefone(cliente.telefone);
  }

  // Prioridade 4: whatsapp
  if (cliente.whatsapp) {
    return normalizarTelefone(cliente.whatsapp);
  }

  // Prioridade 5: contato_principal.telefone
  if (cliente.contato_principal?.telefone) {
    return normalizarTelefone(cliente.contato_principal.telefone);
  }

  // Prioridade 6: contato_principal.celular
  if (cliente.contato_principal?.celular) {
    return normalizarTelefone(cliente.contato_principal.celular);
  }

  return null;
}

/**
 * Normalizar número de telefone para formato internacional
 * Remove caracteres especiais e adiciona código do país se necessário
 */
function normalizarTelefone(telefone: string): string {
  if (!telefone) return '';

  // Remove caracteres especiais
  let numero = telefone.replace(/\D/g, '');

  // Se não tem código do país, adiciona 55 (Brasil)
  if (numero.length === 11 || numero.length === 10) {
    numero = '55' + numero;
  }

  return numero;
}

/**
 * Validar número de telefone
 */
function validarTelefone(telefone: string): boolean {
  if (!telefone) return false;

  // Remover caracteres especiais
  const numero = telefone.replace(/\D/g, '');

  // Deve ter entre 10 e 15 dígitos
  return numero.length >= 10 && numero.length <= 15;
}

/**
 * Buscar cliente no Conta Azul por nome
 */
export async function buscarClienteContaAzul(
  nomeBusca: string
): Promise<ClienteContaAzul | null> {
  const db = await getDb();
  if (!db) {
    console.error('[Cobrança] ❌ Banco de dados não disponível');
    return null;
  }
  try {
    console.log(`[Cobrança] Buscando cliente: ${nomeBusca}`);

    const accessToken = await getValidAccessToken();

    // Buscar clientes
    const response = await axios.get(
      'https://api-v2.contaazul.com/v1/customers',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const clientes = response.data.data || [];
    console.log(`[Cobrança] Total de clientes: ${clientes.length}`);

    // Buscar por nome exato ou parcial
    const clienteEncontrado = clientes.find(
      (c: ClienteContaAzul) =>
        c.name?.toUpperCase().includes(nomeBusca.toUpperCase()) ||
        c.name?.toUpperCase() === nomeBusca.toUpperCase()
    );

    if (!clienteEncontrado) {
      console.warn(`[Cobrança] ❌ Cliente "${nomeBusca}" não encontrado`);
      return null;
    }

    console.log(`[Cobrança] ✅ Cliente encontrado: ${clienteEncontrado.name}`);
    return clienteEncontrado;
  } catch (error: any) {
    console.error('[Cobrança] ❌ Erro ao buscar cliente:', error.message);
    throw error;
  }
}

/**
 * Buscar ou criar regra de cobrança para cliente
 */
export async function buscarOuCriarRegraCobranca(
  nomeBusca: string
): Promise<{ telefone: string; clienteId: string; origem: string } | null> {
  const db = await getDb();
  if (!db) {
    console.error('[Cobrança] ❌ Banco de dados não disponível');
    return null;
  }
  try {
    console.log(`[Cobrança] Buscando regra de cobrança para: ${nomeBusca}`);

    // PASSO 1: Buscar cliente no Conta Azul
    const cliente = await buscarClienteContaAzul(nomeBusca);

    if (!cliente) {
      console.warn(`[Cobrança] ❌ Cliente não encontrado no Conta Azul`);
      return null;
    }

    // PASSO 2: Extrair telefone
    const telefone = extrairTelefone(cliente);

    if (!telefone || !validarTelefone(telefone)) {
      console.warn(`[Cobrança] ⚠️  Cliente não tem telefone válido`);
      return null;
    }

    console.log(`[Cobrança] ✅ Telefone extraído: ${telefone}`);

    // PASSO 3: Verificar se já existe no banco
    const regraExistente = await db
      .select()
      .from(collectionRules)
      .where(eq(collectionRules.contaAzulId, cliente.id))
      .limit(1);

    if (regraExistente.length > 0) {
      console.log(`[Cobrança] ℹ️  Regra já existe no banco, atualizando...`);
      // Atualizar telefone se mudou
      await db
        .update(collectionRules)
        .set({
          whatsappNumber: telefone,
          updatedAt: new Date(),
        })
        .where(eq(collectionRules.contaAzulId, cliente.id));

      return {
        telefone,
        clienteId: cliente.id,
        origem: 'banco',
      };
    }

    // PASSO 4: Criar nova regra no banco
    console.log(`[Cobrança] 💾 Criando nova regra de cobrança...`);

    // Primeiro, verificar se cliente existe na tabela clients
    let clienteDb = await db
      .select()
      .from(clients)
      .where(eq(clients.contaAzulId, cliente.id))
      .limit(1);

    let clienteId: number;

    if (clienteDb.length === 0) {
      // Criar cliente no banco
      const resultado = await db.insert(clients).values({
        contaAzulId: cliente.id,
        name: cliente.name,
        email: cliente.email,
        whatsappNumber: telefone,
      });

      clienteId = (resultado as any).insertId || resultado[0];
    } else {
      clienteId = clienteDb[0].id;
    }

    // Criar regra de cobrança
    await db.insert(collectionRules).values({
      clientId: clienteId,
      contaAzulId: cliente.id,
      clientName: cliente.name,
      whatsappNumber: telefone,
      origin: 'contaazul',
      isActive: true,
    });

    console.log(`[Cobrança] ✅ Regra criada com sucesso!`);

    return {
      telefone,
      clienteId: cliente.id,
      origem: 'contaazul',
    };
  } catch (error: any) {
    console.error('[Cobrança] ❌ Erro ao buscar/criar regra:', error.message);
    throw error;
  }
}

/**
 * Obter telefone de cobrança para cliente
 */
export async function obterTelefoneCobranca(
  nomeBusca: string
): Promise<string | null> {
  try {
    const regra = await buscarOuCriarRegraCobranca(nomeBusca);
    return regra?.telefone || null;
  } catch (error) {
    console.error('[Cobrança] ❌ Erro ao obter telefone:', error);
    return null;
  }
}

/**
 * Atualizar telefone de cobrança manualmente
 */
export async function atualizarTelefoneCobranca(
  contaAzulId: string,
  novoTelefone: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.error('[Cobrança] ❌ Banco de dados não disponível');
    return false;
  }
  try {
    if (!validarTelefone(novoTelefone)) {
      console.warn(`[Cobrança] ❌ Telefone inválido: ${novoTelefone}`);
      return false;
    }

    const telefonNormalizado = normalizarTelefone(novoTelefone);

    await db
      .update(collectionRules)
      .set({
        whatsappNumber: telefonNormalizado,
        origin: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(collectionRules.contaAzulId, contaAzulId));

    console.log(`[Cobrança] ✅ Telefone atualizado: ${telefonNormalizado}`);
    return true;
  } catch (error: any) {
    console.error('[Cobrança] ❌ Erro ao atualizar telefone:', error.message);
    return false;
  }
}

/**
 * Listar todas as regras de cobrança
 */
export async function listarRegrasCobranca() {
  const db = await getDb();
  if (!db) {
    console.error('[Cobrança] ❌ Banco de dados não disponível');
    return [];
  }
  try {
    const regras = await db.select().from(collectionRules);
    return regras;
  } catch (error: any) {
    console.error('[Cobrança] ❌ Erro ao listar regras:', error.message);
    return [];
  }
}
