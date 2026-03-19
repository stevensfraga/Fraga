import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, collectionMessages } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Helpers para histórico de cobranças
export async function saveCollectionMessage(
  clientId: number | string,
  messageType: 'friendly' | 'administrative' | 'formal',
  messageTemplate: string,
  messageSent: string,
  whatsappMessageId?: string,
  cnpj?: string
) {
  const db = await getDb();
  if (!db) {
    console.warn('[Database] Cannot save message: database not available');
    return null;
  }

  try {
    const result = await db.insert(collectionMessages).values({
      clientId: typeof clientId === 'string' ? undefined : clientId,
      cnpj: cnpj || String(clientId),
      messageType,
      messageTemplate,
      messageSent,
      whatsappMessageId,
      status: 'sent',
      sentAt: new Date(),
    });
    return result;
  } catch (error) {
    console.error('[Database] Failed to save collection message:', error);
    throw error;
  }
}

export async function getClientHistory(clientIdOrCnpj: number | string) {
  const db = await getDb();
  if (!db) {
    console.warn('[Database] Cannot get history: database not available');
    return [];
  }

  try {
    // Se for string, buscar por CNPJ; se for número, buscar por clientId
    const whereCondition = typeof clientIdOrCnpj === 'string'
      ? eq(collectionMessages.cnpj, clientIdOrCnpj)
      : eq(collectionMessages.clientId, clientIdOrCnpj);

    const result = await db
      .select()
      .from(collectionMessages)
      .where(whereCondition)
      .orderBy(desc(collectionMessages.createdAt));
    return result;
  } catch (error) {
    console.error('[Database] Failed to get client history:', error);
    return [];
  }
}

export async function updateMessageResponse(
  messageId: number,
  responseText: string,
  outcome: 'agreed' | 'paid' | 'no_response' | 'rejected'
) {
  const db = await getDb();
  if (!db) {
    console.warn('[Database] Cannot update message: database not available');
    return null;
  }

  try {
    const result = await db
      .update(collectionMessages)
      .set({
        responseReceived: true,
        responseText,
        responseDate: new Date(),
        outcome,
      })
      .where(eq(collectionMessages.id, messageId));
    return result;
  } catch (error) {
    console.error('[Database] Failed to update message:', error);
    throw error;
  }
}

// TODO: add feature queries here as your schema grows.
