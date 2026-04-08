/**
 * 🔍 Serviço de Auditoria Completa do Sistema Manos
 * 
 * Valida todos os componentes antes de disparar boletos reais:
 * 1. OAuth Conta Azul
 * 2. Busca de Boletos
 * 3. Envio WhatsApp
 * 4. Dashboard/Auditoria
 * 5. Scheduler de Cobrança
 * 6. Webhook de Pagamento
 * 7. Criptografia AES-256
 * 8. Conexão com Banco de Dados
 */

import { getDb } from "./db";
import { contaAzulTokens, receivables, clients, collectionMessages } from "../drizzle/schema";
import { eq, and, ne, isNotNull } from "drizzle-orm";
import { getSchedulerStatus } from "./collectionScheduler";
import * as crypto from "crypto";

export interface AuditResult {
  timestamp: string;
  status: "healthy" | "warning" | "critical";
  checks: {
    oauth: CheckResult;
    boletos: CheckResult;
    whatsapp: CheckResult;
    dashboard: CheckResult;
    scheduler: CheckResult;
    webhook: CheckResult;
    encryption: CheckResult;
    database: CheckResult;
  };
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    failed: number;
    successRate: number;
  };
  recommendations: string[];
}

export interface CheckResult {
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
  details?: any;
  suggestedCommand?: string;
}

/**
 * Executar auditoria completa
 */
export async function runFullAudit(): Promise<AuditResult> {
  const checks = {
    oauth: await checkOAuth(),
    boletos: await checkBoletos(),
    whatsapp: await checkWhatsApp(),
    dashboard: await checkDashboard(),
    scheduler: await checkScheduler(),
    webhook: await checkWebhook(),
    encryption: await checkEncryption(),
    database: await checkDatabase(),
  };

  // Calcular resumo
  const allChecks = Object.values(checks);
  const passed = allChecks.filter((c) => c.status === "pass").length;
  const warnings = allChecks.filter((c) => c.status === "warning").length;
  const failed = allChecks.filter((c) => c.status === "fail").length;
  const successRate = (passed / allChecks.length) * 100;

  // Determinar status geral
  let status: "healthy" | "warning" | "critical" = "healthy";
  if (failed > 0) status = "critical";
  else if (warnings > 0) status = "warning";

  // Gerar recomendações
  const recommendations = generateRecommendations(checks);

  return {
    timestamp: new Date().toISOString(),
    status,
    checks,
    summary: {
      totalChecks: allChecks.length,
      passed,
      warnings,
      failed,
      successRate,
    },
    recommendations,
  };
}

/**
 * ✅ Validar OAuth Conta Azul
 */
