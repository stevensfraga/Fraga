/**
 * 🔄 Serviço de Sincronização de Dados do Conta Azul
 * 
 * Responsável por:
 * 1. Validar autenticação OAuth
 * 2. Buscar clientes da API
 * 3. Buscar contas a receber (boletos)
 * 4. Persistir dados no banco local
 * 5. Gerar relatório de sincronização
 */

import axios, { AxiosError } from "axios";
import { getDb } from "./db";
import { clients, receivables, contaAzulTokens } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from 'crypto';

// Usar api-v2.contaazul.com como base (servidor oficial do portal)
const CONTA_AZUL_API_BASE = process.env.CONTA_AZUL_API_BASE || "https://api-v2.contaazul.com";

/**
 * Helper: Elimina duplicacao de barras ao juntar base + path
 */
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Helper: Gera fingerprint do token (sem vazar)
 */
function tokenFingerprint(token: string): string {
  const hash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 10);
  return `token[len=${token.length},hash=${hash}]`;
}

interface ContaAzulToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface SyncResult {
  success: boolean;
  clientsSynced: number;
  receivablesSynced: number;
  errors: string[];
  warnings: string[];
  timestamp: string;
}

/**
 * Validar e converter telefone para formato E.164 (+55...)
 */
// Placeholders conhecidos que NUNCA devem ser salvos
const PHONE_PLACEHOLDERS = [
  '+5527999999999',
  '5527999999999',
  '27999999999',
  '+5500000000000',
  '0000000000',
  '00000000000',
];

function normalizePhoneToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove caracteres não numéricos
  const cleaned = phone.replace(/\D/g, '');

  // Se vazio após limpeza, retornar null
  if (!cleaned || cleaned.length < 10) return null;

  let normalized: string | null = null;

  // Caso 1: 10-11 dígitos (DDD + número brasileiro)
  if (cleaned.length === 11) {
    // Celular: DDD(2) + 9 + 8 dígitos = 11 dígitos
    normalized = `+55${cleaned}`;
  } else if (cleaned.length === 10) {
    // Fixo: DDD(2) + 8 dígitos = 10 dígitos — não é WhatsApp
    return null;
  } else if (cleaned.length === 12 && cleaned.startsWith('55')) {
    // Já com código do país mas sem +: 55 + DDD(2) + 8 dígitos (fixo)
    return null;
  } else if (cleaned.length === 13 && cleaned.startsWith('55')) {
    // Já com código do país: 55 + DDD(2) + 9 + 8 dígitos
    normalized = `+${cleaned}`;
  } else if (phone.startsWith('+55') && cleaned.length === 13) {
    normalized = `+${cleaned}`;
  } else {
    return null;
  }

  // PROTEÇÃO ANTI-PLACEHOLDER: rejeitar números conhecidos como placeholder
  if (normalized && PHONE_PLACEHOLDERS.includes(normalized)) {
    console.warn(`[PhoneNormalize] ⚠️ Placeholder detectado e rejeitado: ${phone} → ${normalized}`);
    return null;
  }

  // Validar DDD brasileiro (11-99)
  if (normalized) {
    const ddd = normalized.substring(3, 5);
    const dddNum = parseInt(ddd, 10);
    if (dddNum < 11 || dddNum > 99) {
      return null;
    }
  }

  return normalized;
}

/**
 * 1️⃣ Validar autenticação OAuth
 */
