/**
 * Templates de mensagens naturais e humanas
 * Simula um atendente real, não um robô
 */

interface ClientContext {
  name: string;
  amount: number;
  daysOverdue: number;
  previousResponses?: string[];
  lastMessageTone?: "friendly" | "administrative" | "formal";
}

/**
 * Mensagens de apresentação da Julia (variadas)
 */
export const juliaGreetings = [
  "Oi! Tudo bem? Aqui é a Julia do financeiro! 😊",
  "Olá! Sou a Julia do setor financeiro. Como posso ajudar?",
  "Opa! Aqui é a Julia, do financeiro. Tudo certo?",
  "Oi, tudo bem? Sou a Julia, estou aqui pra ajudar com o financeiro! 💰",
  "E aí! Aqui é a Julia do financeiro. Qual é a dúvida?",
];

/**
 * Mensagens de follow-up naturais (sem parecer robô)
 */
export const followUpMessages = [
  (context: ClientContext) =>
    `Oi ${context.name}! Tudo bem? Aqui é a Julia novamente. Olha, vi que você tem um boleto aqui de ${formatCurrency(context.amount)} que tá vencido há ${context.daysOverdue} dias. Tá tudo ok? Posso ajudar com alguma coisa? 😊`,

  (context: ClientContext) =>
    `${context.name}, opa! Sou a Julia do financeiro. Só passando aqui pra confirmar se você recebeu o boleto de ${formatCurrency(context.amount)}. Conseguiu visualizar? 👀`,

  (context: ClientContext) =>
    `Oi ${context.name}! Tudo bem? Aqui é a Julia novamente. Viu o boleto que mandei? É de ${formatCurrency(context.amount)}. Qualquer dúvida, é só chamar! 😉`,

  (context: ClientContext) =>
    `${context.name}, opa! Aqui é a Julia do financeiro. Só confirmando se chegou o boleto de ${formatCurrency(context.amount)} ok? Tá com alguma dúvida?`,

  (context: ClientContext) =>
    `Opa ${context.name}! Sou a Julia. Mandei um boleto pra você de ${formatCurrency(context.amount)}. Conseguiu receber? Se tiver qualquer dúvida, é só me chamar! 💬`,
];

/**
 * Respostas empáticas para diferentes situações
 */
export const empathicResponses = {
  positive: [
    "Opa, que legal! Fico feliz em saber! 😊",
    "Ótimo! Fico tranquila aqui então.",
    "Que bom ouvir isso! Obrigada! 💚",
    "Perfeito! Fico mais tranquila agora.",
    "Opa, que legal! Valeu mesmo! 😄",
  ],

  negative: [
    "Ah, entendo. Sem problema! Posso ajudar de alguma forma?",
    "Tá certo, sem stress. Quando você conseguir, é só me chamar!",
    "Fica tranquilo, a gente resolve isso junto! 💪",
    "Sem problema! Qual seria uma data melhor pra você?",
    "Entendo perfeitamente. Vamos ver o que a gente consegue fazer?",
  ],

  neutral: [
    "Tá certo! Alguma dúvida que eu possa ajudar?",
    "Beleza! Quer que eu resenda o boleto?",
    "Entendi! Qual é a sua dúvida?",
    "Tá bom! Como posso ajudar?",
    "Ok! Qual é a situação?",
  ],

  needsInfo: [
    "Opa, deixa eu esclarecer isso pra você! 😊",
    "Boa pergunta! Deixa eu explicar melhor...",
    "Entendo! Vou detalhar melhor pra você.",
    "Ótima pergunta! Deixa eu te explicar...",
    "Claro! Vou deixar mais claro pra você.",
  ],
};

/**
 * Respostas para quando cliente pede boleto
 */
export const boletoResponses = [
  (context: ClientContext) =>
    `Claro! Aqui está o boleto de ${formatCurrency(context.amount)} pra você. É só clicar no link que abre direto! 📄`,

  (context: ClientContext) =>
    `Opa, claro! Segue aqui o boleto de ${formatCurrency(context.amount)}. Qualquer dúvida, é só me chamar! 😊`,

  (context: ClientContext) =>
    `Perfeito! Mandei o boleto de ${formatCurrency(context.amount)} pra você. Consegue visualizar?`,

  (context: ClientContext) =>
    `Sem problema! Aqui está o boleto de ${formatCurrency(context.amount)}. Se não conseguir abrir, é só me avisar! 📲`,

  (context: ClientContext) =>
    `Claro, claro! Segue o boleto de ${formatCurrency(context.amount)} aí. Qualquer coisa, é só chamar! 💬`,
];

