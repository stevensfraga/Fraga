/**
 * Templates de mensagens para a régua de cobrança automática
 * 7 estágios: D-5, D-1, D+3, D+7, D+15, D+30, D+45, D+60
 */

export interface CollectionTemplate {
  stage: string;
  name: string;
  description: string;
  daysFromDueDate: number; // Negativo = antes do vencimento, positivo = depois
  channels: string[]; // "whatsapp" ou "email"
  whatsappTemplate: string;
  emailTemplate: string;
}

export const collectionRuleTemplates: CollectionTemplate[] = [
  {
    stage: "reset",
    name: "Mensagem de Reset",
    description: "Para clientes com mais de 60 dias de atraso - Preparar para nova régua",
    daysFromDueDate: 60,
    channels: ["whatsapp", "email"],
    whatsappTemplate: `Olá, {clientName}!

Estamos realizando uma organização administrativa e financeira do escritório e identificamos pendências relacionadas a períodos anteriores.

Estamos implantando uma política de regularização para normalizar os atendimentos. Nos próximos dias entraremos em contato com as orientações para regularização.

Atenciosamente,
{companyName}`,
    emailTemplate: `Prezado(a) {clientName},

Estamos realizando uma organização administrativa e financeira do escritório e identificamos pendências relacionadas a períodos anteriores.

Estamos implantando uma política de regularização para normalizar os atendimentos. Nos próximos dias entraremos em contato com as orientações para regularização.

Atenciosamente,
{companyName}`,
  },

  {
    stage: "d_minus_5",
    name: "D-5: Lembrete Preventivo",
    description: "5 dias antes do vencimento",
    daysFromDueDate: -5,
    channels: ["whatsapp"],
    whatsappTemplate: `Olá, {clientName}! 😊

Lembramos que o boleto referente aos serviços contábeis vence em {dueDate}.
Segue o link para pagamento:
{paymentLink}`,
    emailTemplate: "",
  },

  {
    stage: "d_minus_1",
    name: "D-1: Lembrete Final",
    description: "1 dia antes do vencimento",
    daysFromDueDate: -1,
    channels: ["whatsapp"],
    whatsappTemplate: `Olá, {clientName}.

Reforçando que o boleto dos serviços contábeis vence amanhã ({dueDate}).
Segue o link:
{paymentLink}`,
    emailTemplate: "",
  },

  {
    stage: "d_plus_3",
    name: "D+3: Aviso de Pendência",
    description: "3 dias após vencimento",
    daysFromDueDate: 3,
    channels: ["whatsapp", "email"],
    whatsappTemplate: `Olá, {clientName}.

Identificamos que o boleto referente aos serviços contábeis, com vencimento em {dueDate}, ainda consta em aberto.

Segue o link para regularização:
{paymentLink}

Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.`,
    emailTemplate: `Prezado(a) {clientName},

Identificamos que o boleto referente aos serviços contábeis, com vencimento em {dueDate}, ainda consta em aberto.

Segue o link para regularização:
{paymentLink}

Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.

Atenciosamente,
{companyName}`,
  },

  {
    stage: "d_plus_7",
    name: "D+7: Cobrança Administrativa",
    description: "7 dias após vencimento",
    daysFromDueDate: 7,
    channels: ["whatsapp", "email"],
    whatsappTemplate: `Olá, {clientName}.

O boleto referente aos serviços contábeis permanece em aberto desde {dueDate}. Para mantermos o atendimento regular, solicitamos a regularização do pagamento.

Link para pagamento:
{paymentLink}

Atenciosamente,
{companyName}`,
    emailTemplate: `Prezado(a) {clientName},

O boleto referente aos serviços contábeis permanece em aberto desde {dueDate}. Para mantermos o atendimento regular, solicitamos a regularização do pagamento.

Link para pagamento:
{paymentLink}

Atenciosamente,
{companyName}`,
  },

  {
    stage: "d_plus_15",
    name: "D+15: Aviso Formal",
    description: "15 dias após vencimento",
    daysFromDueDate: 15,
    channels: ["email"],
    whatsappTemplate: "",
    emailTemplate: `Prezado(a) {clientName},

Até o momento não identificamos o pagamento do boleto vencido em {dueDate}, referente aos serviços contábeis prestados por este escritório.

Para evitar impactos no atendimento administrativo, solicitamos a regularização pelo link abaixo:

{paymentLink}

Atenciosamente,
{companyName}`,
  },

  {
    stage: "d_plus_30",
    name: "D+30: Aviso de Restrição",
    description: "30 dias após vencimento",
    daysFromDueDate: 30,
    channels: ["email"],
    whatsappTemplate: "",
    emailTemplate: `Prezado(a) {clientName},

Informamos que o boleto vencido em {dueDate} permanece em aberto. A partir deste momento, atendimentos administrativos não obrigatórios poderão ser suspensos até a regularização.

Link para pagamento:
{paymentLink}

Atenciosamente,
{companyName}`,
  },

  {
    stage: "d_plus_45",
    name: "D+45: Notificação Final",
    description: "45 dias após vencimento",
    daysFromDueDate: 45,
    channels: ["email"],
    whatsappTemplate: "",
    emailTemplate: `Prezado(a) {clientName},

Conforme comunicações anteriores, o boleto referente aos serviços contábeis permanece em aberto há mais de 45 dias.

Esta é a última notificação antes da adoção de medidas administrativas internas.

Link para pagamento:
{paymentLink}

Atenciosamente,
{companyName}`,
  },

  {
    stage: "d_plus_60",
    name: "D+60: Suspensão Administrativa",
    description: "60 dias após vencimento",
    daysFromDueDate: 60,
    channels: ["email"],
    whatsappTemplate: "",
    emailTemplate: `Prezado(a) {clientName},

Devido à inadimplência superior a 60 dias, informamos que o atendimento administrativo encontra-se suspenso.

A regularização do pagamento é necessária para reativação dos serviços.

Atenciosamente,
{companyName}`,
  },
];

/**
 * Obter template por estágio
 */
export function getCollectionTemplate(stage: string): CollectionTemplate | undefined {
  return collectionRuleTemplates.find((t) => t.stage === stage);
}

/**
 * Calcular qual estágio deve ser enviado baseado em dias de atraso
 */
export function getStageByDaysOverdue(daysOverdue: number): string | null {
  if (daysOverdue >= 60) return "d_plus_60";
  if (daysOverdue >= 45) return "d_plus_45";
  if (daysOverdue >= 30) return "d_plus_30";
  if (daysOverdue >= 15) return "d_plus_15";
  if (daysOverdue >= 7) return "d_plus_7";
  if (daysOverdue >= 3) return "d_plus_3";
  if (daysOverdue >= 0) return "d_minus_1"; // Enviado no D-1 ou D+0
  if (daysOverdue >= -1) return "d_minus_1";
  if (daysOverdue >= -5) return "d_minus_5";
  return null; // Muito cedo, antes do D-5
}

/**
 * Formatar template com variáveis
 */
export function formatTemplate(
  template: string,
  variables: {
    clientName: string;
    dueDate: string;
    paymentLink: string;
    companyName: string;
    amount?: string;
    daysOverdue?: number;
  }
): string {
  let formatted = template;

  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{${key}}`;
    formatted = formatted.replace(new RegExp(placeholder, "g"), String(value || ""));
  });

  return formatted;
}
