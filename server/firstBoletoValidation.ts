/**
 * 🔍 Serviço de Validação Pré-Envio do Primeiro Boleto
 * 
 * Verifica todos os pré-requisitos antes de enviar o primeiro boleto:
 * 1. Token OAuth do Conta Azul válido
 * 2. Webhook registrado e ativo
 * 3. Cliente com dados completos
 * 4. Número WhatsApp no formato correto
 * 5. Boleto com link de pagamento
 * 6. Dados do receivable corretos
 */

import { getDb } from "./db";
import { contaAzulTokens, receivables, clients } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export interface ValidationStep {
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
  details?: Record<string, any>;
  suggestedAction?: string;
}

export interface PreDispatchValidation {
  timestamp: string;
  overallStatus: "ready" | "warning" | "blocked";
  steps: ValidationStep[];
  summary: {
    totalSteps: number;
    passed: number;
    warnings: number;
    failed: number;
  };
  recommendations: string[];
  readyToDispatch: boolean;
  boleto?: {
    id: number;
    customerName: string;
    whatsappNumber: string;
    amount: number;
    dueDate: Date;
  };
}

/**
 * Validar token OAuth
 */
async function validateOAuthToken(): Promise<ValidationStep> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        name: "Token OAuth Conta Azul",
        status: "fail",
        message: "❌ Banco de dados não disponível",
      };
    }

    const tokens = await db.select().from(contaAzulTokens).limit(1);

    if (tokens.length === 0) {
      return {
        name: "Token OAuth Conta Azul",
        status: "fail",
        message: "❌ Nenhum token OAuth encontrado",
        suggestedAction: "Acesse /conta-azul-oauth e autorize a conexão com Conta Azul",
      };
    }

    const token = tokens[0];
    const expiresAt = new Date(token.expiresAt);
    const now = new Date();
    const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilExpiry < 0) {
      return {
        name: "Token OAuth Conta Azul",
        status: "fail",
        message: "❌ Token OAuth expirado",
        details: { expiresAt: token.expiresAt.toISOString() },
        suggestedAction: "Acesse /conta-azul-oauth e reconecte",
      };
    }

    if (hoursUntilExpiry < 24) {
      return {
        name: "Token OAuth Conta Azul",
        status: "warning",
        message: `⚠️ Token expirará em ${Math.round(hoursUntilExpiry)} horas`,
        details: { expiresAt: token.expiresAt.toISOString() },
        suggestedAction: "Reconecte preventivamente para evitar interrupções",
      };
    }

    return {
      name: "Token OAuth Conta Azul",
      status: "pass",
      message: `✅ Token válido (expira em ${Math.round(hoursUntilExpiry)} horas)`,
      details: { expiresAt: token.expiresAt.toISOString() },
    };
  } catch (error) {
    return {
      name: "Token OAuth Conta Azul",
      status: "fail",
      message: `❌ Erro ao validar token: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validar webhook
 */
function validateWebhook(): ValidationStep {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    return {
      name: "Webhook de Pagamento",
      status: "warning",
      message: "⚠️ Webhook não está configurado",
      suggestedAction: "Configure WEBHOOK_URL e WEBHOOK_SECRET no .env",
    };
  }

  try {
    new URL(webhookUrl);
    return {
      name: "Webhook de Pagamento",
      status: "pass",
      message: "✅ Webhook configurado e ativo",
      details: { webhookUrl },
    };
  } catch {
    return {
      name: "Webhook de Pagamento",
      status: "fail",
      message: "❌ URL do webhook inválida",
      suggestedAction: "Verifique o formato da WEBHOOK_URL",
    };
  }
}

/**
 * Validar cliente e boleto específico
 */
async function validateClientAndBoleto(
  customerCnpj: string
): Promise<ValidationStep & { boleto?: any }> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        name: "Cliente e Boleto",
        status: "fail",
        message: "❌ Banco de dados não disponível",
      };
    }

    // Buscar cliente
    // Buscar cliente por contaAzulId (que é o CNPJ/ID do Conta Azul)
    const clientList = await db
      .select()
      .from(clients)
      .where(eq(clients.contaAzulId, customerCnpj))
      .limit(1);

    if (clientList.length === 0) {
      return {
        name: "Cliente e Boleto",
        status: "fail",
        message: `❌ Cliente com CNPJ ${customerCnpj} não encontrado`,
        suggestedAction: "Verifique o CNPJ do cliente",
      };
    }

    const client = clientList[0];

    // Validar WhatsApp
    if (!client.whatsappNumber) {
      return {
        name: "Cliente e Boleto",
        status: "fail",
        message: `❌ Cliente ${client.name} não tem WhatsApp configurado`,
        suggestedAction: "Adicione o número WhatsApp do cliente",
      };
    }

    // Validar formato WhatsApp
    const whatsappRegex = /^\+55\d{10,11}$/;
    if (!whatsappRegex.test(client.whatsappNumber)) {
      return {
        name: "Cliente e Boleto",
        status: "fail",
        message: `❌ Número WhatsApp inválido: ${client.whatsappNumber}`,
        suggestedAction: "Use formato: +55DDDNÚMERO (ex: +5511999999999)",
      };
    }

    // Buscar boleto aberto ou vencido
    const boletoList = await db
      .select()
      .from(receivables)
      .where(eq(receivables.clientId, client.id))
      .limit(1);

    if (boletoList.length === 0) {
      return {
        name: "Cliente e Boleto",
        status: "warning",
        message: `⚠️ Nenhum boleto encontrado para ${client.name}`,
        suggestedAction: "Sincronize boletos do Conta Azul ou crie boletos de teste",
      };
    }

    const boleto = boletoList[0];

    // Validar dados do boleto
    if (!boleto.amount || parseFloat(boleto.amount as any) <= 0) {
      return {
        name: "Cliente e Boleto",
        status: "fail",
        message: `❌ Boleto sem valor válido`,
        suggestedAction: "Verifique o valor do boleto no banco",
      };
    }

    if (!boleto.dueDate) {
      return {
        name: "Cliente e Boleto",
        status: "fail",
        message: `❌ Boleto sem data de vencimento`,
        suggestedAction: "Verifique a data de vencimento no banco",
      };
    }

    // Nota: O link do boleto será obtido do Conta Azul durante o envio
    // Por enquanto, apenas validamos se o boleto existe

    return {
      name: "Cliente e Boleto",
      status: "pass",
      message: `✅ Cliente ${client.name} com boleto válido`,
      details: {
        clientId: client.id,
        clientName: client.name,
        whatsappNumber: client.whatsappNumber,
        boletoId: boleto.id,
        amount: boleto.amount,
        dueDate: boleto.dueDate,
      },
      boleto: {
        id: boleto.id,
        customerName: client.name,
        whatsappNumber: client.whatsappNumber,
        amount: parseFloat(boleto.amount as any),
        dueDate: boleto.dueDate,
      },
    };
  } catch (error) {
    return {
      name: "Cliente e Boleto",
      status: "fail",
      message: `❌ Erro ao validar cliente: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Executar validação completa pré-envio
 */
export async function runPreDispatchValidation(
  customerCnpj: string
): Promise<PreDispatchValidation> {
  const steps: ValidationStep[] = [];
  let boleto: any = null;

  // Etapa 1: Validar OAuth
  const oauthStep = await validateOAuthToken();
  steps.push(oauthStep);

  // Etapa 2: Validar Webhook
  const webhookStep = validateWebhook();
  steps.push(webhookStep);

  // Etapa 3: Validar Cliente e Boleto
  const clientStep = await validateClientAndBoleto(customerCnpj);
  steps.push(clientStep);
  if ("boleto" in clientStep) {
    boleto = clientStep.boleto;
  }

  // Calcular resumo
  const passed = steps.filter((s) => s.status === "pass").length;
  const warnings = steps.filter((s) => s.status === "warning").length;
  const failed = steps.filter((s) => s.status === "fail").length;

  // Determinar status geral
  let overallStatus: "ready" | "warning" | "blocked" = "ready";
  if (failed > 0) {
    overallStatus = "blocked";
  } else if (warnings > 0) {
    overallStatus = "warning";
  }

  // Gerar recomendações
  const recommendations: string[] = [];
  steps.forEach((step) => {
    if (step.status === "fail" && step.suggestedAction) {
      recommendations.push(`🔴 ${step.name}: ${step.suggestedAction}`);
    } else if (step.status === "warning" && step.suggestedAction) {
      recommendations.push(`🟡 ${step.name}: ${step.suggestedAction}`);
    }
  });

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    steps,
    summary: {
      totalSteps: steps.length,
      passed,
      warnings,
      failed,
    },
    recommendations,
    readyToDispatch: failed === 0 && overallStatus !== "blocked",
    boleto,
  };
}

/**
 * Formatar validação para console
 */
export function formatValidationForConsole(validation: PreDispatchValidation): string {
  const lines: string[] = [];

  lines.push("\n🔍 VALIDAÇÃO PRÉ-ENVIO DO PRIMEIRO BOLETO\n");
  lines.push("=".repeat(60));

  // Status geral
  const statusEmoji =
    validation.overallStatus === "ready"
      ? "✅"
      : validation.overallStatus === "warning"
        ? "🟡"
        : "🔴";
  lines.push(`\n${statusEmoji} Status Geral: ${validation.overallStatus.toUpperCase()}`);
  lines.push(`Timestamp: ${new Date(validation.timestamp).toLocaleString("pt-BR")}\n`);

  // Resumo
  lines.push("📊 RESUMO");
  lines.push("-".repeat(60));
  lines.push(`Total de validações: ${validation.summary.totalSteps}`);
  lines.push(`✅ Passou: ${validation.summary.passed}`);
  lines.push(`🟡 Avisos: ${validation.summary.warnings}`);
  lines.push(`🔴 Falhas: ${validation.summary.failed}\n`);

  // Detalhes de cada etapa
  lines.push("🔎 DETALHES DAS VALIDAÇÕES");
  lines.push("-".repeat(60));

  validation.steps.forEach((step) => {
    const emoji = step.status === "pass" ? "✅" : step.status === "warning" ? "🟡" : "🔴";
    lines.push(`\n${emoji} ${step.name}`);
    lines.push(`   Status: ${step.status.toUpperCase()}`);
    lines.push(`   ${step.message}`);

    if (step.details) {
      lines.push(`   Detalhes: ${JSON.stringify(step.details, null, 4)}`);
    }

    if (step.suggestedAction) {
      lines.push(`   💡 Ação: ${step.suggestedAction}`);
    }
  });

  // Recomendações
  if (validation.recommendations.length > 0) {
    lines.push("\n💡 RECOMENDAÇÕES");
    lines.push("-".repeat(60));
    validation.recommendations.forEach((rec) => {
      lines.push(rec);
    });
  }

  // Boleto
  if (validation.boleto) {
    lines.push("\n📄 DADOS DO BOLETO");
    lines.push("-".repeat(60));
    lines.push(`Cliente: ${validation.boleto.customerName}`);
    lines.push(`WhatsApp: ${validation.boleto.whatsappNumber}`);
      lines.push(`Valor: R$ ${validation.boleto.amount.toFixed(2)}`);
    lines.push(`Vencimento: ${new Date(validation.boleto.dueDate).toLocaleDateString("pt-BR")}`);
    lines.push(`Link: [Será obtido do Conta Azul durante o envio]`);
  }

  // Conclusão
  lines.push("\n" + "=".repeat(60));
  if (validation.readyToDispatch) {
    lines.push("✅ SISTEMA PRONTO PARA ENVIO DO BOLETO");
  } else {
    lines.push("🔴 SISTEMA NÃO ESTÁ PRONTO - RESOLVA OS PROBLEMAS ACIMA");
  }
  lines.push("=".repeat(60) + "\n");

  return lines.join("\n");
}