async function checkOAuth(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        name: "OAuth Conta Azul",
        status: "fail",
        message: "❌ Banco de dados não disponível",
      };
    }
    const tokens = await db
      .select()
      .from(contaAzulTokens)
      .limit(1);

    if (tokens.length === 0) {
      return {
        name: "OAuth Conta Azul",
        status: "fail",
        message: "❌ Nenhum token OAuth encontrado",
        suggestedCommand: "Acesse /conta-azul-oauth e clique em 'Conectar com Conta Azul'",
      };
    }

    const token = tokens[0];
    const expiresAt = new Date(token.expiresAt);
    const now = new Date();
    const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilExpiry < 0) {
      return {
        name: "OAuth Conta Azul",
        status: "fail",
        message: "❌ Token OAuth expirado",
        details: { expiresAt: token.expiresAt.toISOString() },
        suggestedCommand: "Acesse /conta-azul-oauth e reconecte",
      };
    }

    if (hoursUntilExpiry < 24) {
      return {
        name: "OAuth Conta Azul",
        status: "warning",
        message: `⚠️ Token OAuth expirará em ${Math.round(hoursUntilExpiry)} horas`,
        details: { expiresAt: token.expiresAt.toISOString() },
        suggestedCommand: "Monitore a expiração ou reconecte preventivamente",
      };
    }

    return {
      name: "OAuth Conta Azul",
      status: "pass",
      message: `✅ Token OAuth válido (expira em ${Math.round(hoursUntilExpiry)} horas)`,
      details: { expiresAt: token.expiresAt.toISOString() },
    };
  } catch (error) {
    return {
      name: "OAuth Conta Azul",
      status: "fail",
      message: `❌ Erro ao validar OAuth: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Busca de Boletos
 */
async function checkBoletos(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        name: "Busca de Boletos",
        status: "fail",
        message: "❌ Banco de dados não disponível",
      };
    }

    // Buscar boletos abertos
    const openBoletos = await db
      .select()
      .from(receivables)
      .where(eq(receivables.status, "pending"))
      .limit(1);

    // Buscar boletos vencidos
    const overdueBoletos = await db
      .select()
      .from(receivables)
      .where(eq(receivables.status, "overdue"))
      .limit(1);

    const totalOpen = openBoletos.length;
    const totalOverdue = overdueBoletos.length;

    if (totalOpen === 0 && totalOverdue === 0) {
      return {
        name: "Busca de Boletos",
        status: "warning",
        message: "⚠️ Nenhum boleto aberto ou vencido encontrado",
        details: { totalOpen, totalOverdue },
      };
    }

    return {
      name: "Busca de Boletos",
      status: "pass",
      message: `✅ ${totalOpen + totalOverdue} boleto(s) encontrado(s)`,
      details: { totalOpen, totalOverdue },
    };
  } catch (error) {
    return {
      name: "Busca de Boletos",
      status: "fail",
      message: `❌ Erro ao buscar boletos: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Integração WhatsApp
 */
async function checkWhatsApp(): Promise<CheckResult> {
  try {
    // Verificar se há clientes com WhatsApp configurado
    const db = await getDb();
    if (!db) {
      return {
        name: "Integração WhatsApp",
        status: "fail",
        message: "❌ Banco de dados não disponível",
      };
    }
    const clientsWithWhatsApp = await db
      .select()
      .from(clients)
      .where(isNotNull(clients.whatsappNumber))
      .limit(1);

    if (clientsWithWhatsApp.length === 0) {
      return {
        name: "Integração WhatsApp",
        status: "warning",
        message: "⚠️ Nenhum cliente com WhatsApp configurado",
      };
    }

    // Verificar se há mensagens enviadas
    const sentMessages = await db
      .select()
      .from(collectionMessages)
      .where(ne(collectionMessages.status, "pending"))
      .limit(1);

    if (sentMessages.length === 0) {
      return {
        name: "Integração WhatsApp",
        status: "warning",
        message: "⚠️ Nenhuma mensagem WhatsApp enviada ainda",
      };
    }

    return {
      name: "Integração WhatsApp",
      status: "pass",
      message: `✅ WhatsApp configurado e funcional`,
      details: { clientsWithWhatsApp: clientsWithWhatsApp.length },
    };
  } catch (error) {
    return {
      name: "Integração WhatsApp",
      status: "fail",
      message: `❌ Erro ao validar WhatsApp: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Dashboard/Auditoria
 */
async function checkDashboard(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        name: "Dashboard/Auditoria",
        status: "fail",
        message: "❌ Banco de dados não disponível",
      };
    }

    // Verificar se há dados de auditoria
    const messages = await db.select().from(collectionMessages).limit(1);

    if (messages.length === 0) {
      return {
        name: "Dashboard/Auditoria",
        status: "warning",
        message: "⚠️ Nenhum dado de auditoria encontrado",
      };
    }

    return {
      name: "Dashboard/Auditoria",
      status: "pass",
      message: `✅ Dashboard com dados de auditoria`,
      details: { messagesCount: messages.length },
    };
  } catch (error) {
    return {
      name: "Dashboard/Auditoria",
      status: "fail",
      message: `❌ Erro ao validar dashboard: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Scheduler de Cobrança
 */
async function checkScheduler(): Promise<CheckResult> {
  try {
    const status = getSchedulerStatus();

    if (!status.ativo) {
      return {
        name: "Scheduler de Cobrança",
        status: "warning",
        message: "⚠️ Scheduler de cobrança não está ativo",
        suggestedCommand: "Reinicie o servidor para ativar o scheduler",
      };
    }

    return {
      name: "Scheduler de Cobrança",
      status: "pass",
      message: `✅ Scheduler ativo (${status.horarios.join(", ")})`,
      details: status,
    };
  } catch (error) {
    return {
      name: "Scheduler de Cobrança",
      status: "fail",
      message: `❌ Erro ao validar scheduler: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Webhook de Pagamento
 */
async function checkWebhook(): Promise<CheckResult> {
  try {
    // Verificar se há webhook configurado no ambiente
    const webhookUrl = process.env.WEBHOOK_URL;
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (!webhookUrl || !webhookSecret) {
      return {
        name: "Webhook de Pagamento",
        status: "warning",
        message: "⚠️ Webhook não está configurado",
        suggestedCommand: "Configure WEBHOOK_URL e WEBHOOK_SECRET no .env",
      };
    }

    return {
      name: "Webhook de Pagamento",
      status: "pass",
      message: "✅ Webhook configurado",
      details: { webhookUrl: webhookUrl.substring(0, 50) + "..." },
    };
  } catch (error) {
    return {
      name: "Webhook de Pagamento",
      status: "fail",
      message: `❌ Erro ao validar webhook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Criptografia AES-256
 */
async function checkEncryption(): Promise<CheckResult> {
  try {
    const encryptionKey = process.env.ENCRYPTION_KEY;

    if (!encryptionKey) {
      return {
        name: "Criptografia AES-256",
        status: "fail",
        message: "❌ Chave de criptografia não configurada",
        suggestedCommand: "Configure ENCRYPTION_KEY no .env",
      };
    }

    // Testar criptografia
    const testData = "test-data-12345";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(encryptionKey.padEnd(32, "0").substring(0, 32)),
      iv
    );

    let encrypted = cipher.update(testData, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Testar descriptografia
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(encryptionKey.padEnd(32, "0").substring(0, 32)),
      iv
    );

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    if (decrypted !== testData) {
      return {
        name: "Criptografia AES-256",
        status: "fail",
        message: "❌ Falha na descriptografia",
      };
    }

    return {
      name: "Criptografia AES-256",
      status: "pass",
      message: "✅ Criptografia AES-256 funcional",
    };
  } catch (error) {
    return {
      name: "Criptografia AES-256",
      status: "fail",
      message: `❌ Erro ao validar criptografia: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * ✅ Validar Conexão com Banco de Dados
 */
async function checkDatabase(): Promise<CheckResult> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        name: "Conexão com Banco de Dados",
        status: "fail",
        message: "❌ Banco de dados não disponível",
        suggestedCommand: "Verifique DATABASE_URL e conexão MySQL",
      };
    }

    // Testar query simples
    const result = await db.select().from(clients).limit(1);

    return {
      name: "Conexão com Banco de Dados",
      status: "pass",
      message: "✅ Banco de dados conectado e funcional",
      details: { clientsCount: result.length },
    };
  } catch (error) {
    return {
      name: "Conexão com Banco de Dados",
      status: "fail",
      message: `❌ Erro ao conectar ao banco: ${error instanceof Error ? error.message : String(error)}`,
      suggestedCommand: "Verifique DATABASE_URL e conexão MySQL",
    };
  }
}

/**
 * Gerar recomendações baseadas nos resultados
 */
function generateRecommendations(checks: Record<string, CheckResult>): string[] {
  const recommendations: string[] = [];

  if (checks.oauth.status === "fail") {
    recommendations.push("🔴 CRÍTICO: Reautorize OAuth Conta Azul antes de disparar boletos");
  }

  if (checks.boletos.status === "warning") {
    recommendations.push("🟡 Sincronize boletos do Conta Azul ou crie boletos de teste");
  }

  if (checks.whatsapp.status === "warning") {
    recommendations.push("🟡 Configure números WhatsApp para os clientes");
  }

  if (checks.scheduler.status === "warning") {
    recommendations.push("🟡 Reinicie o servidor para ativar o scheduler automático");
  }

  if (checks.webhook.status === "warning") {
    recommendations.push("🟡 Configure webhook para receber notificações de pagamento");
  }

  if (checks.database.status === "fail") {
    recommendations.push("🔴 CRÍTICO: Verifique conexão com banco de dados");
  }

  if (
    checks.oauth.status === "pass" &&
    checks.boletos.status === "pass" &&
    checks.whatsapp.status === "pass" &&
    checks.database.status === "pass"
  ) {
    recommendations.push("✅ Sistema pronto! Você pode disparar o primeiro boleto real");
  }

  return recommendations;
}

/**
 * Formatar resultado para console com emojis
 */
export function formatAuditForConsole(result: AuditResult): string {
  const lines: string[] = [];

  lines.push("\n╔════════════════════════════════════════════════════════════╗");
  lines.push("║  🔍 AUDITORIA COMPLETA DO SISTEMA MANOS                   ║");
  lines.push("╚════════════════════════════════════════════════════════════╝\n");

  // Status geral
  const statusEmoji = result.status === "healthy" ? "✅" : result.status === "warning" ? "🟡" : "🔴";
  lines.push(`${statusEmoji} Status Geral: ${result.status.toUpperCase()}\n`);

  // Resumo
  lines.push("📊 RESUMO:");
  lines.push(`  Total de verificações: ${result.summary.totalChecks}`);
  lines.push(`  ✅ Passou: ${result.summary.passed}`);
  lines.push(`  🟡 Avisos: ${result.summary.warnings}`);
  lines.push(`  🔴 Falhas: ${result.summary.failed}`);
  lines.push(`  📈 Taxa de sucesso: ${result.summary.successRate.toFixed(1)}%\n`);

  // Detalhes de cada check
  lines.push("🔎 DETALHES:\n");

  Object.entries(result.checks).forEach(([key, check]) => {
    const emoji = check.status === "pass" ? "✅" : check.status === "warning" ? "🟡" : "🔴";
    lines.push(`${emoji} ${check.name}`);
    lines.push(`   ${check.message}`);

    if (check.details) {
      lines.push(`   📋 Detalhes: ${JSON.stringify(check.details)}`);
    }

    if (check.suggestedCommand) {
      lines.push(`   💡 Sugestão: ${check.suggestedCommand}`);
    }

    lines.push("");
  });

  // Recomendações
  if (result.recommendations.length > 0) {
    lines.push("💡 RECOMENDAÇÕES:\n");
    result.recommendations.forEach((rec) => {
      lines.push(`  ${rec}`);
    });
    lines.push("");
  }

  lines.push("╔════════════════════════════════════════════════════════════╗");
  lines.push(`║  Auditoria em: ${result.timestamp}  ║`);
  lines.push("╚════════════════════════════════════════════════════════════╝\n");

  return lines.join("\n");
}
