import mysql from 'mysql2/promise';
import axios from 'axios';

export interface DebtSummary {
  clientId: number;
  clientName: string;
  documento: string;
  email: string;
  totalDebt: number;
  titlesCount: number;
  maxDaysOverdue: number;
  paymentLinkCanonical: string | null;
  receivables: Array<{
    id: number;
    amount: number;
    dueDate: Date;
    daysOverdue: number;
    status: string;
  }>;
}

export interface AIAssistantLog {
  fromPhone: string;
  clientId: number | null;
  intent: string;
  dbQueryMeta: any;
  response: string;
  correlationId: string;
  handoffReason?: string;
  handoffToHuman: boolean;
}

// ─── HELPER: conversão segura para número ────────────────────────────────────
function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── HELPER: formatação BRL ──────────────────────────────────────────────────
// Sempre formata como "R$ 255,60" — nunca "255.6"
export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

// ─── PARTE 3: FORCE SYNC ─────────────────────────────────────────────────────
// Sincroniza pagamentos do Conta Azul ANTES de consultar o banco.
// Fluxo: usuário pergunta → syncNow → consultar banco → responder
// Se o sync falhar (token expirado, API offline), continua com dados do banco.
export async function forceSyncPayments(clientId: number): Promise<{ synced: boolean; error?: string }> {
  try {
    console.log(`[AI-Sync] 🔄 Force sync para clientId=${clientId} antes de consultar dívida...`);
    const { syncPaymentsJob } = await import('../syncPaymentsJob');
    const result = await syncPaymentsJob();
    console.log(`[AI-Sync] ✅ Sync concluído: updated=${result.updatedCount}, checked=${result.checkedLocal}`);
    return { synced: true };
  } catch (error: any) {
    // Sync falhou — continuar com dados do banco (não bloquear resposta)
    console.warn(`[AI-Sync] ⚠️ Sync falhou (continuando com banco local): ${error?.message || error}`);
    return { synced: false, error: error?.message };
  }
}

// 1. Resolver cliente por telefone
export async function resolveClientByPhone(fromPhone: string): Promise<{ clientId: number; clientName: string; documento: string; email: string } | null> {
  try {
    const phoneDigits = fromPhone.replace(/\D/g, '');
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    const variants: string[] = [];
    variants.push(`+${phoneDigits}`);

    if (phoneDigits.startsWith('55') && phoneDigits.length >= 12) {
      const withoutCountry = phoneDigits.slice(2);
      variants.push(`+55${withoutCountry}`);
      variants.push(`55${withoutCountry}`);
      variants.push(withoutCountry);
      variants.push(phoneDigits);
    } else {
      variants.push(`+55${phoneDigits}`);
      variants.push(`55${phoneDigits}`);
      variants.push(phoneDigits);
    }

    console.log(`[AI-Resolve] Buscando cliente para phone=${fromPhone}, digits=${phoneDigits}, variants=${JSON.stringify(variants)}`);

    const placeholders = variants.map(() => '?').join(', ');
    const [result] = await conn.execute(
      `SELECT id, name, document, email FROM clients 
       WHERE whatsappNumber IN (${placeholders}) 
          OR phoneCellular IN (${placeholders})
       LIMIT 1`,
      [...variants, ...variants]
    );

    await conn.end();

    if (!result || (result as any[]).length === 0) {
      console.log(`[AI-Resolve] ❌ Cliente NÃO encontrado para nenhuma variante`);
      return null;
    }

    const row = (result as any[])[0];
    console.log(`[AI-Resolve] ✅ Cliente encontrado: id=${row.id}, name=${row.name}`);
    return {
      clientId: row.id,
      clientName: row.name,
      documento: row.document || '',
      email: row.email || '',
    };
  } catch (error) {
    console.error('[AI] Erro ao resolver cliente por telefone:', error);
    return null;
  }
}

