import axios from "axios";
import { getDb } from "./db";
import { clients } from "../drizzle/schema";
import { eq } from "drizzle-orm";

interface AcessoriasContact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  cellphone?: string;
  company?: {
    id: number;
    name: string;
  };
}

interface AcessoriasCompany {
  id: number;
  name: string;
  cnpj?: string;
  email?: string;
  phone?: string;
}

/**
 * Formata número de telefone para WhatsApp (55 + DDD + número)
 */
export function formatWhatsAppNumber(phone: string): string {
  if (!phone) return "";

  // Remove caracteres especiais
  const cleaned = phone.replace(/\D/g, "");

  // Se já começa com 55, retorna como está
  if (cleaned.startsWith("55")) {
    return cleaned;
  }

  // Se tem 11 dígitos (com DDD), adiciona 55
  if (cleaned.length === 11) {
    return `55${cleaned}`;
  }

  // Se tem 10 dígitos (sem DDD), assume DDD 27 (Espírito Santo)
  if (cleaned.length === 10) {
    return `5527${cleaned}`;
  }

  // Fallback: adiciona 55 no início
  return `55${cleaned}`;
}

/**
 * Busca contatos de uma empresa na API de acessórias
 */
export async function fetchCompanyContacts(
  companyId: number,
  apiUrl: string,
  email: string,
  password: string
): Promise<AcessoriasContact[]> {
  try {
    const response = await axios.get(
      `${apiUrl}/api/v1/companies/${companyId}/contacts`,
      {
        auth: {
          username: email,
          password: password,
        },
        timeout: 10000,
      }
    );

    return response.data?.data || [];
  } catch (error) {
    console.error(`[WhatsApp Sync] Erro ao buscar contatos da empresa ${companyId}:`, error);
    return [];
  }
}

/**
 * Sincroniza números de WhatsApp do banco de acessórias
 */
export async function syncWhatsAppNumbers(
  apiUrl: string,
  email: string,
  password: string
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  try {
    const db = await getDb();
    if (!db) {
      console.error("[WhatsApp Sync] Database not available");
      return { synced: 0, failed: 0 };
    }

    // Buscar todas as empresas do Conta Azul
    const allClients = await db.select().from(clients).limit(1000);

    for (const client of allClients) {
      try {
        // Tentar buscar contatos da empresa no banco de acessórias
        const contacts = await fetchCompanyContacts(
          parseInt(client.contaAzulId),
          apiUrl,
          email,
          password
        );

        if (contacts.length > 0) {
          // Pegar o primeiro contato com telefone celular
          const contact = contacts.find((c) => c.cellphone) || contacts[0];

          if (contact && (contact.cellphone || contact.phone)) {
            const whatsappNumber = formatWhatsAppNumber(
              contact.cellphone || contact.phone || ""
            );

            // Atualizar cliente com número de WhatsApp
            await db
              .update(clients)
              .set({
                whatsappNumber: whatsappNumber,
              })
              .where(eq(clients.id, client.id));

            synced++;
            console.log(
              `[WhatsApp Sync] ✓ Sincronizado: ${client.name} -> ${whatsappNumber}`
            );
          }
        }
      } catch (error) {
        failed++;
        console.error(`[WhatsApp Sync] ✗ Erro ao sincronizar ${client.name}:`, error);
      }
    }

    console.log(
      `[WhatsApp Sync] Sincronização concluída: ${synced} sucesso, ${failed} falhas`
    );
    return { synced, failed };
  } catch (error) {
    console.error("[WhatsApp Sync] Erro geral na sincronização:", error);
    return { synced, failed };
  }
}

/**
 * Busca número de WhatsApp de um cliente
 */
export async function getClientWhatsAppNumber(clientId: number): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) {
      console.error("[WhatsApp] Database not available");
      return null;
    }

    const result = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    const client = result.length > 0 ? result[0] : null;

    return client?.whatsappNumber || null;
  } catch (error) {
    console.error(`[WhatsApp] Erro ao buscar número do cliente ${clientId}:`, error);
    return null;
  }
}

/**
 * Valida número de WhatsApp
 */
export function isValidWhatsAppNumber(phone: string): boolean {
  if (!phone) return false;

  const cleaned = phone.replace(/\D/g, "");

  // Deve ter 12 ou 13 dígitos (55 + DDD + número)
  return cleaned.length >= 12 && cleaned.length <= 13;
}
