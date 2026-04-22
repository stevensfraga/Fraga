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

// ─── FORMATAÇÃO DE HONORÁRIOS EM ABERTO ─────────────────────────────────────

/**
 * Busca os boletos de honorários em aberto do cliente e monta a mensagem
 * formatada com link individual por mês — pronta para ser enviada ao cliente.
 */
async function buildHonorariosMessage(clientId: number): Promise<string | null> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [rows] = await conn.execute(
      `SELECT amount, dueDate, paymentLinkCanonical, description
       FROM receivables
       WHERE clientId = ? AND status IN ('pending', 'overdue')
       ORDER BY dueDate ASC
       LIMIT 12`,
      [clientId]
    );
    await conn.end();

    const titles = rows as any[];
    if (!titles.length) return null;

    const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    const lines: string[] = ['Suas mensalidades em aberto:',''];
    let total = 0;

    for (const t of titles) {
      const d = new Date(t.dueDate);
      const mesAno = `${MONTHS_PT[d.getMonth()]}/${d.getFullYear()}`;
      const valor = formatBRL(Number(t.amount));
      total += Number(t.amount);
      lines.push(`📅 *${mesAno}* — ${valor}`);
      if (t.paymentLinkCanonical) {
        lines.push(`🔗 ${t.paymentLinkCanonical}`);
      } else {
        lines.push(`⚠️ Link não disponível`);
      }
      lines.push('');
    }

    lines.push(`💰 *Total em aberto: ${formatBRL(total)}*`);
    lines.push('');
    lines.push('Cada boleto pode ser pago pelo link acima (Pix ou Boleto). Qualquer dúvida é só chamar! 😊');

    return lines.join('\n');
  } catch (e) {
    console.warn('[ClaudeSecretary] ⚠️ Erro ao buscar honorários:', e);
    return null;
  }
}


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


// ─── MEMÓRIA DE CLIENTES ──────────────────────────────────────────────────────

interface ClientMemory {
  phone: string;
  person_name: string | null;
  company_name: string | null;
  usual_sector_id: number | null;
  usual_sector_name: string | null;
  interaction_count: number;
  last_topic: string | null;
}

async function loadClientMemory(phone: string): Promise<ClientMemory | null> {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const [rows] = await conn.execute(
      `SELECT phone, person_name, company_name, usual_sector_id, usual_sector_name, interaction_count, last_topic
       FROM juliana_client_memory WHERE phone = ? LIMIT 1`,
      [phone]
    );
    await conn.end();
    return (rows as any[])[0] || null;
  } catch (e) {
    console.warn('[ClaudeSecretary] ⚠️ Erro ao carregar memória:', e);
    return null;
  }
}

async function saveClientMemory(params: {
  phone: string;
  personName: string | null;
  companyName: string | null;
  transferredToSectorId: number | null;
  transferredToSectorName: string | null;
  topic: string | null;
}): Promise<void> {
  try {
    const { phone, personName, companyName, transferredToSectorId, transferredToSectorName, topic } = params;
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    // Verificar setor usual: se houve transferência, comparar com setor atual
    // e incrementar contagem para o setor mais frequente
    if (transferredToSectorId) {
      await conn.execute(
        `INSERT INTO juliana_client_memory
           (phone, person_name, company_name, usual_sector_id, usual_sector_name, sector_count, last_topic, interaction_count)
         VALUES (?, ?, ?, ?, ?, 1, ?, 1)
         ON DUPLICATE KEY UPDATE
           person_name    = COALESCE(?, person_name),
           company_name   = COALESCE(?, company_name),
           last_topic     = COALESCE(?, last_topic),
           interaction_count = interaction_count + 1,
           sector_count   = IF(usual_sector_id = ?, sector_count + 1, IF(? > sector_count, 1, sector_count)),
           usual_sector_id   = IF(? > sector_count OR usual_sector_id IS NULL, ?, usual_sector_id),
           usual_sector_name = IF(? > sector_count OR usual_sector_id IS NULL, ?, usual_sector_name)`,
        [phone, personName, companyName, transferredToSectorId, transferredToSectorName, topic,
         personName, companyName, topic,
         transferredToSectorId,
         1, // new sector_count if different sector
         1, transferredToSectorId,
         1, transferredToSectorName]
      );
    } else {
      await conn.execute(
        `INSERT INTO juliana_client_memory
           (phone, person_name, company_name, last_topic, interaction_count)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           person_name    = COALESCE(?, person_name),
           company_name   = COALESCE(?, company_name),
           last_topic     = COALESCE(?, last_topic),
           interaction_count = interaction_count + 1`,
        [phone, personName, companyName, topic,
         personName, companyName, topic]
      );
    }
    await conn.end();
  } catch (e) {
    console.warn('[ClaudeSecretary] ⚠️ Erro ao salvar memória:', e);
  }
}

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
9. AO TRANSFERIR — não deixe a conversa morrer! Depois de dizer que vai chamar alguém, SEMPRE faça uma pergunta curta para manter o cliente engajado e coletar contexto para o atendente. Exemplos:
   - "Claro! Já to chamando o Alexandre 😊 Me conta rapidinho — é sobre nota fiscal, DAS ou outro assunto?"
   - "Vou chamar o Felipe Rafael agora! Enquanto isso, é sobre admissão, férias ou alguma outra coisa?"
   - "Passando pro Caio já! É sobre balanço do ano passado ou algo mais recente?"
   - "Chamando o Maikel! É sobre um boleto específico ou situação geral da conta?"
   Adapte a pergunta ao contexto — seja curiosa e calorosa, não robotica. Isso aquece a conversa e já deixa o atendente informado.

