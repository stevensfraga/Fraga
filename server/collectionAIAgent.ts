import { invokeLLM } from "./_core/llm";
import { getRealClientByCnpj, getRealClientByName } from "./realClientsLoader";
import { getClientHistory } from "./db";

interface ClientInfo {
  nome: string;
  cnpj: string;
  valor_total: number;
  dias_atraso: number;
  parcelas: number;
  faixa: 'friendly' | 'administrative' | 'formal';
}

interface ConversationContext {
  clientId: string;
  clientName: string;
  clientInfo?: ClientInfo;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  stage: 'greeting' | 'consultation' | 'options' | 'resolution' | 'escalation';
  lastResponse?: string;
}

/**
 * Sistema de Agente de IA para Cobrança Humanizada
 * Especializado em atendimento via WhatsApp
 */

export async function initializeCollectionAgent(
  clientName: string,
  clientCnpj: string
): Promise<ConversationContext> {
  // Buscar informações do cliente
  const clientInfo = getRealClientByCnpj(clientCnpj) || getRealClientByName(clientName);
  
  if (!clientInfo) {
    throw new Error(`Cliente não encontrado: ${clientName}`);
  }

  return {
    clientId: clientCnpj,
    clientName: clientInfo.nome,
    clientInfo: {
      nome: clientInfo.nome,
      cnpj: clientInfo.cnpj,
      valor_total: 0, // Será preenchido do dashboard
      dias_atraso: 0,
      parcelas: 0,
      faixa: 'formal'
    },
    conversationHistory: [],
    stage: 'greeting'
  };
}

/**
 * Gera saudação inicial do agente
 */
export function getGreetingMessage(clientName: string): string {
  return `Olá, tudo bem? 😊\nSou o assistente virtual do escritório contábil e estou aqui para te ajudar com informações sobre sua situação financeira conosco.`;
}

/**
 * Consulta débito do cliente
 */
export function getDebtConsultationMessage(clientInfo: ClientInfo): string {
  const meses = Math.ceil(clientInfo.dias_atraso / 30);
  return `Verifiquei aqui no sistema e atualmente constam honorários em aberto no valor total de R$ ${clientInfo.valor_total.toFixed(2)}, referentes a ${meses} meses.`;
}

/**
 * Apresenta opções de regularização
 */
export function getRegularizationOptionsMessage(clientInfo: ClientInfo): string {
  const maxParcelas = Math.min(clientInfo.parcelas, 12); // Máximo 12 parcelas
  return `Esse valor pode ser regularizado de forma à vista ou parcelado em até ${maxParcelas} parcelas, conforme nossa política.`;
}

/**
 * Convida cliente a decidir
 */
export function getDecisionInvitationMessage(): string {
  return `Como prefere seguir para regularizarmos isso da melhor forma?`;
}

/**
 * Responde padrão para pedido de prazo
 */
export function getExtensionResponseMessage(): string {
  return `Sem problema. Posso registrar um prazo para acompanhamento. Qual data você acredita que consegue organizar?`;
}

/**
 * Resposta padrão para pedido de parcelamento
 */
export function getInstallmentResponseMessage(): string {
  return `Posso te explicar as opções de parcelamento disponíveis. Quer que eu detalhe agora?`;
}

/**
 * Resposta padrão para impossibilidade de pagamento
 */
export function getPaymentDifficultyResponseMessage(): string {
  return `Entendo. Nesse caso, vou registrar a situação para acompanhamento interno e evitar qualquer medida automática neste momento.`;
}

/**
 * Resposta para limites do agente
 */
export function getEscalationMessage(): string {
  return `Para esse ponto, preciso encaminhar para um responsável do escritório dar continuidade.`;
}

/**
 * Encerramento educado
 */
export function getClosingMessage(): string {
  return `Fico à disposição. Caso precise, é só nos chamar.`;
}

/**
 * Processa mensagem do cliente e gera resposta inteligente
 */
