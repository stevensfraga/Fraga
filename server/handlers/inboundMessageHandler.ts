import { getDb } from '../db';
import { clients, collectionMessages } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Detectar palavras-chave de opt-out em mensagens inbound
 * Padrões: PARAR, SAIR, STOP, NÃO QUERO, REMOVER
 */
const OPT_OUT_KEYWORDS = [
  'parar',
  'sair',
  'stop',
  'não quero',
  'nao quero',
  'remover',
  'deletar',
  'desinscrever',
  'unsubscribe',
  'deixar de receber',
];

export interface InboundMessage {
  whatsappNumber: string;
  messageText: string;
  messageId?: string;
  timestamp?: Date;
}

/**
 * Processar mensagem inbound e detectar opt-out
 */
export async function handleInboundMessage(msg: InboundMessage): Promise<{
  success: boolean;
  optOutDetected: boolean;
  clientId?: number;
  reason?: string;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 1. Buscar cliente pelo número de WhatsApp
    const toDigits = msg.whatsappNumber.replace(/\D/g, '');
    const clientResult = await db
      .select()
      .from(clients)
      .where(eq(clients.whatsappNumber, toDigits))
      .limit(1);

    if (!clientResult[0]) {
      console.log(`[InboundHandler] Cliente não encontrado para número: ${toDigits}`);
      return { success: false, optOutDetected: false, reason: 'CLIENT_NOT_FOUND' };
    }

    const client = clientResult[0];

    // 2. Detectar palavras-chave de opt-out
    const messageNormalized = msg.messageText.toLowerCase().trim();
    const optOutDetected = OPT_OUT_KEYWORDS.some(keyword => 
      messageNormalized.includes(keyword)
    );

    if (optOutDetected) {
      // 3. Marcar cliente como opt-out
      await db
        .update(clients)
        .set({ optOut: true, updatedAt: new Date() })
        .where(eq(clients.id, client.id));

      console.log(`[InboundHandler] OPT_OUT_DETECTED - clientId=${client.id}, phone=${toDigits}`);

      // 4. Registrar a mensagem no histórico
      await db.insert(collectionMessages).values({
        clientId: client.id,
        cnpj: client.document || 'N/A',
        messageType: 'administrative',
        messageTemplate: 'inbound_optout',
        messageSent: msg.messageText,
        whatsappMessageId: msg.messageId,
        status: 'delivered',
        responseReceived: true,
        responseText: msg.messageText,
        responseDate: msg.timestamp || new Date(),
        sentiment: 'negative',
        outcome: 'agreed',
      });

      return {
        success: true,
        optOutDetected: true,
        clientId: client.id,
        reason: 'OPT_OUT_KEYWORD_DETECTED',
      };
    }

    // 5. Registrar mensagem recebida (sem opt-out)
    await db.insert(collectionMessages).values({
      clientId: client.id,
      cnpj: client.document || 'N/A',
      messageType: 'friendly',
      messageTemplate: 'inbound_response',
      messageSent: msg.messageText,
      whatsappMessageId: msg.messageId,
      status: 'delivered',
      responseReceived: true,
      responseText: msg.messageText,
      responseDate: msg.timestamp || new Date(),
      sentiment: 'neutral',
      outcome: 'no_response',
    });

    console.log(`[InboundHandler] Mensagem registrada - clientId=${client.id}, phone=${toDigits}`);

    return {
      success: true,
      optOutDetected: false,
      clientId: client.id,
    };
  } catch (err: any) {
    console.error('[InboundHandler] Error:', err?.message);
    return {
      success: false,
      optOutDetected: false,
      reason: err?.message,
    };
  }
}
