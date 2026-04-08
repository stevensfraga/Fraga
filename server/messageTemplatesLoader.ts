/**
 * Templates de mensagens dinâmicos baseados em sentimento
 * Cada template é ajustado para o tom apropriado baseado na resposta anterior
 */

export interface MessageTemplate {
  id: string;
  messageType: "friendly" | "administrative" | "formal";
  targetSentiment: "positive" | "negative" | "neutral" | "mixed";
  template: string;
  description: string;
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // ============================================
  // MENSAGENS AMIGÁVEIS
  // ============================================
  {
    id: "friendly_positive",
    messageType: "friendly",
    targetSentiment: "positive",
    description: "Cliente respondeu positivamente, reforçar confiança",
    template: `Olá {{clientName}}! 👋

Que ótimo saber que você está disposto a regularizar essa pendência! 😊

Estamos aqui para facilitar ao máximo. Segue abaixo o link para pagamento:

💳 Link de Pagamento: {{paymentLink}}

Valor: R$ {{amount}}
Vencimento: {{dueDate}}

Qualquer dúvida, é só chamar! Estamos à disposição.

Obrigado pela confiança! 🙏`,
  },

  {
    id: "friendly_negative",
    messageType: "friendly",
    targetSentiment: "negative",
    description: "Cliente recusou, tentar entender a situação",
    template: `Olá {{clientName}},

Entendo que o momento pode estar difícil. 😔

Gostaria de entender melhor sua situação para encontrar uma solução que funcione para você. Podemos:

✅ Parcelar o pagamento em até 3x
✅ Oferecer um pequeno desconto
✅ Agendar um atendimento com nosso gerente

Qual opção te interessa? Estamos aqui para ajudar! 💪`,
  },

  {
    id: "friendly_neutral",
    messageType: "friendly",
    targetSentiment: "neutral",
    description: "Cliente fez perguntas, responder e facilitar",
    template: `Olá {{clientName}},

Obrigado pelas suas perguntas! Vamos esclarecer:

📋 Detalhes da Cobrança:
• Valor: R$ {{amount}}
• Referente a: {{description}}
• Dias em atraso: {{daysOverdue}}

💡 Opções de Pagamento:
1️⃣ Pagamento à vista: {{paymentLink}}
2️⃣ Parcelamento: Fale conosco
3️⃣ Desconto especial: Válido até {{discountDate}}

Qual opção você prefere? 😊`,
  },

  {
    id: "friendly_mixed",
    messageType: "friendly",
    targetSentiment: "mixed",
    description: "Cliente mostrou sentimentos mistos, ser empático",
    template: `Olá {{clientName}},

Percebemos que você tem interesse, mas também algumas preocupações. Isso é totalmente normal! 💭

Vamos simplificar:

🎯 Próximos Passos:
1. Você pode pagar agora? → {{paymentLink}}
2. Precisa de tempo? → Podemos parcelar
3. Quer falar com alguém? → Agende uma ligação

Qual é a melhor opção para você neste momento?`,
  },

  // ============================================
  // MENSAGENS ADMINISTRATIVAS
  // ============================================
  {
    id: "administrative_positive",
    messageType: "administrative",
    targetSentiment: "positive",
    description: "Reforçar compromisso após resposta positiva",
    template: `{{clientName}},

Confirmamos o recebimento de sua confirmação de pagamento.

📌 DETALHES DO ACORDO:
• Valor: R$ {{amount}}
• Data Prevista: {{paymentDate}}
• Referência: {{invoiceNumber}}

⏰ Próximos Passos:
Você receberá um comprovante assim que o pagamento for processado.

Qualquer atraso, por favor nos avise imediatamente.

Atenciosamente,
Equipe de Cobrança`,
  },

  {
    id: "administrative_negative",
    messageType: "administrative",
    targetSentiment: "negative",
    description: "Formalizar cobrança após recusa",
    template: `{{clientName}},

Conforme nossa comunicação anterior, informamos que a conta em atraso continua pendente.

⚠️ SITUAÇÃO ATUAL:
• Valor: R$ {{amount}}
• Dias em atraso: {{daysOverdue}}
• Status: PENDENTE DE REGULARIZAÇÃO

📋 PRÓXIMAS AÇÕES:
Para evitar maiores consequências, solicitamos que regularize esta pendência nos próximos 5 dias úteis.

Opções disponíveis:
1. Pagamento integral: {{paymentLink}}
2. Parcelamento: Fale com nosso gerente
3. Contestação: Responda este e-mail

Atenciosamente,
Departamento de Cobrança`,
  },

