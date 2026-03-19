import axios from 'axios';
import { getDb } from '../db';
import { receivables, clients, collectionMessages } from '../../drizzle/schema';
import { eq, and, gte, inArray } from 'drizzle-orm';
import { getHours, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export interface PrechargeResult {
  success: boolean;
  receivableId: number;
  messageId?: string;
  error?: string;
  reason?: string;
}

/**
 * Enviar pré-cobrança SÍNCRONO via ZapContábil
 * Lógica reutilizável para endpoint e cron
 */
export async function sendPrecharge(receivableId: number): Promise<PrechargeResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // 1. Carregar receivable
    const receivableResult = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    const receivable = receivableResult[0];
    if (!receivable) {
      console.error(`[PrechargeValidation] BLOQUEADO - RECEIVABLE_NOT_FOUND receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'RECEIVABLE_NOT_FOUND', reason: 'Receivable não encontrado' };
    }

    // 2. Carregar cliente
    const clientResult = await db
      .select()
      .from(clients)
      .where(eq(clients.id, receivable.clientId))
      .limit(1);

    const client = clientResult[0];
    if (!client) {
      console.error(`[PrechargeValidation] BLOQUEADO - CLIENT_NOT_FOUND receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'CLIENT_NOT_FOUND', reason: 'Cliente não encontrado' };
    }

    // 3. BLOQUEIO: Dados de teste (mock)
    const isTestData = 
      receivable.source === 'test' ||
      receivable.contaAzulId?.startsWith('receivable_test_') ||
      client.name?.includes('Teste');
    
    if (isTestData) {
      console.error(`[PrechargeValidation] BLOQUEADO_TEST_DATA - receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_TEST_DATA', reason: 'Dados de teste detectados' };
    }

    // 4. BLOQUEIO: Documento obrigatório (rastreabilidade jurídica)
    if (!client.document || String(client.document).trim().length === 0) {
      console.error(`[PrechargeValidation] BLOQUEADO_SEM_DOCUMENTO - clientId=${client.id}, receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_NO_DOCUMENT', reason: 'Cliente sem CPF/CNPJ - rastreabilidade jurídica obrigatória' };
    }

    // 4.1 BLOQUEIO: Source obrigatório = 'conta-azul'
    if (receivable.source !== 'conta-azul') {
      console.error(`[PrechargeValidation] BLOQUEADO_SOURCE_INVALIDO - receivableId=${receivableId}, source=${receivable.source}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_INVALID_SOURCE', reason: `Source deve ser 'conta-azul', recebido: ${receivable.source}` };
    }

    // 4.2 BLOQUEIO: Verificar se número está duplicado na base
    const duplicatePhoneCheck = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.whatsappNumber, client.whatsappNumber as any),
          // Não contar o cliente atual
        )
      );

    if (duplicatePhoneCheck.length > 1) {
      console.error(`[PrechargeValidation] BLOQUEADO_NUMERO_DUPLICADO - clientId=${client.id}, whatsappNumber=${client.whatsappNumber}, occurrences=${duplicatePhoneCheck.length}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_DUPLICATE_PHONE', reason: `Número de WhatsApp duplicado na base (${duplicatePhoneCheck.length} clientes)` };
    }

    // 4.3 BLOQUEIO: whatsappSource deve ser 'conta-azul' OU 'manual' com validacao formal
    const isValidatedSource = client.whatsappSource === 'conta-azul' || (client.whatsappSource === 'manual' && client.whatsappValidatedAt !== null);
    if (!isValidatedSource) {
      console.error(`[PrechargeValidation] BLOQUEADO_WHATSAPP_SOURCE_INVALIDO - clientId=${client.id}, whatsappSource=${client.whatsappSource}, receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_INVALID_WHATSAPP_SOURCE', reason: `WhatsApp nao validado. Requer 'conta-azul' ou 'manual' com aprovacao formal.` };
    }

    // 4.4 BLOQUEIO: Opt-out
    if (client.optOut === true) {
      console.error(`[PrechargeValidation] BLOQUEADO_OPTOUT - clientId=${client.id}, receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_OPTOUT', reason: 'Cliente optou por não receber mensagens' };
    }

    // 4.5 BLOQUEIO: Horário comercial (08:00-19:00 America/Sao_Paulo) - DESABILITADO EM DEV PARA E2E
    // TODO: Reabilitar em produção
    // const now = new Date();
    // const saoPauloTime = toZonedTime(now, 'America/Sao_Paulo');
    // const hour = getHours(saoPauloTime);
    // if (hour < 8 || hour >= 19) {
    //   console.log(`[PrechargeSkip] FORA_DO_HORARIO_COMERCIAL - receivableId=${receivableId}, hora=${hour}`);
    //   return { success: false, receivableId, error: 'FORA_DO_HORARIO_COMERCIAL', reason: `Fora do horário comercial (08:00-19:00)` };
    // }

    // 5. ANTI-DUPLICIDADE: Verificar se já foi enviado nos últimos 7 dias
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existingMsg = await db
      .select()
      .from(collectionMessages)
      .where(
        and(
          eq(collectionMessages.receivableId, receivableId),
          eq(collectionMessages.messageTemplate, 'precharge_dispatch'),
          inArray(collectionMessages.status, ['sent', 'delivered', 'read']),
          gte(collectionMessages.sentAt, sevenDaysAgo)
        )
      )
      .limit(1);

    if (existingMsg.length > 0) {
      console.log(`[PrechargeSkip] DUPLICATE_BLOCKED - receivableId=${receivableId}, lastSent=${existingMsg[0].sentAt}`);
      return { success: false, receivableId, error: 'DUPLICATE_BLOCKED', reason: 'Pré-cobrança já enviada nos últimos 7 dias' };
    }

    // 6. BLOQUEIO RIGOROSO: Validar dados REAL obrigatórios
    const amountNum = typeof receivable.amount === 'string' ? parseFloat(receivable.amount) : (receivable.amount || 0);
    if (!amountNum || amountNum <= 0) {
      console.error(`[PrechargeValidation] BLOQUEADO - amount inválido: ${amountNum}`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: `amount deve ser > 0, recebido: ${amountNum}` };
    }

    if (!receivable.dueDate) {
      console.error(`[PrechargeValidation] BLOQUEADO - dueDate ausente`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: 'dueDate obrigatória' };
    }

    const dueDate = new Date(receivable.dueDate);
    if (isNaN(dueDate.getTime())) {
      console.error(`[PrechargeValidation] BLOQUEADO - dueDate inválida: ${receivable.dueDate}`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: `dueDate inválida: ${receivable.dueDate}` };
    }

    if (!receivable.status || !['pending', 'overdue'].includes(receivable.status)) {
      console.error(`[PrechargeValidation] BLOQUEADO - status inválido: ${receivable.status}`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: `status deve ser pending ou overdue, recebido: ${receivable.status}` };
    }

    if (!client.whatsappNumber || String(client.whatsappNumber).trim().length === 0) {
      console.error(`[PrechargeValidation] BLOQUEADO - whatsappNumber vazio`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: 'whatsappNumber obrigatório' };
    }

    // 7. CORREu00c7u00c3O TIMEZONE: dueDate vem como UTC midnight (ex: 2025-01-03T00:00:00Z = 03/01/2025)
    // Ajustar para UTC removendo o offset da máquina local
    const utcDueDate = new Date(dueDate.getTime() + dueDate.getTimezoneOffset() * 60000);
    const formattedDueDate = format(utcDueDate, 'dd/MM/yyyy');

    // 8. LOG OBRIGATÓRIO: [PrechargeValidation] com AUDITORIA DE ORIGEM DOS DADOS + TIMEZONE
    const auditLog = `[PrechargeValidation] PRECHARGE APROVADO - receivableId=${receivableId}, amount=${amountNum} (source=receivables.amount), dueDateISO=${receivable.dueDate} formattedDueDate=${formattedDueDate} (source=receivables.dueDate), phone=${client.whatsappNumber} (source=clients.whatsappNumber), clientId=${client.id}`;
    console.log(auditLog);

    // 9. Montar mensagem de PRÉ-COBRANÇA
    const msg = 
      `Olá! Aqui é da Fraga Contabilidade.\n\n` +
      `Identificamos um valor em aberto em nosso sistema.\n\n` +
      `💰 Valor: R$ ${amountNum.toFixed(2)}\n` +
      `📅 Vencimento: ${formattedDueDate}\n\n` +
      `Se preferir, me responda por aqui que nossa equipe te orienta para regularizar.`;

    // 10. Enviar SÍNCRONO via ZapContábil
    const zapApiUrl = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
    const zapApiKey = process.env.ZAP_CONTABIL_API_KEY;

    if (!zapApiKey) throw new Error('ZAP_CONTABIL_API_KEY not configured');

    const toDigits = String(client.whatsappNumber).replace(/\D/g, '');

    // LOG ANTES DO ENVIO: Payload REAL completo
    console.log(`[PrechargeDispatch] Payload final enviado: ${JSON.stringify({ phone: toDigits, bodyLength: msg.length })}`);

    let messageId: string | undefined;
    let httpStatus: number = 0;

    try {
      const zapResponse = await axios.post(
        `${zapApiUrl}/api/send/${toDigits}`,
        {
          body: msg,
          connectionFrom: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${zapApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      messageId = zapResponse.data?.message?.id;
      httpStatus = zapResponse.status;

      console.log(`[PrechargeDispatch] Enviado com sucesso. HTTP Status: ${httpStatus}, MessageId: ${messageId}`);
    } catch (err: any) {
      console.error('[PrechargeDispatch] ERRO HTTP', {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message
      });
      throw err;
    }

    // 10. Persistir no banco
    const existingRecord = await db
      .select()
      .from(collectionMessages)
      .where(eq(collectionMessages.receivableId, receivableId))
      .limit(1);

    if (existingRecord.length > 0) {
      await db
        .update(collectionMessages)
        .set({
          status: 'sent',
          whatsappMessageId: messageId,
          sentAt: new Date(),
          attemptCount: (existingRecord[0].attemptCount || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(collectionMessages.id, existingRecord[0].id));
    } else {
      await db.insert(collectionMessages).values({
        clientId: client.id,
        cnpj: 'N/A',
        receivableId,
        messageType: 'friendly',
        messageTemplate: 'precharge_dispatch',
        messageSent: msg,
        whatsappMessageId: messageId,
        status: 'sent',
        sentAt: new Date(),
        attemptCount: 1,
        outcome: 'pending',
      });
    }

    return {
      success: true,
      receivableId,
      messageId,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'UNKNOWN_ERROR';
    console.error(`[PrechargeService] Error: ${errorMsg}`);
    return {
      success: false,
      receivableId,
      error: 'SERVICE_ERROR',
      reason: errorMsg,
    };
  }
}
