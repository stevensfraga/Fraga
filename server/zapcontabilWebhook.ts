import axios from 'axios';
import crypto from 'crypto';
import { processClientMessage, initializeCollectionAgent, logConversationResult } from './collectionAIAgent';
import { findClientByExactPhoneNumber, findClientByPhoneNumber, normalizePhoneNumber } from './phoneNumberLookup';

/**
 * Webhook para receber mensagens do ZapContábil
 * Integra o agente de IA com a API de WhatsApp
 */

interface ZapContabilMessage {
  from: string; // Número de telefone
  body: string; // Conteúdo da mensagem
  timestamp: number;
  messageId: string;
  contactName?: string;
  contactId?: string;
}

interface ZapContabilResponse {
  to: string;
  body: string;
  connectionFrom?: number;
}

/**
 * Processa mensagem recebida do ZapContábil
 */
export async function handleIncomingMessage(message: ZapContabilMessage): Promise<void> {
  try {
    console.log(`[ZapContábil Webhook] Mensagem recebida de ${message.from}: ${message.body}`);

    // Buscar cliente por número de telefone
    let client = await findClientByExactPhoneNumber(message.from);
    
    if (!client) {
      // Tentar busca parcial
      client = await findClientByPhoneNumber(message.from);
    }

    if (!client) {
      console.warn(`[ZapContábil Webhook] Cliente não encontrado para telefone: ${message.from}`);
      // Enviar mensagem padrão
      await sendMessage(message.from, 'Desculpe, não consegui identificar sua conta. Por favor, entre em contato com nosso suporte.');
      return;
    }

    console.log(`[ZapContábil Webhook] Cliente identificado: ${client.name} (ID: ${client.id})`);

    // Inicializar agente
    const context = await initializeCollectionAgent(client.contaAzulId, client.id.toString());

    // Processar mensagem com agente
    const { response } = await processClientMessage(context, message.body);

    // Enviar resposta
    await sendMessage(message.from, response);

    // Registrar interação
    console.log(`[ZapContábil Webhook] Resposta enviada para ${message.from}`);
  } catch (error) {
    console.error('[ZapContábil Webhook] Erro ao processar mensagem:', error);
    
    // Enviar mensagem de erro
    try {
      await sendMessage(message.from, 'Desculpe, houve um erro ao processar sua mensagem. Tente novamente mais tarde.');
    } catch (sendError) {
      console.error('[ZapContábil Webhook] Erro ao enviar mensagem de erro:', sendError);
    }
  }
}

/**
 * Envia mensagem via ZapContábil API
 */
export async function sendMessage(phoneNumber: string, messageBody: string): Promise<void> {
  try {
    const apiUrl = process.env.ZAPCONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
    const apiKey = process.env.WHATSAPP_API_KEY;

    if (!apiKey) {
      throw new Error('WHATSAPP_API_KEY não configurada');
    }

    // Formatar número (remover caracteres especiais)
    const formattedPhone = phoneNumber.replace(/[^\d]/g, '');

    // Enviar via API
    const response = await axios.post(
      `${apiUrl}/api/send/${formattedPhone}`,
      {
        body: messageBody,
        connectionFrom: 0 // Usar conexão padrão
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log(`[ZapContábil API] Mensagem enviada com sucesso para ${formattedPhone}:`, response.data);
  } catch (error) {
    console.error(`[ZapContábil API] Erro ao enviar mensagem para ${phoneNumber}:`, error);
    throw error;
  }
}

/**
 * Busca cliente por número de telefone (função auxiliar)
 */
async function findClientByCnpj(phoneNumber: string): Promise<string | null> {
  try {
    const normalized = normalizePhoneNumber(phoneNumber);
    const client = await findClientByPhoneNumber(normalized);
    
    if (client) {
      return client.contaAzulId;
    }
    
    return null;
  } catch (error) {
    console.error('[ZapContábil] Erro ao buscar cliente:', error);
    return null;
  }
}

/**
 * Valida assinatura do webhook (segurança)
 */
export function validateWebhookSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return hash === signature;
  } catch (error) {
    console.error('[ZapContábil Webhook] Erro ao validar assinatura:', error);
    return false;
  }
}

/**
 * Processa webhook de status de mensagem
 * (Confirmação de entrega, leitura, etc)
 */
export async function handleMessageStatus(
  messageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  phoneNumber: string
): Promise<void> {
  try {
    console.log(`[ZapContábil Webhook] Status da mensagem ${messageId}: ${status}`);

    // TODO: Atualizar banco de dados com status
    // TODO: Registrar no histórico de mensagens
  } catch (error) {
    console.error('[ZapContábil Webhook] Erro ao processar status:', error);
  }
}
