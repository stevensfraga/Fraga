/**
 * 📝 Serviço de Preparação de Mensagem para Envio de Boleto
 * 
 * Monta a mensagem personalizada com validações:
 * - Formatação de moeda (R$)
 * - Formatação de data (DD/MM/YYYY)
 * - Validação de número WhatsApp
 * - Personalização com nome do cliente
 */

export interface MessageData {
  customerName: string;
  whatsappNumber: string;
  amount: number;
  dueDate: Date;
  bankSlipUrl: string;
  messageType?: "friendly" | "administrative" | "formal";
}

export interface PreparedMessage {
  whatsappNumber: string;
  message: string;
  formattedAmount: string;
  formattedDueDate: string;
  validation: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
}

/**
 * Formatar valor em moeda brasileira
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

/**
 * Formatar data em formato brasileiro
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

/**
 * Validar número WhatsApp
 */
export function validateWhatsAppNumber(number: string): { isValid: boolean; error?: string } {
  // Remover espaços e caracteres especiais
  const cleaned = number.replace(/\D/g, "");

  // Validar formato: +55 + DDD (2-3 dígitos) + número (8-9 dígitos)
  const whatsappRegex = /^55\d{10,11}$/;

  if (!whatsappRegex.test(cleaned)) {
    return {
      isValid: false,
      error: `Número inválido: ${number}. Use formato: +55DDDNÚMERO (ex: +5511999999999)`,
    };
  }

  return { isValid: true };
}

/**
 * Validar URL do boleto
 */
export function validateBankSlipUrl(url: string): { isValid: boolean; error?: string } {
  try {
    new URL(url);

    // Verificar se é uma URL HTTPS
    if (!url.startsWith("https://")) {
      return {
        isValid: false,
        error: "URL do boleto deve usar HTTPS",
      };
    }

    return { isValid: true };
  } catch {
    return {
      isValid: false,
      error: `URL inválida: ${url}`,
    };
  }
}

/**
 * Gerar mensagem amigável
 */
function generateFriendlyMessage(data: MessageData): string {
  return `Olá, ${data.customerName}! 👋

Segue seu boleto em aberto:

💰 Valor: ${formatCurrency(data.amount)}
📅 Vencimento: ${formatDate(data.dueDate)}

🔗 Link para pagamento:
${data.bankSlipUrl}

Qualquer dúvida, é só chamar! 😊`;
}

/**
 * Gerar mensagem administrativa
 */
function generateAdministrativeMessage(data: MessageData): string {
  return `${data.customerName},

Informamos que você possui um boleto em aberto:

Valor: ${formatCurrency(data.amount)}
Vencimento: ${formatDate(data.dueDate)}

Acesse o link para realizar o pagamento:
${data.bankSlipUrl}

Atenciosamente,
Fraga Contabilidade`;
}

/**
 * Gerar mensagem formal
 */
function generateFormalMessage(data: MessageData): string {
  return `Prezado(a) ${data.customerName},

Conforme registros em nosso sistema, encontra-se em aberto o seguinte título:

Valor: ${formatCurrency(data.amount)}
Data de Vencimento: ${formatDate(data.dueDate)}

Solicitamos a regularização do débito através do link abaixo:
${data.bankSlipUrl}

Caso o pagamento já tenha sido realizado, desconsidere esta mensagem.

Atenciosamente,
Departamento Financeiro
Fraga Contabilidade`;
}

/**
 * Preparar mensagem para envio
 */
export function prepareMessage(data: MessageData): PreparedMessage {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validar WhatsApp
  const whatsappValidation = validateWhatsAppNumber(data.whatsappNumber);
  if (!whatsappValidation.isValid) {
    errors.push(whatsappValidation.error || "Número WhatsApp inválido");
  }

  // Validar URL do boleto
  const urlValidation = validateBankSlipUrl(data.bankSlipUrl);
  if (!urlValidation.isValid) {
    errors.push(urlValidation.error || "URL do boleto inválida");
  }

  // Validar cliente
  if (!data.customerName || data.customerName.trim().length === 0) {
    errors.push("Nome do cliente não pode estar vazio");
  }

  // Validar valor
  if (data.amount <= 0) {
    errors.push("Valor deve ser maior que zero");
  }

  // Validar data
  if (!data.dueDate || isNaN(new Date(data.dueDate).getTime())) {
    errors.push("Data de vencimento inválida");
  }

  // Avisos
  const dueDate = new Date(data.dueDate);
  const today = new Date();
  const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) {
    warnings.push(`⚠️ Boleto vencido há ${Math.abs(daysUntilDue)} dias`);
  } else if (daysUntilDue <= 3) {
    warnings.push(`⚠️ Boleto vence em ${daysUntilDue} dias`);
  }

  // Gerar mensagem
  let message = "";
  const messageType = data.messageType || "friendly";

  if (errors.length === 0) {
    switch (messageType) {
      case "administrative":
        message = generateAdministrativeMessage(data);
        break;
      case "formal":
        message = generateFormalMessage(data);
        break;
      case "friendly":
      default:
        message = generateFriendlyMessage(data);
    }
  }

  return {
    whatsappNumber: data.whatsappNumber,
    message,
    formattedAmount: formatCurrency(data.amount),
    formattedDueDate: formatDate(data.dueDate),
    validation: {
      isValid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

/**
 * Validar mensagem preparada
 */
export function validatePreparedMessage(prepared: PreparedMessage): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!prepared.validation.isValid) {
    errors.push(...prepared.validation.errors);
  }

  if (!prepared.message || prepared.message.trim().length === 0) {
    errors.push("Mensagem não foi gerada");
  }

  if (prepared.message.length > 4096) {
    errors.push(`Mensagem muito longa (${prepared.message.length} caracteres, máximo 4096)`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Formatar preparação para exibição
 */
export function formatPreparedMessageForDisplay(prepared: PreparedMessage): string {
  const lines: string[] = [];

  lines.push("\n📝 MENSAGEM PREPARADA PARA ENVIO\n");
  lines.push("=".repeat(60));

  lines.push(`\n📱 WhatsApp: ${prepared.whatsappNumber}`);
  lines.push(`💰 Valor: ${prepared.formattedAmount}`);
  lines.push(`📅 Vencimento: ${prepared.formattedDueDate}`);

  lines.push("\n📄 CONTEÚDO DA MENSAGEM:");
  lines.push("-".repeat(60));
  lines.push(prepared.message);
  lines.push("-".repeat(60));

  if (prepared.validation.errors.length > 0) {
    lines.push("\n🔴 ERROS:");
    prepared.validation.errors.forEach((err) => {
      lines.push(`  - ${err}`);
    });
  }

  if (prepared.validation.warnings.length > 0) {
    lines.push("\n🟡 AVISOS:");
    prepared.validation.warnings.forEach((warn) => {
      lines.push(`  - ${warn}`);
    });
  }

  lines.push("\n" + "=".repeat(60));

  if (prepared.validation.isValid) {
    lines.push("✅ MENSAGEM PRONTA PARA ENVIO");
  } else {
    lines.push("🔴 MENSAGEM COM PROBLEMAS - NÃO PODE SER ENVIADA");
  }

  lines.push("=".repeat(60) + "\n");

  return lines.join("\n");
}