// 2. Obter resumo de dívida consolidada
// PARTE 5 – REGRA DE PRIORIDADE:
//   1. sync Conta Azul (via forceSyncPayments)
//   2. consultar receivables
//   3. filtrar somente OPEN / OVERDUE (status IN ('pending','overdue') AND amount > 0)
//   4. calcular atraso
//   5. montar resposta
//   6. enviar
//
// PARTE 2 – REGRA CRÍTICA: NÃO COBRAR FATURA PAGA
//   O sync garante que títulos PAID/RECEIVED no Conta Azul sejam atualizados
//   no banco ANTES da consulta. Assim, nunca aparecem na lista de abertos.
export async function getOpenDebtSummary(clientId: number): Promise<DebtSummary | null> {
  try {
    // PARTE 3 – FORCE SYNC: sincronizar pagamentos antes de consultar banco
    await forceSyncPayments(clientId);

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [clientResult] = await conn.execute(
      `SELECT id, name, document, email FROM clients WHERE id = ? LIMIT 1`,
      [clientId]
    );

    if (!clientResult || (clientResult as any[]).length === 0) {
      await conn.end();
      return null;
    }

    const client = (clientResult as any[])[0];

    // PARTE 2 + PARTE 3: Buscar APENAS títulos em aberto com valor positivo
    // O sync já atualizou títulos PAID/RECEIVED para status='paid' no banco
    const [openReceivables] = await conn.execute(
      `SELECT id, amount, dueDate, status, paymentLinkCanonical FROM receivables 
       WHERE clientId = ? AND status IN ('pending', 'overdue') AND amount > 0
       ORDER BY dueDate ASC`,
      [clientId]
    );

    await conn.end();

    const titles = openReceivables as any[];

    if (!titles || titles.length === 0) {
      console.log(`[AI-Debt] Cliente ${clientId}: nenhum título em aberto após sync`);
      return null;
    }

    console.log('[AI-Debt] sampleTitle[0]:', JSON.stringify({
      id: titles[0].id,
      amount_raw: titles[0].amount,
      amount_parsed: toNumber(titles[0].amount),
      status: titles[0].status,
      dueDate: titles[0].dueDate,
    }));

    // PARTE 6 – FORMATAÇÃO: soma com conversão segura (evitar concatenação)
    const totalDebt = titles.reduce((sum: number, r: any) => sum + toNumber(r.amount), 0);

    if (totalDebt <= 0) {
      console.log(`[AI-Debt] Cliente ${clientId}: totalDebt=${totalDebt} (<=0), sem saldo`);
      return null;
    }

    const now = new Date();

    // PARTE 4 – CÁLCULO DE ATRASO: dias_atraso = hoje - dueDate (só para títulos em aberto)
    // Títulos PAID nunca chegam aqui (filtrados acima), então dias_atraso é sempre >= 0
    const maxDaysOverdue = Math.max(
      ...titles.map((r: any) => {
        const daysOverdue = Math.floor((now.getTime() - new Date(r.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(0, daysOverdue); // nunca negativo
      })
    );

    const paymentLink = titles.find((r: any) => r.paymentLinkCanonical)?.paymentLinkCanonical || null;

    console.log(`[AI-Debt] Cliente ${clientId}: ${titles.length} títulos, total=${formatBRL(totalDebt)}, maxDays=${maxDaysOverdue}, link=${paymentLink ? 'SIM' : 'NÃO'}`);

    return {
      clientId,
      clientName: client.name,
      documento: client.document || '',
      email: client.email || '',
      totalDebt,
      titlesCount: titles.length,
      maxDaysOverdue,
      paymentLinkCanonical: paymentLink,
      receivables: titles.map((r: any) => ({
        id: r.id,
        amount: toNumber(r.amount),
        dueDate: new Date(r.dueDate),
        daysOverdue: Math.max(0, Math.floor((now.getTime() - new Date(r.dueDate).getTime()) / (1000 * 60 * 60 * 24))),
        status: r.status,
      })),
    };
  } catch (error) {
    console.error('[AI] Erro ao obter resumo de dívida:', error);
    return null;
  }
}

// 3. Detectar intenção da mensagem
export function intentDetect(text: string): string {
  const lowerText = text.toLowerCase();

  const keywords: Record<string, string[]> = {
    saldo: ['saldo', 'quanto devo', 'quanto tenho', 'valor em aberto', 'total devido'],
    link: ['link', 'boleto', 'pagar', 'pagamento', 'como pago'],
    negociar: ['negociar', 'parcelar', 'desconto', 'acordo', 'dificuldade'],
    paguei: ['paguei', 'já paguei', 'pagamento realizado', 'transferi', 'depositei'],
    humano: ['falar com humano', 'atendente', 'gerente', 'supervisor'],
    contestar: ['contestar', 'não concordo', 'errado', 'cobrança indevida'],
    juridico: ['jurídico', 'advogado', 'processo', 'ameaça', 'procon'],
    rescisao: ['rescisão', 'cancelar contrato', 'encerrar contrato', 'rescindir'],
  };

  for (const [intent, words] of Object.entries(keywords)) {
    if (words.some((word) => lowerText.includes(word))) {
      return intent;
    }
  }

  return 'desconhecido';
}

// 3b. Verificar se o intent é financeiro
const FINANCIAL_INTENTS = new Set(['saldo', 'link', 'negociar', 'paguei']);

export function isFinancialIntent(intent: string): boolean {
  return FINANCIAL_INTENTS.has(intent);
}

// 4. Construir resposta baseada na intenção
// PARTE 1 – NOVO TEMPLATE OFICIAL:
//   - "Verifiquei em nosso sistema" (nunca "Seu saldo em aberto")
//   - Formatação BRL com Intl.NumberFormat
//   - Link de pagamento incluído quando disponível
//   - Sem dívida: "Verifiquei que no momento não existe nenhum valor em aberto"
export function buildReply(intent: string, debtSummary: DebtSummary | null, handoffReason?: string): string {
  // PARTE 2 – SEM SALDO: nunca enviar link de cobrança
  if (!debtSummary) {
    return 'Olá! 😊\n\nVerifiquei que no momento não existe nenhum valor em aberto conosco.\n\nSe precisar de algo, estou à disposição.';
  }

  const clientName = debtSummary.clientName || 'Cliente';
  const totalDebt = toNumber(debtSummary.totalDebt);
  const titlesCount = toNumber(debtSummary.titlesCount);
  const maxDaysOverdue = toNumber(debtSummary.maxDaysOverdue);
  const { paymentLinkCanonical } = debtSummary;

  // Verificação extra: totalDebt <= 0 mesmo com debtSummary preenchido
  if (totalDebt <= 0) {
    return `Olá, ${clientName}! 😊\n\nVerifiquei que no momento não existe nenhum valor em aberto conosco.\n\nSe precisar de algo, estou à disposição.`;
  }

  // PARTE 6 – FORMATAÇÃO BRL
  const valorFormatado = formatBRL(totalDebt);
  const linkText = paymentLinkCanonical
    ? `Para sua comodidade, você pode visualizar e realizar o pagamento pelo link abaixo:\n\n${paymentLinkCanonical}`
    : 'Para obter o link de pagamento, entre em contato com nosso atendimento.';

  switch (intent) {
    case 'saldo':
    case 'link': {
      // PARTE 1 – TEMPLATE OFICIAL
      return `Olá, ${clientName}! 😊\n\nVerifiquei em nosso sistema e identifiquei a seguinte situação:\n\nValor em aberto: ${valorFormatado}\nQuantidade de títulos: ${titlesCount}\nMaior atraso: ${maxDaysOverdue} dias\n\n${linkText}\n\nAssim que o pagamento for realizado, a baixa ocorre automaticamente em nosso sistema.\n\nSe precisar de ajuda, segunda via ou negociação, é só me avisar por aqui que te ajudo. 😊`;
    }

    case 'negociar':
      return `Olá, ${clientName}! 😊\n\nEntendo sua situação. Verifiquei em nosso sistema um saldo de ${valorFormatado} em aberto.\n\nPara negociar parcelamento ou desconto, vou conectá-lo com nosso atendimento especializado.\n\nAguarde um momento...`;

    case 'paguei':
      return `Olá, ${clientName}! 😊\n\nObrigado pelo pagamento! Verifiquei em nosso sistema e o processamento pode levar até 24h para ser refletido.\n\nSe o pagamento não aparecer confirmado em breve, entre em contato conosco que verificamos para você.`;

    case 'humano':
      return `Olá, ${clientName}! 😊\n\nVou conectá-lo com nosso atendimento agora.\n\nAguarde um momento...`;

    default:
      return `Olá, ${clientName}! 😊\n\nVerifiquei em nosso sistema e identifiquei a seguinte situação:\n\nValor em aberto: ${valorFormatado}\nQuantidade de títulos: ${titlesCount}\nMaior atraso: ${maxDaysOverdue} dias\n\n${linkText}\n\nSe precisar de ajuda, segunda via ou negociação, é só me avisar por aqui que te ajudo. 😊`;
  }
}

// 5. Enviar resposta via WhatsApp (ZapContábil)
export async function sendWhatsAppReply(phone: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string; httpStatus?: number; httpBody?: any }> {
  const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
  const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';

  if (!ZAP_API_KEY) {
    console.error('[AI-Send] ❌ ZAP_CONTABIL_API_KEY não configurada');
    return { success: false, error: 'ZAP_CONTABIL_API_KEY não configurada' };
  }

  const phoneDigits = phone.replace(/\D/g, '');
  const url = `${ZAP_API_URL}/api/send/${phoneDigits}`;
  const queueId = Number(process.env.ZAP_DEFAULT_QUEUE_ID_FINANCEIRO) || undefined;

  console.log(`[AI-Send] 📤 Enviando via ZapContábil:`);
  console.log(`[AI-Send]   URL: ${url}`);
  console.log(`[AI-Send]   phone_raw: ${phone}`);
  console.log(`[AI-Send]   phone_digits: ${phoneDigits}`);
  console.log(`[AI-Send]   text_length: ${text.length}`);
  console.log(`[AI-Send]   queueId: ${queueId || 'nenhum'} (Financeiro)`);
  console.log(`[AI-Send]   api_key_last4: ...${ZAP_API_KEY.slice(-4)}`);

  try {
    const response = await axios.post(
      url,
      {
        body: text,
        connectionFrom: 0,
        ...(queueId ? { queueId } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${ZAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const messageId = response.data?.message?.id || response.data?.messageId || response.data?.id;

    console.log(`[AI-Send] ✅ Resposta ZapContábil:`);
    console.log(`[AI-Send]   HTTP Status: ${response.status}`);
    console.log(`[AI-Send]   messageId: ${messageId || 'N/A'}`);

    return {
      success: true,
      messageId: messageId || `ack_${Date.now()}`,
      httpStatus: response.status,
      httpBody: response.data,
    };
  } catch (error: any) {
    const errMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro desconhecido';
    const httpStatus = error.response?.status || 0;

    console.error(`[AI-Send] ❌ Falha no envio: HTTP ${httpStatus}: ${errMsg}`);

    return {
      success: false,
      error: `HTTP ${httpStatus}: ${errMsg}`,
      httpStatus,
      httpBody: error.response?.data,
    };
  }
}

// 6. Auditar interação do agente IA
export async function auditAIInteraction(log: AIAssistantLog): Promise<void> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    await conn.execute(
      `INSERT INTO ai_assistant_log (fromPhone, clientId, intent, dbQueryMeta, response, correlationId, handoffToHuman, handoffReason) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.fromPhone,
        log.clientId,
        log.intent,
        typeof log.dbQueryMeta === 'string' ? log.dbQueryMeta : JSON.stringify(log.dbQueryMeta),
        log.response,
        log.correlationId,
        log.handoffToHuman,
        log.handoffReason || null,
      ]
    );
    await conn.end();
  } catch (error) {
    console.error('[AI] Erro ao auditar interação:', error);
  }
}