export async function validateContaAzulAuth(accessToken?: string): Promise<{ valid: boolean; token?: string; error?: string }> {
  try {
    console.log("[ContaAzul] Validando autenticação OAuth...");

    const db = await getDb();
    if (!db) {
      return {
        valid: false,
        error: "Banco de dados não disponível",
      };
    }

    // Buscar token mais recente (DESC = mais novo)
    const tokenRecord = await db
      .select()
      .from(contaAzulTokens)
      .orderBy(desc(contaAzulTokens.createdAt))
      .limit(1);

    if (!tokenRecord || tokenRecord.length === 0) {
      return {
        valid: false,
        error: "Nenhum token OAuth encontrado. Reautorize via UI.",
      };
    }

    const token = tokenRecord[0];

    // Verificar se token expirou
    const now = new Date();
    const expiresAt = new Date(token.expiresAt);

    if (now > expiresAt) {
      console.log("[ContaAzul] Token expirado, tentando renovar...");

      // TODO: Implementar refresh de token
      return {
        valid: false,
        error: "Token expirado. Reautorize via UI.",
      };
    }

    console.log("[ContaAzul] ✅ Token válido");

    return {
      valid: true,
      token: token.accessToken,
    };
  } catch (error) {
    console.error("[ContaAzul] Erro ao validar autenticação:", error);

    return {
      valid: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

/**
 * 2️⃣ Buscar clientes da API Conta Azul
 */
export async function fetchClientsFromContaAzul(
  accessToken: string
): Promise<any[]> {
  try {
    console.log("[ContaAzul] Buscando clientes...");
    console.log("[ContaAzul] API Base:", CONTA_AZUL_API_BASE);
    console.log("[ContaAzul] Endpoint: /pessoas (base já contém /v1)");
    console.log("[ContaAzul] Token:", tokenFingerprint(accessToken));

    // CONTA_AZUL_API_BASE já contém /v1, não duplicar
    const url = joinUrl(CONTA_AZUL_API_BASE, '/pessoas');
    console.log('[ContaAzul] GET', url);
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    if (response.status === 200) {
      // Debug: inspecionar formato da resposta
      const rawData = response.data;
      console.log(`[ContaAzul] Response type: ${typeof rawData}, isArray: ${Array.isArray(rawData)}, keys: ${typeof rawData === 'object' && rawData ? Object.keys(rawData).join(',') : 'N/A'}`);
      
      // A API pode retornar: array direto, {data: [...]}, {itens: [...]}, ou paginado
      let customers: any[];
      if (Array.isArray(rawData)) {
        customers = rawData;
      } else if (rawData?.data && Array.isArray(rawData.data)) {
        customers = rawData.data;
      } else if (rawData?.itens && Array.isArray(rawData.itens)) {
        customers = rawData.itens;
      } else if (rawData?.items && Array.isArray(rawData.items)) {
        customers = rawData.items;
      } else {
        console.warn(`[ContaAzul] ⚠️ Formato desconhecido, tentando usar como array:`, JSON.stringify(rawData).substring(0, 500));
        customers = Array.isArray(rawData) ? rawData : [];
      }

      console.log(`[ContaAzul] ✅ ${customers.length} clientes encontrados`);

      return customers;
    }

    return [];
  } catch (error) {
    const axiosError = error as AxiosError;

    console.error("[ContaAzul] Erro ao buscar clientes:", {
      status: axiosError.response?.status,
      message: axiosError.message,
    });

    throw error;
  }
}

/**
 * 3️⃣ Buscar contas a receber (boletos) da API Conta Azul
 */
export async function fetchReceivablesFromContaAzul(
  accessToken: string
): Promise<any[]> {
  try {
    console.log("[ContaAzul] Buscando contas a receber...");
    console.log("[ContaAzul] API Base:", CONTA_AZUL_API_BASE);
    console.log("[ContaAzul] Endpoint: /financeiro/eventos-financeiros/contas-a-receber/buscar");
    console.log("[ContaAzul] Token:", tokenFingerprint(accessToken));

    // Usar datas para buscar receivables (mesmo endpoint que funciona no tokenGuard)
    const today = new Date();
    const past365 = new Date(today);
    past365.setDate(past365.getDate() - 365);
    const future30 = new Date(today);
    future30.setDate(future30.getDate() + 30);
    
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    
    const params = {
      data_vencimento_de: formatDate(past365),
      data_vencimento_ate: formatDate(future30),
    };

    // Usar endpoint correto que funciona (mesmo do tokenGuard)
    const url = joinUrl(CONTA_AZUL_API_BASE, '/financeiro/eventos-financeiros/contas-a-receber/buscar');
    console.log('[ContaAzul] GET', url);
    console.log('[ContaAzul] Params:', params);
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      params,
      timeout: 30000,
    });

    if (response.status === 200) {
      const rawData = response.data;
      console.log(`[ContaAzul] Receivables response type: ${typeof rawData}, isArray: ${Array.isArray(rawData)}, keys: ${typeof rawData === 'object' && rawData ? Object.keys(rawData).join(',') : 'N/A'}`);
      
      let items: any[];
      if (Array.isArray(rawData)) {
        items = rawData;
      } else if (rawData?.items && Array.isArray(rawData.items)) {
        items = rawData.items;
      } else if (rawData?.itens && Array.isArray(rawData.itens)) {
        items = rawData.itens;
      } else if (rawData?.data && Array.isArray(rawData.data)) {
        items = rawData.data;
      } else {
        console.warn(`[ContaAzul] ⚠️ Formato receivables desconhecido:`, JSON.stringify(rawData).substring(0, 500));
        items = [];
      }

      console.log(`[ContaAzul] ✅ ${items.length} boletos encontrados`);

      return items;
    }

    return [];
  } catch (error) {
    const axiosError = error as AxiosError;

    console.error("[ContaAzul] Erro ao buscar boletos:", {
      status: axiosError.response?.status,
      message: axiosError.message,
    });

    throw error;
  }
}

/**
 * 4️⃣ Persistir clientes no banco local
 * 
 * Mapeia telefone celular do Conta Azul → whatsappNumber em formato E.164
 */
export async function syncClientsToDatabase(
  customersFromAPI: any[]
): Promise<{ synced: number; errors: string[]; warnings: string[] }> {
  try {
    const db = await getDb();
    if (!db) {
      throw new Error("Banco de dados não disponível");
    }

    console.log("[DB] Sincronizando clientes...");

    let synced = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const customer of customersFromAPI) {
      try {
        // Mapear telefone celular do Conta Azul para WhatsApp em formato E.164
        let whatsappNumber: string | null = null;
        let phoneWarning: string | null = null;

        // API v2 retorna campo "telefone" (não mobilePhone/phone)
        if (customer.telefone) {
          whatsappNumber = normalizePhoneToE164(customer.telefone);
          if (!whatsappNumber) {
            phoneWarning = `Cliente ${customer.nome}: telefone inválido (${customer.telefone})`;
          }
        } else {
          phoneWarning = `Cliente ${customer.nome}: nenhum telefone encontrado`;
        }

        if (phoneWarning) {
          console.warn(`[DB] ⚠️ ${phoneWarning}`);
          warnings.push(phoneWarning);
        }

        // Verificar se cliente já existe
        const existing = await db
          .select()
          .from(clients)
          .where(eq(clients.contaAzulId, customer.id))
          .limit(1);

        if (existing && existing.length > 0) {
          // Atualizar cliente existente
          await db
            .update(clients)
            .set({
              name: customer.nome,
              email: customer.email,
              phone: customer.telefone,
              whatsappNumber: whatsappNumber,
              updatedAt: new Date(),
            })
            .where(eq(clients.contaAzulId, customer.id));

          console.log(`[DB] ✅ Cliente atualizado: ${customer.nome} (WhatsApp: ${whatsappNumber || 'null'})`);
        } else {
          // Inserir novo cliente
          await db.insert(clients).values({
            contaAzulId: customer.id,
            name: customer.nome,
            email: customer.email,
            phone: customer.telefone,
            whatsappNumber: whatsappNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          console.log(`[DB] ✅ Cliente inserido: ${customer.nome} (WhatsApp: ${whatsappNumber || 'null'})`);
        }

        synced++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[DB] ❌ Erro ao sincronizar cliente ${customer.id}:`, errorMsg);
        errors.push(`Cliente ${customer.nome}: ${errorMsg}`);
      }
    }

    return { synced, errors, warnings };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[DB] Erro ao sincronizar clientes:", errorMsg);
    throw error;
  }
}

/**
 * 5️⃣ Persistir boletos no banco local
 */
export async function syncReceivablesToDatabase(
  receivablesFromAPI: any[]
): Promise<{ synced: number; errors: string[] }> {
  try {
    const db = await getDb();
    if (!db) {
      throw new Error("Banco de dados não disponível");
    }

    console.log("[DB] Sincronizando boletos...");

    let synced = 0;
    const errors: string[] = [];

    for (const receivable of receivablesFromAPI) {
      try {
        // API v2 retorna cliente como objeto aninhado: { cliente: { id, nome } }
        const clienteId = receivable.cliente?.id;
        if (!clienteId) {
          console.warn(`[DB] ⚠️ Boleto ${receivable.id} sem cliente vinculado — pulando`);
          continue;
        }

        // Buscar cliente pelo contaAzulId
        const customerRecord = await db
          .select()
          .from(clients)
          .where(eq(clients.contaAzulId, clienteId))
          .limit(1);

        if (!customerRecord || customerRecord.length === 0) {
          console.warn(`[DB] ⚠️ Cliente não encontrado para boleto ${receivable.id}`);
          continue;
        }

        const clientId = customerRecord[0].id;

        // Verificar se boleto já existe
        const existing = await db
          .select()
          .from(receivables)
          .where(eq(receivables.contaAzulId, receivable.id))
          .limit(1);

        const dueDate = new Date(receivable.due_date);
        const status = receivable.status === 'overdue' ? 'overdue' : 'pending';
        
        // Calcular collectionScore: (daysOverdue × 2) + (amount / 100)
        const now = new Date();
        const daysOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
        const amount = parseFloat(receivable.amount) || 0;
        const collectionScore = (daysOverdue * 2) + (amount / 100);

        // Extrair link de pagamento (API pode retornar em campos diferentes)
        const paymentLinkCanonical: string | null =
          receivable.share_url || receivable.url || receivable.payment_url || null;

        if (existing && existing.length > 0) {
          // Atualizar boleto existente
          const updateData: any = {
            amount: receivable.amount,
            dueDate: dueDate,
            status: status,
            collectionScore: collectionScore.toFixed(2),
            updatedAt: new Date(),
          };
          if (paymentLinkCanonical) {
            updateData.paymentLinkCanonical = paymentLinkCanonical;
          }
          await db
            .update(receivables)
            .set(updateData)
            .where(eq(receivables.contaAzulId, receivable.id));

          console.log(`[DB] ✅ Boleto atualizado: ${receivable.id} (link: ${paymentLinkCanonical || 'null'})`);
        } else {
          // Inserir novo boleto
          await db.insert(receivables).values({
            contaAzulId: receivable.id,
            clientId: clientId,
            amount: String(receivable.amount),
            dueDate: dueDate,
            status: status,
            collectionScore: collectionScore.toFixed(2),
            paymentLinkCanonical: paymentLinkCanonical,
          });

          console.log(`[DB] ✅ Boleto inserido: ${receivable.id} (link: ${paymentLinkCanonical || 'null'})`);
        }

        synced++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[DB] ❌ Erro ao sincronizar boleto ${receivable.id}:`, errorMsg);
        errors.push(`Boleto ${receivable.id}: ${errorMsg}`);
      }
    }

    return { synced, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[DB] Erro ao sincronizar boletos:", errorMsg);
    throw error;
  }
}

/**
 * 🔄 Executar sincronização completa
 */
export async function executeFullSync(): Promise<SyncResult> {
  try {
    console.log("\n[Sync] 🔄 Iniciando sincronização completa...\n");

    // 1. Validar autenticação
    const authResult = await validateContaAzulAuth();
    if (!authResult.valid || !authResult.token) {
      throw new Error(authResult.error || "Falha na autenticação");
    }

    // 2. Buscar clientes
    const customersFromAPI = await fetchClientsFromContaAzul(authResult.token);

    // 3. Sincronizar clientes
    const clientsResult = await syncClientsToDatabase(customersFromAPI);

    // 4. Buscar boletos
    const receivablesFromAPI = await fetchReceivablesFromContaAzul(authResult.token);

    // 5. Sincronizar boletos
    const receivablesResult = await syncReceivablesToDatabase(receivablesFromAPI);

    const result: SyncResult = {
      success: true,
      clientsSynced: clientsResult.synced,
      receivablesSynced: receivablesResult.synced,
      errors: [...clientsResult.errors, ...receivablesResult.errors],
      warnings: clientsResult.warnings || [],
      timestamp: new Date().toISOString(),
    };

    console.log("\n[Sync] ✅ Sincronização concluída!\n");
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Sync] ❌ Erro na sincronização:", errorMsg);

    return {
      success: false,
      clientsSynced: 0,
      receivablesSynced: 0,
      errors: [errorMsg],
      warnings: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 📋 Formatar resultado da sincronização para log
 */
export function formatSyncResult(result: SyncResult): string {
  let output = "\n" + "═".repeat(70) + "\n";
  output += "📊 RESULTADO DA SINCRONIZAÇÃO\n";
  output += "═".repeat(70) + "\n\n";

  output += `Status: ${result.success ? "✅ SUCESSO" : "❌ FALHA"}\n`;
  output += `Clientes sincronizados: ${result.clientsSynced}\n`;
  output += `Boletos sincronizados: ${result.receivablesSynced}\n`;

  if (result.warnings.length > 0) {
    output += `\n⚠️ Avisos (${result.warnings.length}):\n`;
    result.warnings.forEach(w => {
      output += `   - ${w}\n`;
    });
  }

  if (result.errors.length > 0) {
    output += `\n❌ Erros (${result.errors.length}):\n`;
    result.errors.forEach(e => {
      output += `   - ${e}\n`;
    });
  }

  output += `\nTimestamp: ${result.timestamp}\n`;
  output += "═".repeat(70) + "\n";

  return output;
}