export async function processClientMessage(
  context: ConversationContext,
  clientMessage: string
): Promise<{ response: string; updatedContext: ConversationContext }> {
  // Adicionar mensagem do cliente ao histórico
  context.conversationHistory.push({
    role: 'user',
    content: clientMessage
  });

  // Construir prompt para o LLM
  const systemPrompt = buildSystemPrompt(context);
  const messages = buildMessages(context, systemPrompt);

  try {
    // Chamar LLM para processar
    const response = await invokeLLM({
      messages: messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'collection_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              response: {
                type: 'string',
                description: 'Resposta do agente para o cliente'
              },
              action: {
                type: 'string',
                enum: ['continue', 'offer_options', 'register_agreement', 'escalate'],
                description: 'Ação a ser tomada'
              },
              stage: {
                type: 'string',
                enum: ['greeting', 'consultation', 'options', 'resolution', 'escalation'],
                description: 'Próximo estágio da conversa'
              }
            },
            required: ['response', 'action', 'stage'],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0].message.content as string;
    const parsed = JSON.parse(content);

    // Adicionar resposta ao histórico
    context.conversationHistory.push({
      role: 'assistant',
      content: parsed.response
    });

    // Atualizar estágio
    context.stage = parsed.stage;
    context.lastResponse = parsed.response;

    return {
      response: parsed.response,
      updatedContext: context
    };
  } catch (error) {
    console.error('Erro ao processar mensagem com LLM:', error);
    
    // Fallback para resposta padrão
    const fallbackResponse = generateFallbackResponse(clientMessage, context);
    context.conversationHistory.push({
      role: 'assistant',
      content: fallbackResponse
    });

    return {
      response: fallbackResponse,
      updatedContext: context
    };
  }
}

/**
 * Constrói o prompt do sistema para o LLM
 */
function buildSystemPrompt(context: ConversationContext): string {
  return `Você é um Agente de IA de Cobrança Humanizada, especializado em escritórios de contabilidade.

Seu objetivo é:
- Informar o cliente de forma clara e educada
- Reduzir inadimplência sem desgaste
- Orientar sobre valores, parcelas e prazos
- Escalar o processo apenas quando necessário

Você não ameaça, não discute e não negocia fora das regras.

INFORMAÇÕES DO CLIENTE:
- Nome: ${context.clientName}
- CNPJ: ${context.clientId}
- Valor em aberto: R$ ${context.clientInfo?.valor_total || 0}
- Dias em atraso: ${context.clientInfo?.dias_atraso || 0}
- Faixa: ${context.clientInfo?.faixa || 'formal'}

TOM DE VOZ:
- Educado
- Calmo
- Profissional
- Humano
- Sem juridiquês
- Sem pressão

LIMITES DO AGENTE:
- Não pode prometer descontos sem regra
- Não pode negociar fora da política
- Não pode suspender serviços
- Não pode falar em jurídico por iniciativa própria

Sempre responda com empatia e busque encontrar a melhor forma de regularizar a situação.`;
}

/**
 * Constrói mensagens para o LLM
 */
function buildMessages(
  context: ConversationContext,
  systemPrompt: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  // Adicionar histórico da conversa
  for (const msg of context.conversationHistory) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    });
  }

  return messages;
}

/**
 * Gera resposta padrão quando LLM falha
 */
function generateFallbackResponse(
  clientMessage: string,
  context: ConversationContext
): string {
  const lowerMessage = clientMessage.toLowerCase();

  // Detectar intenção
  if (
    lowerMessage.includes('prazo') ||
    lowerMessage.includes('espera') ||
    lowerMessage.includes('depois')
  ) {
    return getExtensionResponseMessage();
  }

  if (
    lowerMessage.includes('parcel') ||
    lowerMessage.includes('dividir') ||
    lowerMessage.includes('parcela')
  ) {
    return getInstallmentResponseMessage();
  }

  if (
    lowerMessage.includes('não consigo') ||
    lowerMessage.includes('dificuldade') ||
    lowerMessage.includes('problema') ||
    lowerMessage.includes('impossível')
  ) {
    return getPaymentDifficultyResponseMessage();
  }

  if (
    lowerMessage.includes('desconto') ||
    lowerMessage.includes('negociar') ||
    lowerMessage.includes('acordo')
  ) {
    return getEscalationMessage();
  }

  // Resposta genérica
  return `Entendo. ${getDecisionInvitationMessage()}`;
}

/**
 * Registra resultado da conversa
 */
export async function logConversationResult(
  context: ConversationContext,
  outcome: 'agreed' | 'paid' | 'no_response' | 'rejected'
): Promise<void> {
  const logEntry = {
    timestamp: new Date().toISOString(),
    clientName: context.clientName,
    clientCnpj: context.clientId,
    stage: context.stage,
    outcome: outcome,
    messagesCount: context.conversationHistory.length,
    lastMessage: context.lastResponse
  };

  console.log('[Collection Agent] Conversa registrada:', logEntry);
  
  // TODO: Salvar no banco de dados
}
