import { getDb } from "./db";
import { clients } from "../drizzle/schema";
import { eq, or, like } from "drizzle-orm";

/**
 * Normaliza número de telefone removendo caracteres especiais
 */
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Busca cliente por número de WhatsApp
 */
export async function findClientByPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const db = await getDb();
  
  if (!db) {
    console.warn("[Database] Cannot find client: database not available");
    return null;
  }
  
  // Tentar buscar por whatsappNumber ou phone
  const client = await db
    .select()
    .from(clients)
    .where(
      or(
        like(clients.whatsappNumber, `%${normalized}%`),
        like(clients.phone, `%${normalized}%`)
      )
    )
    .limit(1);

  return client[0] || null;
}

/**
 * Busca cliente por número exato
 */
export async function findClientByExactPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const db = await getDb();
  
  if (!db) {
    console.warn("[Database] Cannot find client: database not available");
    return null;
  }
  
  const client = await db
    .select()
    .from(clients)
    .where(
      or(
        eq(clients.whatsappNumber, normalized),
        eq(clients.phone, normalized),
        eq(clients.whatsappNumber, phoneNumber),
        eq(clients.phone, phoneNumber)
      )
    )
    .limit(1);

  return client[0] || null;
}

/**
 * Busca múltiplos clientes por padrão de telefone
 */
export async function findClientsByPhonePattern(phonePattern: string) {
  const normalized = normalizePhoneNumber(phonePattern);
  const db = await getDb();
  
  if (!db) {
    console.warn("[Database] Cannot find clients: database not available");
    return [];
  }
  
  const clientList = await db
    .select()
    .from(clients)
    .where(
      or(
        like(clients.whatsappNumber, `%${normalized}%`),
        like(clients.phone, `%${normalized}%`)
      )
    )
    .limit(10);

  return clientList;
}

/**
 * Formata número de telefone para WhatsApp (55 + DDD + número)
 */
export function formatPhoneForWhatsApp(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  
  // Se já começa com 55, retorna como está
  if (normalized.startsWith("55")) {
    return normalized;
  }
  
  // Se tem 11 dígitos (DDD + número), adiciona 55
  if (normalized.length === 11) {
    return `55${normalized}`;
  }
  
  // Se tem 10 dígitos, assume que falta o 9 (celular)
  if (normalized.length === 10) {
    return `55${normalized.slice(0, 2)}9${normalized.slice(2)}`;
  }
  
  // Se tem 9 dígitos, assume que falta o DDD
  if (normalized.length === 9) {
    return `5527${normalized}`;
  }
  
  return `55${normalized}`;
}

/**
 * Extrai DDD de um número de telefone
 */
export function extractAreaCode(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  
  if (normalized.startsWith("55")) {
    return normalized.slice(2, 4);
  }
  
  if (normalized.length >= 10) {
    return normalized.slice(0, 2);
  }
  
  return "";
}
