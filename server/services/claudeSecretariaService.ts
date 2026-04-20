/**
 * ────────────────────────────────────────────────────────────────────────────
 *  Secretária Virtual — Fraga Contabilidade
 *  Powered by Claude (Anthropic)
 *
 *  Mapeamento de setores baseado na configuração real da Juliana (ZapContábil).
 *  Nomes EXATOS como cadastrados no ZapContábil — qualquer variação causa
 *  erro de roteamento.
 * ────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';
import mysql from 'mysql2/promise';
import { resolveClientByPhone, getOpenDebtSummary, formatBRL } from '../collection/aiDebtAssistant';

// ─── MAPA DE SETORES (nomes EXATOS do ZapContábil) ───────────────────────────
//
// ⚠️  ATENÇÃO: estes nomes devem ser idênticos ao cadastro no ZapContábil.
//     Qualquer diferença de acento, maiúscula ou espaço quebra a transferência.
//
// queueId 6 (Nota Fiscal) NUNCA deve ser usado como destino — tudo de NF
// vai para Setor Fiscal (queueId=3), conforme configuração da Juliana.

export const QUEUE_MAP: Record<number, string> = {
  1:  'Registro de Empresa Alvaras CND Taxas',
  2:  'Departamento Pessoal',
  3:  'Setor Fiscal',
  4:  'Balanço Balancetes DRE (Setor Contabil)',
  5:  'Financeiro',
  // 6: NÃO USAR — NF vai para Setor Fiscal
  7:  'Certificado Digital Fraga',
  9:  'Fale com Contador',
  10: 'IRPF-DIRF (IMPOSTO DE RENDA)',
  11: 'Comercial',
  13: 'Cobrança',
};

// ─── ATENDENTES POR SETOR ─────────────────────────────────────────────────────
export const QUEUE_AGENTS: Record<number, string> = {
  1:  'Leticia',
  2:  'Felipe Rafael, Robson e Samuel',
  3:  'Alexandre, João e Walace',
  4:  'Caio, Renan e Filipe',
  5:  'Maikel',
  7:  'Charles',
  9:  'Charles e Stevens',
  10: 'Charles',
  11: 'Charles',
  13: '', // Cobrança é automática (IA)
};

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export interface ClaudeSecretariaResult {
  reply: string;
  shouldTransfer: boolean;
  targetQueueId: number | null;
  targetQueueName: string | null;
  reasoning?: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationEntry {
  messages: ConversationMessage[];
  lastActivity: number;
  clientName?: string;
  clientId?: number;
}

// ─── HISTÓRICO EM MEMÓRIA (TTL 30 min) ───────────────────────────────────────

const conversations = new Map<string, ConversationEntry>();
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 12;

setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of conversations.entries()) {
    if (now - entry.lastActivity > CONVERSATION_TTL_MS) {
      conversations.delete(phone);
    }
  }
}, 5 * 60 * 1000);

function getOrCreateConversation(phone: string): ConversationEntry {
  const now = Date.now();
  const existing = conversations.get(phone);
  if (existing && now - existing.lastActivity < CONVERSATION_TTL_MS) {
    existing.lastActivity = now;
    return existing;
  }
  const fresh: ConversationEntry = { messages: [], lastActivity: now };
  conversations.set(phone, fresh);
  return fresh;
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `Você é a Juliana, recepcionista da Fraga Contabilidade, escritório contábil no Espírito Santo, Brasil. Você atende pelo WhatsApp.

## PERSONALIDADE E TOM
Você é uma pessoa real — calorosa, simpática, eficiente. Fale como alguém que trabalha há anos no escritório e conhece todo mundo. Linguagem casual, natural, sem formalidade excessiva. Nunca diga que é um robô, IA ou assistente virtual — você é a Juliana, ponto. Se perguntarem se é humana, diga que sim, você é a Juliana da Fraga.

Exemplos de como você fala:
- "Oi! Tudo bem? 😊 Aqui é a Juliana da Fraga, como posso ajudar?"
- "Claro, vou chamar o Felipe Rafael pra te ajudar com isso!"
- "Boa tarde! Me fala o que você precisa 😊"
- "Ah entendi! Isso é com a Leticia, deixa eu te passar pra ela agora"
- "Essa parte é com o Alexandre do fiscal, já to passando pra ele 😊"

## REGRAS DE CONVERSA
1. Mensagens curtas — isso é WhatsApp, não e-mail. Máximo 3 linhas.
2. Use "você", nunca "senhor/senhora"
3. Máximo 1 emoji por mensagem
4. Nunca invente valores, prazos ou informações do cliente
5. Nunca pergunte o que o cliente já disse na conversa
6. Ao transferir: mencione só o nome do atendente, NUNCA o nome do setor. Ex: "Vou chamar o Felipe Rafael 😊" — nunca diga "Departamento Pessoal"
7. Para Cobrança: "Vou te encaminhar pro nosso time de cobrança 😊" (sem nome)
8. Nunca mencione IDs, números de setor ou sistemas internos

## ATENDENTES (use esses nomes ao transferir)
- Fiscal → Alexandre, João ou Walace
- Departamento Pessoal → Felipe Rafael, Robson ou Samuel
- Registro / Alvarás / CND / Taxas → Leticia
- Balanço / Contábil → Caio, Renan ou Filipe
- Financeiro → Maikel
- Certificado Digital → Charles
- Contador / IRPF → Charles ou Stevens
- Comercial → Charles
- Cobrança → time de cobrança (sem nome específico)

## ROTEAMENTO DE SETORES — REGRAS CRÍTICAS

### Setor Fiscal (queueId=3)
Transferir quando o cliente falar sobre:
- Nota fiscal (emissão, cancelamento, dúvidas) — SEMPRE Setor Fiscal, NUNCA outro setor
- DAS, guia de pagamento de imposto
- Simples Nacional, MEI, ICMS, ISS, PIS, COFINS
- SPED, DCTF, EFD, obrigações acessórias
- Parcelamento de imposto
- "Pessoal do fiscal", "setor fiscal", qualquer assunto fiscal
⚠️ ATENÇÃO: "nota fiscal" vai para Setor Fiscal, não para nenhum outro setor.

### Departamento Pessoal (queueId=2)
Transferir quando o cliente falar sobre:
- Funcionário, empregado, CLT
- Folha de pagamento, holerite, contracheque
- Férias, 13º salário, FGTS
- Admissão, demissão, rescisão
- eSocial, INSS de funcionário, CAGED
⚠️ ATENÇÃO: "pessoal do fiscal" NÃO vai para cá — vai para Setor Fiscal.

### Comercial (queueId=11)
Transferir quando o cliente falar sobre:
- Querer ABRIR uma empresa (abertura de empresa, registro, constituição)
- Ser cliente novo que quer contratar o escritório
- Quanto custa, preço, proposta, orçamento
- Mudar de contador, procurando contador
- Contrato de prestação de serviços
⚠️ IMPORTANTE: abertura de empresa vai para Comercial, não para Registro.

### Registro de Empresa Alvaras CND Taxas (queueId=1)
Transferir quando o cliente (já cliente da Fraga) falar sobre:
- Alvará de funcionamento, renovação de alvará
- Certidão Negativa de Débito (CND)
- Taxas municipais, taxa de bombeiros, vigilância sanitária
- Encerrar empresa, baixa de empresa
- Alteração contratual, mudança de endereço na Junta

### Financeiro (queueId=5)
Transferir quando o cliente falar sobre:
- Pagar boleto do escritório, mensalidade da Fraga
- Valor em aberto, débito com o escritório
- Segunda via de boleto
- Cobrança, inadimplência

### Certificado Digital Fraga (queueId=7)
Transferir quando o cliente falar sobre:
- Certificado digital A1, A3, e-CNPJ, e-CPF
- Emitir, renovar ou revogar certificado digital

### IRPF-DIRF (IMPOSTO DE RENDA) (queueId=10)
Transferir quando o cliente falar sobre:
- Declaração de Imposto de Renda Pessoa Física (IRPF)
- Informe de rendimentos, DIRF
- Restituição de IR, malha fina
- Documentos para declaração de IR

### Balanço Balancetes DRE (Setor Contabil) (queueId=4)
Transferir quando o cliente falar sobre:
- Balanço patrimonial, balancete
- DRE (Demonstração do Resultado do Exercício)
- Demonstrações contábeis, relatórios contábeis
- Lucro presumido, lucro real (regime tributário contábil)

### Fale com Contador (queueId=9)
Transferir quando o cliente pedir:
- Falar diretamente com o contador
- Consultoria contábil, planejamento tributário
- Dúvida complexa que exige análise especializada

## O QUE VOCÊ RESPONDE DIRETAMENTE (sem transferir)
- Saudações e apresentação
- Explicar o que o escritório faz
- Horário: segunda a sexta 8h–18h, sábado 8h–12h
- Informar qual área cuida de qual assunto
- Dúvidas genéricas que não precisam de especialista

## FORMATO DE RESPOSTA — OBRIGATÓRIO
Responda SEMPRE com JSON puro, sem markdown:
{
  "reply": "mensagem para enviar ao cliente",
  "shouldTransfer": false,
  "targetQueueId": null,
  "targetQueueName": null,
  "reasoning": "explicação da decisão"
}
Se shouldTransfer=true: preencha targetQueueId (número) e targetQueueName (nome exato do setor conforme listado acima).
Se shouldTransfer=false: targetQueueId e targetQueueName devem ser null.`;

// ─── FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────────

export async function processMessageWithClaude(
  phone: string,
  text: string,
  contactName?: string
): Promise<ClaudeSecretariaResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[ClaudeSecretary] ❌ ANTHROPIC_API_KEY não configurada');
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }

  const client = new Anthropic({ apiKey });
  const conversation = getOrCreateConversation(phone);

  if (contactName && !conversation.clientName) {
    conversation.clientName = contactName;
  }

  // ── Buscar contexto financeiro (paralelo com timeout de 1.5s) ──
  let contextNote = '';
  try {
    const _contextTimeout = new Promise<string>(resolve => setTimeout(() => resolve(''), 1500));
    const _contextFetch = (async (): Promise<string> => {
      const clientInfo = await resolveClientByPhone(phone);
      if (!clientInfo) return '';
      conversation.clientId = clientInfo.clientId;
      if (!conversation.clientName) conversation.clientName = clientInfo.clientName;
      const debt = await getOpenDebtSummary(clientInfo.clientId);
      if (debt && debt.totalDebt > 0) {
        return `\n\n[CONTEXTO — não mencione ao cliente]\nCliente: ${clientInfo.clientName}\nSituação: ${formatBRL(debt.totalDebt)} em aberto — se perguntar pagamento/boleto, transferir para Financeiro`;
      }
      return `\n\n[CONTEXTO]\nCliente: ${clientInfo.clientName} — em dia`;
    })();
    contextNote = await Promise.race([_contextFetch, _contextTimeout]);
  } catch (e) {
    console.warn('[ClaudeSecretary] ⚠️ Erro contexto financeiro:', e);
  }

  // ── Adicionar mensagem ao histórico ──
  conversation.messages.push({ role: 'user', content: text });

  if (conversation.messages.length > MAX_HISTORY_MESSAGES) {
    conversation.messages = conversation.messages.slice(-MAX_HISTORY_MESSAGES);
  }

  const systemPrompt = BASE_SYSTEM_PROMPT + contextNote;

  console.log(`[ClaudeSecretary] 🤖 Chamando Claude para ${phone} | hist=${conversation.messages.length} msgs | texto="${text.substring(0, 60)}"`);

  // ── Chamar Claude ──
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt,
    messages: conversation.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Tipo de resposta inesperado do Claude');
  }

  // ── Parsear resposta JSON ──
  let result: ClaudeSecretariaResult;
  try {
    const jsonMatch = content.text.match(/\{[\s\S]*?\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      result = {
        reply: String(parsed.reply || '').trim(),
        shouldTransfer: !!parsed.shouldTransfer,
        targetQueueId: parsed.targetQueueId != null ? Number(parsed.targetQueueId) : null,
        targetQueueName: parsed.targetQueueName || (parsed.targetQueueId ? QUEUE_MAP[parsed.targetQueueId] : null),
        reasoning: parsed.reasoning,
      };
    } else {
      console.warn('[ClaudeSecretary] ⚠️ Resposta não é JSON, usando texto bruto');
      result = {
        reply: content.text,
        shouldTransfer: false,
        targetQueueId: null,
        targetQueueName: null,
      };
    }
  } catch (parseErr) {
    console.error('[ClaudeSecretary] ❌ Erro ao parsear JSON:', parseErr);
    result = {
      reply: content.text,
      shouldTransfer: false,
      targetQueueId: null,
      targetQueueName: null,
    };
  }

  // ── Salvar resposta no histórico ──
  conversation.messages.push({ role: 'assistant', content: result.reply });

  console.log(`[ClaudeSecretary] ✅ Resposta: transfer=${result.shouldTransfer} queue=${result.targetQueueId} (${result.targetQueueName || '—'}) | "${result.reply.substring(0, 80)}"`);

  return result;
}

// ─── AUDITORIA ────────────────────────────────────────────────────────────────

export async function auditClaudeInteraction(params: {
  fromPhone: string;
  clientId: number | null;
  userText: string;
  reply: string;
  shouldTransfer: boolean;
  targetQueueId: number | null;
  targetQueueName: string | null;
  reasoning?: string;
  correlationId: string;
}): Promise<void> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    await conn.execute(
      `INSERT INTO ai_assistant_log
       (fromPhone, clientId, intent, dbQueryMeta, response, correlationId, handoffToHuman, handoffReason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.fromPhone,
        params.clientId,
        params.shouldTransfer ? `transfer_q${params.targetQueueId}` : 'claude_reply',
        JSON.stringify({
          source: 'claude_secretary',
          userText: params.userText.substring(0, 200),
          shouldTransfer: params.shouldTransfer,
          targetQueueId: params.targetQueueId,
          targetQueueName: params.targetQueueName,
          reasoning: params.reasoning,
        }),
        params.reply,
        params.correlationId,
        params.shouldTransfer ? 1 : 0,
        params.targetQueueName || null,
      ]
    );
    await conn.end();
  } catch (error) {
    console.error('[ClaudeSecretary] Erro ao auditar:', error);
  }
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

export function getConversationStats() {
  const now = Date.now();
  let active = 0;
  for (const [, entry] of conversations.entries()) {
    if (now - entry.lastActivity < CONVERSATION_TTL_MS) active++;
  }
  return { activeConversations: active, totalConversations: conversations.size };
}

export function clearConversation(phone: string): boolean {
  return conversations.delete(phone);
}

export function getSystemPrompt(): string {
  return BASE_SYSTEM_PROMPT;
}