  {
    id: "administrative_neutral",
    messageType: "administrative",
    targetSentiment: "neutral",
    description: "Esclarecer dúvidas com tom mais formal",
    template: `{{clientName}},

Em resposta às suas dúvidas, segue informações detalhadas:

📊 INFORMAÇÕES DA COBRANÇA:
• Valor: R$ {{amount}}
• Vencimento Original: {{originalDueDate}}
• Dias em Atraso: {{daysOverdue}}
• Juros Acumulados: R$ {{interest}}

📌 DOCUMENTAÇÃO:
Você pode consultar os detalhes completos em: {{documentLink}}

💳 OPÇÕES DE PAGAMENTO:
1. Débito/Crédito: {{paymentLink}}
2. Transferência Bancária: {{bankDetails}}
3. Parcelamento: Entre em contato

Favor confirmar o recebimento desta mensagem.

Atenciosamente,
Cobrança`,
  },

  {
    id: "administrative_mixed",
    messageType: "administrative",
    targetSentiment: "mixed",
    description: "Formalizar com opções após sentimentos mistos",
    template: `{{clientName}},

Após análise de sua situação, oferecemos as seguintes opções:

🔄 ALTERNATIVAS:
1. Pagamento à vista: R$ {{amount}} - {{paymentLink}}
2. Parcelamento em 2x: R$ {{installment}} cada
3. Desconto especial: {{discountPercentage}}% até {{discountDate}}

⏰ PRAZO:
Solicitamos uma resposta até {{deadline}} para prosseguirmos.

Qual opção você escolhe?

Atenciosamente,
Equipe de Cobrança`,
  },

  // ============================================
  // MENSAGENS FORMAIS
  // ============================================
  {
    id: "formal_positive",
    messageType: "formal",
    targetSentiment: "positive",
    description: "Confirmar acordo formal após resposta positiva",
    template: `{{clientName}},

CONFIRMAÇÃO DE ACORDO DE PAGAMENTO

Conforme acordado, confirmamos os seguintes termos:

📋 TERMOS DO ACORDO:
Valor: R$ {{amount}}
Data de Pagamento: {{paymentDate}}
Referência: {{invoiceNumber}}
Penalidades: Isentas conforme acordo

Este acordo substitui qualquer comunicação anterior.

Qualquer descumprimento resultará em ações legais.

Assinado digitalmente em {{date}}
Departamento Jurídico`,
  },

  {
    id: "formal_negative",
    messageType: "formal",
    targetSentiment: "negative",
    description: "Notificação formal após recusa persistente",
    template: `{{clientName}},

NOTIFICAÇÃO FORMAL DE COBRANÇA

Informamos que após múltiplas tentativas de contato, a dívida em questão permanece em aberto.

⚠️ SITUAÇÃO:
Valor: R$ {{amount}}
Dias em Atraso: {{daysOverdue}}
Última Comunicação: {{lastContactDate}}

🔴 AVISO IMPORTANTE:
Caso a regularização não ocorra nos próximos 10 dias úteis, procederemos com:
• Inscrição em órgãos de proteção ao crédito
• Ações judiciais para cobrança
• Inclusão de custas processuais

Para evitar estas medidas, realize o pagamento imediatamente.

Pagamento: {{paymentLink}}

Atenciosamente,
Departamento Jurídico`,
  },

  {
    id: "formal_neutral",
    messageType: "formal",
    targetSentiment: "neutral",
    description: "Resposta formal a questionamentos",
    template: `{{clientName}},

RESPOSTA FORMAL À SOLICITAÇÃO DE INFORMAÇÕES

Conforme solicitado, segue informações completas sobre a cobrança:

📄 DOCUMENTAÇÃO:
• Contrato: {{contractNumber}}
• Nota Fiscal: {{invoiceNumber}}
• Data de Emissão: {{issueDate}}
• Valor Original: R$ {{originalAmount}}

💰 SITUAÇÃO ATUAL:
• Valor Principal: R$ {{amount}}
• Juros: R$ {{interest}}
• Multa: R$ {{fine}}
• Total Devido: R$ {{totalAmount}}

🏦 DADOS BANCÁRIOS:
{{bankDetails}}

Qualquer contestação deve ser formalizada por escrito em 5 dias úteis.

Atenciosamente,
Departamento de Cobrança`,
  },

