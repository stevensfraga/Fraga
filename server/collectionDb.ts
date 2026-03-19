import { eq, and, gte, lte } from "drizzle-orm";
import {
  clients,
  receivables,
  collectionMessages,
  agreements,
  Client,
  Receivable,
  CollectionMessage,
  Agreement,
  InsertClient,
  InsertReceivable,
  InsertCollectionMessage,
  InsertAgreement,
} from "../drizzle/schema";
import { getDb } from "./db";

/**
 * Buscar clientes com contas a receber
 */
export async function getOverdueClients() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(clients)
    .where(eq(clients.status, "active"));
}

/**
 * Buscar contas a receber em atraso
 */
export async function getOverdueReceivables() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(receivables)
    .where(eq(receivables.status, "overdue"));
}

/**
 * Buscar contas a receber por faixa de atraso
 */
export async function getReceivablesByOverdueRange(
  minMonths: number,
  maxMonths: number
) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(receivables)
    .where(
      and(
        eq(receivables.status, "overdue"),
        gte(receivables.monthsOverdue, minMonths),
        lte(receivables.monthsOverdue, maxMonths)
      )
    );
}

/**
 * Criar ou atualizar cliente
 */
export async function upsertClient(client: InsertClient) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db
      .insert(clients)
      .values(client)
      .onDuplicateKeyUpdate({
        set: {
          name: client.name,
          email: client.email,
          phone: client.phone,
          whatsappNumber: client.whatsappNumber,
          cnae: client.cnae,
          status: client.status,
          updatedAt: new Date(),
        },
      });

    return result;
  } catch (error) {
    console.error("Error upserting client:", error);
    throw error;
  }
}

/**
 * Criar ou atualizar conta a receber
 */
export async function upsertReceivable(receivable: InsertReceivable) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db
      .insert(receivables)
      .values(receivable)
      .onDuplicateKeyUpdate({
        set: {
          amount: receivable.amount,
          dueDate: receivable.dueDate,
          status: receivable.status,
          monthsOverdue: receivable.monthsOverdue,
          description: receivable.description,
          updatedAt: new Date(),
        },
      });

    return result;
  } catch (error) {
    console.error("Error upserting receivable:", error);
    throw error;
  }
}

/**
 * Registrar mensagem de cobrança
 */
export async function createCollectionMessage(
  message: InsertCollectionMessage
) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(collectionMessages).values(message);
    return result;
  } catch (error) {
    console.error("Error creating collection message:", error);
    throw error;
  }
}

/**
 * Atualizar status de mensagem
 */
export async function updateCollectionMessageStatus(
  messageId: number,
  status: string,
  outcome?: string
) {
  const db = await getDb();
  if (!db) return null;

  try {
    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (outcome) {
      updateData.outcome = outcome;
    }

    const result = await db
      .update(collectionMessages)
      .set(updateData)
      .where(eq(collectionMessages.id, messageId));

    return result;
  } catch (error) {
    console.error("Error updating collection message:", error);
    throw error;
  }
}

/**
 * Registrar resposta de cliente
 */
export async function recordClientResponse(
  messageId: number,
  responseText: string,
  outcome: "agreed" | "paid" | "no_response" | "rejected"
) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db
      .update(collectionMessages)
      .set({
        responseReceived: true,
        responseText,
        responseDate: new Date(),
        outcome,
        updatedAt: new Date(),
      })
      .where(eq(collectionMessages.id, messageId));

    return result;
  } catch (error) {
    console.error("Error recording client response:", error);
    throw error;
  }
}

/**
 * Criar acordo de parcelamento
 */
export async function createAgreement(agreement: InsertAgreement) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(agreements).values(agreement);
    return result;
  } catch (error) {
    console.error("Error creating agreement:", error);
    throw error;
  }
}

/**
 * Buscar histórico de cobranças de um cliente
 */
export async function getClientCollectionHistory(clientId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(collectionMessages)
    .where(eq(collectionMessages.clientId, clientId));
}

/**
 * Buscar estatísticas de cobrança
 */
export async function getCollectionStats() {
  const db = await getDb();
  if (!db) return null;

  try {
    const totalOverdue = await db
      .select()
      .from(receivables)
      .where(eq(receivables.status, "overdue"));

    const friendlyRange = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.status, "overdue"),
          lte(receivables.monthsOverdue, 1)
        )
      );

    const administrativeRange = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.status, "overdue"),
          gte(receivables.monthsOverdue, 2),
          lte(receivables.monthsOverdue, 3)
        )
      );

    const formalRange = await db
      .select()
      .from(receivables)
      .where(
        and(eq(receivables.status, "overdue"), gte(receivables.monthsOverdue, 4))
      );

    const messagesSent = await db
      .select()
      .from(collectionMessages)
      .where(eq(collectionMessages.status, "sent"));

    const responsesReceived = await db
      .select()
      .from(collectionMessages)
      .where(eq(collectionMessages.responseReceived, true));

    return {
      totalOverdue: totalOverdue.length,
      friendlyRange: friendlyRange.length,
      administrativeRange: administrativeRange.length,
      formalRange: formalRange.length,
      messagesSent: messagesSent.length,
      responsesReceived: responsesReceived.length,
      responseRate:
        messagesSent.length > 0
          ? ((responsesReceived.length / messagesSent.length) * 100).toFixed(1)
          : "0",
    };
  } catch (error) {
    console.error("Error getting collection stats:", error);
    throw error;
  }
}