/**
 * Mensagens de encerramento natural
 */
export const closingMessages = [
  "Fico feliz em ajudar! Qualquer coisa, é só me chamar! 😊",
  "Perfeito! Fico aqui se precisar de mais alguma coisa.",
  "Tá certo! Fico no aguardo. Obrigada! 💚",
  "Beleza! Qualquer dúvida, é só me chamar de novo!",
  "Ok! Fico à disposição se precisar de algo mais!",
];

/**
 * Mensagens de confirmação de pagamento
 */
export const paymentConfirmationMessages = [
  (context: ClientContext) =>
    `Opa! Que legal! Recebi aqui o seu pagamento de ${formatCurrency(context.amount)}. Obrigada mesmo! 💚`,

  (context: ClientContext) =>
    `Perfeito! Seu pagamento de ${formatCurrency(context.amount)} foi confirmado! Fico feliz em ajudar! 😊`,

  (context: ClientContext) =>
    `Ótimo! Seu boleto de ${formatCurrency(context.amount)} foi pago com sucesso! Valeu mesmo! 🙌`,

  (context: ClientContext) =>
    `Opa, que legal! Recebi o pagamento de ${formatCurrency(context.amount)} aí. Tá tudo certo! 💚`,
];

/**
 * Obter mensagem aleatória de um array
 */
export function getRandomMessage(
  messages: string[] | ((context: ClientContext) => string)[],
  context?: ClientContext
): string {
  const randomIndex = Math.floor(Math.random() * messages.length);
  const message = messages[randomIndex];

  if (typeof message === "function" && context) {
    return message(context);
  }

  return message as string;
}

/**
 * Formatar valor em moeda
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Gerar delay natural de digitação (em ms)
 * Simula uma pessoa digitando
 */
export function generateNaturalDelay(): number {
  // Entre 500ms e 3000ms
  return Math.random() * 2500 + 500;
}

/**
 * Obter saudação natural baseada na hora do dia
 */
export function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Bom dia! 🌅";
  } else if (hour < 18) {
    return "Boa tarde! ☀️";
  } else {
    return "Boa noite! 🌙";
  }
}

/**
 * Criar mensagem de follow-up contextualizada
 */
export function createContextualFollowUp(context: ClientContext): string {
  const messages = followUpMessages;
  return getRandomMessage(messages, context);
}

/**
 * Criar resposta empática baseada em sentimento
 */
export function createEmpathicResponse(
  sentiment: "positive" | "negative" | "neutral" | "mixed"
): string {
  const sentimentMap = {
    positive: empathicResponses.positive,
    negative: empathicResponses.negative,
    neutral: empathicResponses.neutral,
    mixed: empathicResponses.neutral,
  };

  return getRandomMessage(sentimentMap[sentiment]);
}

/**
 * Criar mensagem de boleto natural
 */
export function createNaturalBoletoMessage(context: ClientContext): string {
  return getRandomMessage(boletoResponses, context);
}

/**
 * Criar mensagem de encerramento natural
 */
export function createNaturalClosing(): string {
  return getRandomMessage(closingMessages);
}

/**
 * Criar mensagem de confirmação de pagamento
 */
export function createPaymentConfirmation(context: ClientContext): string {
  return getRandomMessage(paymentConfirmationMessages, context);
}

/**
 * Simular digitação com delay
 * Retorna a mensagem com delay natural
 */
export async function sendWithNaturalDelay(
  message: string,
  sendFunction: (msg: string) => Promise<any>
): Promise<any> {
  const delay = generateNaturalDelay();
  console.log(`[Human] Aguardando ${delay}ms antes de enviar mensagem...`);
  await new Promise((resolve) => setTimeout(resolve, delay));
  return sendFunction(message);
}
