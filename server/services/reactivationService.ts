import axios from 'axios';
import { getDb } from '../db';
import { receivables, clients, collectionMessages } from '../../drizzle/schema';
import { eq, and, gte, lte, inArray, desc, isNotNull, sql } from 'drizzle-orm';
import { format } from 'date-fns';

export interface ReactivationResult {
  success: boolean;
  receivableId: number;
  messageId?: string;
  error?: string;
  reason?: string;
}

/**
 * Enviar reativação SÍNCRONO via ZapContábil
 * Para receivables vencidos há 90+ dias
 */
export async function sendReactivation(receivableId: number): Promise<ReactivationResult> {
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
      console.error(`[ReactivationValidation] BLOQUEADO - RECEIVABLE_NOT_FOUND receivableId=${receivableId}`);
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
      console.error(`[ReactivationValidation] BLOQUEADO - CLIENT_NOT_FOUND receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'CLIENT_NOT_FOUND', reason: 'Cliente não encontrado' };
    }

    // 3. BLOQUEIO: Dados de teste (mock)
    const isTestData = 
      receivable.source === 'test' ||
      receivable.contaAzulId?.startsWith('receivable_test_') ||
      client.name?.includes('Teste');
    
    if (isTestData) {
      console.error(`[ReactivationValidation] BLOQUEADO_TEST_DATA - receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_TEST_DATA', reason: 'Dados de teste detectados' };
    }

    // 4. BLOQUEIO: Documento obrigatório (rastreabilidade jurídica)
    if (!client.document || String(client.document).trim().length === 0) {
      console.error(`[ReactivationValidation] BLOQUEADO_SEM_DOCUMENTO - clientId=${client.id}, receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_NO_DOCUMENT', reason: 'Cliente sem CPF/CNPJ - rastreabilidade jurídica obrigatória' };
    }

    // 4.1 BLOQUEIO: Source obrigatório = 'conta-azul'
    if (receivable.source !== 'conta-azul') {
      console.error(`[ReactivationValidation] BLOQUEADO_SOURCE_INVALIDO - receivableId=${receivableId}, source=${receivable.source}`);
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
      console.error(`[ReactivationValidation] BLOQUEADO_NUMERO_DUPLICADO - clientId=${client.id}, whatsappNumber=${client.whatsappNumber}, occurrences=${duplicatePhoneCheck.length}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_DUPLICATE_PHONE', reason: `Número de WhatsApp duplicado na base (${duplicatePhoneCheck.length} clientes)` };
    }

    // 4.3 BLOQUEIO: whatsappSource deve ser 'conta-azul' (origem validada)
    if (client.whatsappSource !== 'conta-azul') {
      console.error(`[ReactivationValidation] BLOQUEADO_WHATSAPP_SOURCE_INVALIDO - clientId=${client.id}, whatsappSource=${client.whatsappSource}, receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_INVALID_WHATSAPP_SOURCE', reason: `WhatsApp não validado (source=${client.whatsappSource}). Apenas 'conta-azul' permitido.` };
    }

    // 4.4 BLOQUEIO: Opt-out
    if (client.optOut === true) {
      console.error(`[ReactivationValidation] BLOQUEADO_OPTOUT - clientId=${client.id}, receivableId=${receivableId}`);
      return { success: false, receivableId, error: 'DISPATCH_BLOCKED_OPTOUT', reason: 'Cliente optou por não receber mensagens' };
    }

    // 5. ANTI-DUPLICIDADE: Verificar se já foi enviado nos últimos 7 dias
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existingMsg = await db
      .select()
      .from(collectionMessages)
      .where(
        and(
          eq(collectionMessages.receivableId, receivableId),
          eq(collectionMessages.messageTemplate, 'reactivation_90plus'),
          inArray(collectionMessages.status, ['sent', 'delivered', 'read']),
          gte(collectionMessages.sentAt, sevenDaysAgo)
        )
      )
      .limit(1);

    if (existingMsg.length > 0) {
      console.log(`[ReactivationSkip] DUPLICATE_BLOCKED - receivableId=${receivableId}, lastSent=${existingMsg[0].sentAt}`);
      return { success: false, receivableId, error: 'DUPLICATE_BLOCKED', reason: 'Reativação já enviada nos últimos 7 dias' };
    }

    // 6. BLOQUEIO RIGOROSO: Validar dados REAL obrigatórios
    const amountNum = typeof receivable.amount === 'string' ? parseFloat(receivable.amount) : (receivable.amount || 0);
    if (!amountNum || amountNum <= 0) {
      console.error(`[ReactivationValidation] BLOQUEADO - amount inválido: ${amountNum}`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: `amount deve ser > 0, recebido: ${amountNum}` };
    }

    if (!receivable.dueDate) {
      console.error(`[ReactivationValidation] BLOQUEADO - dueDate ausente`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: 'dueDate obrigatória' };
    }

    const dueDate = new Date(receivable.dueDate);
    if (isNaN(dueDate.getTime())) {
      console.error(`[ReactivationValidation] BLOQUEADO - dueDate inválida: ${receivable.dueDate}`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: `dueDate inválida: ${receivable.dueDate}` };
    }

    // 7. VALIDAÇÃO: 90+ dias de atraso
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    if (dueDate > ninetyDaysAgo) {
      console.error(`[ReactivationValidation] BLOQUEADO - receivable não está 90+ dias vencido`);
      return { success: false, receivableId, error: 'NOT_90PLUS_OVERDUE', reason: `Receivable venceu em ${dueDate.toISOString()}, não está 90+ dias atrasado` };
    }

    if (!receivable.status || !['pending', 'overdue'].includes(receivable.status)) {
      console.error(`[ReactivationValidation] BLOQUEADO - status inválido: ${receivable.status}`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: `status deve ser pending ou overdue, recebido: ${receivable.status}` };
    }

    if (!client.whatsappNumber || String(client.whatsappNumber).trim().length === 0) {
      console.error(`[ReactivationValidation] BLOQUEADO - whatsappNumber vazio`);
      return { success: false, receivableId, error: 'REAL_DATA_REQUIRED', reason: 'whatsappNumber obrigatório' };
    }

    // 8. CORREÇÃO TIMEZONE: dueDate vem como UTC midnight
    const utcDueDate = new Date(dueDate.getTime() + dueDate.getTimezoneOffset() * 60000);
    const formattedDueDate = format(utcDueDate, 'dd/MM/yyyy');

    // 9. LOG OBRIGATÓRIO: [ReactivationValidation] com AUDITORIA DE ORIGEM DOS DADOS
    const auditLog = `[ReactivationValidation] APROVADO - receivableId=${receivableId}, amount=${amountNum} (source=receivables.amount), dueDateISO=${receivable.dueDate} formattedDueDate=${formattedDueDate} (source=receivables.dueDate), phone=${client.whatsappNumber} (source=clients.whatsappNumber), clientId=${client.id}, daysOverdue=${Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000))}`;
    console.log(auditLog);

    // 10. Montar mensagem de REATIVAÇÃO (SEM BOLETO)
    const msg = 
      `Olá! Aqui é da Fraga Contabilidade.\n\n` +
      `Estamos fazendo uma atualização de pendências antigas no sistema e identificamos um valor em aberto vinculado ao seu cadastro.\n\n` +
      `💰 Valor: R$ ${amountNum.toFixed(2)}\n` +
      `📅 Vencimento: ${formattedDueDate}\n\n` +
      `Você confirma se ainda está pendente ou já foi resolvido?\n\n` +
      `Se preferir, responda por aqui que nossa equipe te orienta para regularizar.`;

    // 11. Enviar SÍNCRONO via ZapContábil
    const zapApiUrl = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
    const zapApiKey = process.env.ZAP_CONTABIL_API_KEY;

    if (!zapApiKey) throw new Error('ZAP_CONTABIL_API_KEY not configured');

    const toDigits = String(client.whatsappNumber).replace(/\D/g, '');

    // LOG ANTES DO ENVIO: Payload REAL completo
    console.log(`[ReactivationDispatch] Payload final enviado: ${JSON.stringify({ phone: toDigits, bodyLength: msg.length })}`);

    let messageId: string | undefined;
    let httpStatus: number = 0;

    try {
      const response = await axios.post(
        `${zapApiUrl}/api/send`,
        { to: toDigits, body: msg },
        { headers: { Authorization: `Bearer ${zapApiKey}` }, timeout: 10000 }
      );

      httpStatus = response.status;
      messageId = response.data?.messageId || response.data?.id || 'unknown';
      console.log(`[ReactivationDispatch] Enviado com sucesso. HTTP Status: ${httpStatus}, MessageId: ${messageId}`);
    } catch (error: any) {
      httpStatus = error.response?.status || 500;
      const errorMsg = error.response?.data?.message || error.message;
      console.error(`[ReactivationDispatch] Erro ao enviar. HTTP Status: ${httpStatus}, Erro: ${errorMsg}`);
      throw error;
    }

    // 12. Persistir em collectionMessages
    const now = new Date();
    await db.insert(collectionMessages).values({
      receivableId,
      clientId: client.id,
      messageTemplate: 'reactivation_90plus',
      kind: 'reactivation',
      whatsappNumber: client.whatsappNumber,
      whatsappMessageId: messageId,
      status: 'sent',
      sentAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify({
        amount: amountNum,
        dueDate: formattedDueDate,
        daysOverdue: Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000)),
        httpStatus,
      }),
    } as any);

    return { success: true, receivableId, messageId };
  } catch (error: any) {
    console.error(`[ReactivationError] ${error.message}`);
    return { success: false, receivableId, error: 'DISPATCH_ERROR', reason: error.message };
  }
}

/**
 * Buscar candidatos para reativação (90+ dias vencidos)
 * 
 * DEFESA DUPLA:
 * 1. Filtros de qualidade NA QUERY (bloqueio na origem)
 * 2. Validação rígida no service (segunda barreira)
 */
export async function getReactivationCandidates(limit: number = 10): Promise<any[]> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // ============================================================
    // BARREIRA 1: FILTROS DE QUALIDADE NA QUERY
    // ============================================================
    // Trazer SOMENTE receivables elegíveis com clientes validados
    // Bloqueios estruturais:
    // - receivable.source = 'conta-azul'
    // - receivable.status IN ('pending', 'overdue')
    // - receivable.dueDate <= (hoje - 90 dias)
    // - client.document NOT NULL (rastreabilidade jurídica OBRIGATÓRIA)
    // - client.whatsappNumber NOT NULL e não vazio
    // - client.whatsappSource = 'conta-azul' (validado)
    // - client.optOut = false
    // ============================================================
    
    const candidates = await db
      .select({
        id: receivables.id,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        status: receivables.status,
        clientId: receivables.clientId,
        clientName: clients.name,
        whatsappNumber: clients.whatsappNumber,
        optOut: clients.optOut,
        document: clients.document,
        whatsappSource: clients.whatsappSource,
      })
      .from(receivables)
      .innerJoin(clients, eq(receivables.clientId, clients.id))
      .where(
        and(
          // Receivable quality checks
          eq(receivables.source, 'conta-azul'),
          inArray(receivables.status, ['pending', 'overdue']),
          lte(receivables.dueDate, ninetyDaysAgo),
          
          // Client quality checks (DEFESA NA ORIGEM)
          isNotNull(clients.document),
          sql`TRIM(COALESCE(${clients.document}, '')) <> ''`,
          isNotNull(clients.whatsappNumber),
          sql`TRIM(COALESCE(${clients.whatsappNumber}, '')) <> ''`,
          eq(clients.whatsappSource, 'conta-azul'),
          eq(clients.optOut, false)
        )
      )
      .limit(limit * 3); // Fetch more to filter and sort in memory

    // Sort by amount descending in memory
    candidates.sort((a, b) => {
      const amountA = typeof a.amount === 'string' ? parseFloat(a.amount) : a.amount;
      const amountB = typeof b.amount === 'string' ? parseFloat(b.amount) : b.amount;
      return amountB - amountA;
    });

    // Filtrar: remover test data e sem reativação enviada nos últimos 7 dias
    const filtered: typeof candidates = [];
    for (const candidate of candidates) {
      // Skip test data
      if (candidate.clientName?.includes('Teste')) continue;

      // Check if reactivation already sent in last 7 days
      const existingMsg = await db
        .select()
        .from(collectionMessages)
        .where(
          and(
            eq(collectionMessages.receivableId, candidate.id),
            eq(collectionMessages.messageTemplate, 'reactivation_90plus'),
            inArray(collectionMessages.status, ['sent', 'delivered', 'read']),
            gte(collectionMessages.sentAt, sevenDaysAgo)
          )
        )
        .limit(1);

      if (existingMsg.length === 0) {
        filtered.push(candidate);
      }

      if (filtered.length >= limit) break;
    }

    return filtered;
  } catch (error: any) {
    console.error(`[ReactivationCandidates] Erro: ${error.message}`);
    return [];
  }
}