## USO DA MEMÓRIA DO CLIENTE
- Se o contexto tiver "Nome da pessoa: X", use o PRIMEIRO NOME para cumprimentar — ex: "Oi, Thayana! 😊" em vez de só "Oi!"
- Se tiver "Já conversou Nx antes", NÃO se apresente como "Aqui é a Juliana da Fraga" — o cliente já te conhece. Vá direto ao ponto.
- Se tiver "Setor habitual: X", quando o assunto for vago, já pode sugerir — ex: "Você costuma falar com o Fiscal, é sobre isso de novo?"
- Se for primeiro contato (sem histórico), apresente-se normalmente.

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
- Negociar, parcelar, pedir desconto na mensalidade
- Segunda via de boleto que não está no sistema
- Cobrança, inadimplência

### REGRA ESPECIAL — "quanto devo?" / "tenho boleto?" / "valor em aberto"
Quando o cliente perguntar de forma VAGA sobre dívida, valor em aberto, boleto ou pagamento, SEMPRE perguntar antes:
"Você está falando de impostos/guias ou da mensalidade do escritório?"

- Se responder MENSALIDADE / HONORÁRIOS / BOLETO DO ESCRITÓRIO:
  → Se o contexto tiver [MENSAGEM DE HONORÁRIOS], envie EXATAMENTE aquele texto, sem alterar nada.
  → Se não tiver (cliente em dia), diga: "Boa notícia! Não tenho nenhuma mensalidade em aberto pra você aqui 😊"
- Se responder IMPOSTOS / DAS / GUIAS / SIMPLES:
  → Transferir para Setor Fiscal (queueId=3)

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

  // ── Carregar memória do cliente ──
  const clientMemory = await loadClientMemory(phone);

  // ── Buscar contexto financeiro + empresa (paralelo com timeout de 2s) ──
  let contextNote = '';
  try {
    const _contextTimeout = new Promise<string>(resolve => setTimeout(() => resolve(''), 2000));
    const _contextFetch = (async (): Promise<string> => {
      const clientInfo = await resolveClientByPhone(phone);

      // Nome da pessoa: prioridade = memória > contactName > clientInfo
      const personName = clientMemory?.person_name
        || (contactName && contactName !== 'unknown' ? contactName : null)
        || clientInfo?.clientName
        || null;

      // Nome da empresa
      let companyName = clientMemory?.company_name || clientInfo?.clientName || null;
      let regimeTributario = '';

      if (clientInfo) {
        conversation.clientId = clientInfo.clientId;
        if (!conversation.clientName) conversation.clientName = personName || clientInfo.clientName;

        // Dados da empresa (ekontrol)
        try {
          const conn = await mysql.createConnection(process.env.DATABASE_URL!);
          const [rows] = await conn.execute(
            `SELECT razao_social, regime_tributario FROM ekontrol_companies WHERE client_id = ? LIMIT 1`,
            [clientInfo.clientId]
          );
          await conn.end();
          const emp = (rows as any[])[0];
          if (emp) {
            companyName = emp.razao_social;
            regimeTributario = emp.regime_tributario || '';
          }
        } catch (_e) { /* ignorar */ }
      }

      // Montar bloco de memória/contexto
      const memoryLines: string[] = [];
      if (personName && personName !== 'unknown') memoryLines.push(`Nome da pessoa: ${personName.split(' ')[0]} (${personName})`);
      if (companyName) memoryLines.push(`Empresa: ${companyName}${regimeTributario ? ` — ${regimeTributario}` : ''}`);
      if (clientMemory?.usual_sector_name) memoryLines.push(`Setor habitual: ${clientMemory.usual_sector_name} (costuma precisar disso)`);
      if (clientMemory?.last_topic) memoryLines.push(`Último assunto: ${clientMemory.last_topic}`);
      if (clientMemory && clientMemory.interaction_count > 0) memoryLines.push(`Já conversou ${clientMemory.interaction_count}x antes`);

      const memoryBlock = memoryLines.length > 0
        ? `\n\n[CONTEXTO DO CLIENTE — use para personalizar, não mencione ao cliente]\n${memoryLines.join('\n')}`
        : '';

      // Boletos em aberto
      if (!clientInfo) return memoryBlock || '';
      const honorariosMsg = await buildHonorariosMessage(clientInfo.clientId);

      if (honorariosMsg) {
        return `${memoryBlock}\n\n[HONORÁRIOS EM ABERTO — envie EXATAMENTE este texto se perguntar sobre mensalidade/boleto do escritório]\n${honorariosMsg}`;
      }
      return `${memoryBlock}\n\n[STATUS FINANCEIRO]\nSem mensalidades em aberto.`;
    })();
    contextNote = await Promise.race([_contextFetch, _contextTimeout]);
  } catch (e) {
    console.warn('[ClaudeSecretary] ⚠️ Erro contexto:', e);
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

  // ── Salvar memória do cliente (fire-and-forget) ──
  const personName = (contactName && contactName !== 'unknown') ? contactName : null;
  const companyName = conversation.clientId
    ? (clientMemory?.company_name || null)
    : null;
  const topic = result.shouldTransfer
    ? `transferido para ${result.targetQueueName}`
    : text.substring(0, 100);
  saveClientMemory({
    phone,
    personName,
    companyName,
    transferredToSectorId: result.shouldTransfer ? result.targetQueueId : null,
    transferredToSectorName: result.shouldTransfer ? result.targetQueueName : null,
    topic,
  }).catch(() => {});

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