  {
    id: "formal_mixed",
    messageType: "formal",
    targetSentiment: "mixed",
    description: "Proposta formal com ultimato",
    template: `{{clientName}},

PROPOSTA FINAL DE ACORDO

Considerando sua situação, oferecemos esta última oportunidade:

✅ OPÇÃO 1 - PAGAMENTO INTEGRAL:
Valor: R$ {{amount}}
Prazo: 5 dias úteis
Link: {{paymentLink}}

✅ OPÇÃO 2 - PARCELAMENTO:
2 parcelas de R$ {{installment}}
Primeira: {{firstDate}}
Segunda: {{secondDate}}

❌ OPÇÃO 3 - AÇÕES LEGAIS:
Após {{deadline}}, procederemos com inscrição em órgãos de proteção e ações judiciais.

⏰ PRAZO FINAL: {{finalDeadline}}

Escolha uma opção e confirme por este canal.

Atenciosamente,
Departamento Jurídico`,
  },
];

/**
 * Obter template de mensagem baseado em tipo e sentimento
 */
export function getMessageTemplate(
  messageType: "friendly" | "administrative" | "formal",
  sentiment: "positive" | "negative" | "neutral" | "mixed"
): MessageTemplate | undefined {
  return MESSAGE_TEMPLATES.find(
    (t) => t.messageType === messageType && t.targetSentiment === sentiment
  );
}

/**
 * Substituir placeholders no template
 */
export function fillTemplate(
  template: string,
  variables: Record<string, any>
): string {
  let result = template;

  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, "g"), String(value || ""));
  });

  return result;
}

/**
 * Sugerir próximo template baseado em histórico de sentimentos
 */
export function suggestNextTemplate(
  currentMessageType: "friendly" | "administrative" | "formal",
  lastSentiment: "positive" | "negative" | "neutral" | "mixed"
): {
  suggestedType: "friendly" | "administrative" | "formal";
  reason: string;
} {
  // Se cliente respondeu positivamente, manter ou voltar para amigável
  if (lastSentiment === "positive") {
    return {
      suggestedType: "friendly",
      reason: "Cliente mostrou disposição. Manter tom amigável e facilitar pagamento.",
    };
  }

  // Se cliente recusou, escalar o tom
  if (lastSentiment === "negative") {
    if (currentMessageType === "friendly") {
      return {
        suggestedType: "administrative",
        reason: "Cliente recusou mensagem amigável. Escalar para tom administrativo.",
      };
    } else if (currentMessageType === "administrative") {
      return {
        suggestedType: "formal",
        reason: "Cliente continua recusando. Escalar para tom formal.",
      };
    } else {
      return {
        suggestedType: "formal",
        reason: "Manter tom formal e considerar ações legais.",
      };
    }
  }

  // Se cliente fez perguntas, responder com mais detalhes
  if (lastSentiment === "neutral") {
    if (currentMessageType === "friendly") {
      return {
        suggestedType: "administrative",
        reason: "Cliente tem dúvidas. Fornecer informações mais detalhadas.",
      };
    } else {
      return {
        suggestedType: "formal",
        reason: "Cliente continua com dúvidas. Fornecer documentação completa.",
      };
    }
  }

  // Se sentimentos mistos, tentar novamente com tom administrativo
  if (lastSentiment === "mixed") {
    if (currentMessageType === "friendly") {
      return {
        suggestedType: "administrative",
        reason: "Cliente mostrou sentimentos mistos. Formalizar com opções claras.",
      };
    } else {
      return {
        suggestedType: "formal",
        reason: "Cliente continua indeciso. Apresentar ultimato formal.",
      };
    }
  }

  // Fallback
  return {
    suggestedType: currentMessageType,
    reason: "Manter tom atual.",
  };
}
