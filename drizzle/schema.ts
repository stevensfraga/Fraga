import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, date, index, uniqueIndex, customType } from "drizzle-orm/mysql-core";

/**
 * Tipo customizado para MEDIUMBLOB (até 16MB) — usado para armazenar PFX/P12
 * O drizzle-orm não tem mediumblob nativo; customType mapeia para Buffer no TypeScript
 */
const mediumblob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "MEDIUMBLOB";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: Buffer) {
    return value;
  },
});

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "master", "operador", "visualizador"]).default("user").notNull(),
  /** Indica se o usuário está ativo (false = acesso bloqueado) */
  isActive: boolean("isActive").default(true).notNull(),
  /** Quem convidou/criou este usuário (userId) */
  invitedBy: int("invitedBy"),
  /** Observações internas */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Auditoria de ações críticas do sistema
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** Usuário que realizou a ação */
  userId: int("userId"),
  userName: varchar("userName", { length: 255 }),
  userRole: varchar("userRole", { length: 32 }),
  /** Tipo de ação */
  action: varchar("action", { length: 128 }).notNull(),
  /** Recurso afetado: user, certificate, integration, collection */
  resource: varchar("resource", { length: 64 }),
  /** ID do recurso afetado */
  resourceId: varchar("resourceId", { length: 128 }),
  /** Descrição legível da ação */
  description: text("description"),
  /** Dados antes da alteração (JSON) */
  oldValue: text("oldValue"),
  /** Dados após a alteração (JSON) */
  newValue: text("newValue"),
  /** IP do cliente */
  ipAddress: varchar("ipAddress", { length: 64 }),
  /** Status: success | failure */
  status: mysqlEnum("status", ["success", "failure"]).default("success").notNull(),
  /** Mensagem de erro se falhou */
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Clientes sincronizados do Conta Azul
 */
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  contaAzulId: varchar("contaAzulId", { length: 64 }).notNull().unique(),
  contaAzulPersonId: varchar("contaAzulPersonId", { length: 64 }), // UUID da Pessoa na Conta Azul
  name: varchar("name", { length: 255 }).notNull(),
  document: varchar("document", { length: 20 }), // CNPJ/CPF sem máscara
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  phone: varchar("phone", { length: 20 }), // Telefone comercial
  phoneCellular: varchar("phoneCellular", { length: 20 }), // Telefone celular (prioridade para WhatsApp)
  whatsappNumber: varchar("whatsappNumber", { length: 20 }),
  whatsappSource: mysqlEnum("whatsappSource", ["conta-azul", "manual", "import", "unknown"]).default("unknown").notNull(), // Origem do número de WhatsApp
  cnae: varchar("cnae", { length: 10 }),
  status: mysqlEnum("status", ["active", "inactive", "suspended"]).default("active").notNull(),
  optOut: boolean("optOut").default(false).notNull(),
  whatsappValidatedAt: timestamp("whatsappValidatedAt"), // Quando o WhatsApp foi validado (conta-azul ou manual)
  whatsappApprovedBy: varchar("whatsappApprovedBy", { length: 255 }), // Quem aprovou (email ou ID do admin)
  whatsappApprovalMethod: mysqlEnum("whatsappApprovalMethod", ["sync-conta-azul", "manual-approval", "csv-import"]), // Como foi aprovado
  // Telefones adicionais de cobrança (JSON array de strings E.164, ex: ["+5527981279294"])
  billingPhones: text("billingPhones"), // JSON: string[]
  // Flag para cobrança consolidada (soma todos os títulos em aberto num único disparo)
  sendConsolidatedDebt: boolean("sendConsolidatedDebt").default(true).notNull(),
  // Data até quando o cliente está em negociação (bloqueia régua até essa data)
  negotiatedUntil: timestamp("negotiatedUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  documentIdx: index("clients_document_idx").on(table.document),
}));

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

export type WhatsappSource = 'conta-azul' | 'manual' | 'import' | 'unknown';

// Índice para busca rápida por documento
export const clientDocumentIndex = index("clients_document_idx").on(clients.document);

// Índice para busca por whatsappSource (para auditoria)
export const clientWhatsappSourceIndex = index("clients_whatsappSource_idx").on(clients.whatsappSource);

/**
 * Contas a receber (inadimplência)
 */
export const receivables = mysqlTable("receivables", {
  id: int("id").autoincrement().primaryKey(),
  contaAzulId: varchar("contaAzulId", { length: 64 }).notNull(),
  clientId: int("clientId").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  paidDate: timestamp("paidDate"),
  status: mysqlEnum("status", ["pending", "overdue", "paid", "cancelled"]).default("pending").notNull(),
  monthsOverdue: int("monthsOverdue").default(0),
  description: text("description"),
  documento: varchar("documento", { length: 255 }),
  link: text("link"),
  linhaDigitavel: varchar("linhaDigitavel", { length: 100 }),
  pdfStorageUrl: text("pdfStorageUrl"), // URL pública do PDF no R2
  paymentLinkCanonical: varchar("paymentLinkCanonical", { length: 512 }), // Link canônico de pagamento (prioridade: fatura_url > boleto_url > linha)
  paymentInfoPublic: boolean("paymentInfoPublic").default(false).notNull(), // true se tem linha digitável ou link público
  paymentInfoSource: mysqlEnum("paymentInfoSource", ["zap_storage", "r2", "contaazul", "manual", "manual-pdf", "worker", "stored", "api", "panel", "fallback"]), // Origem dos dados de pagamento
  paymentInfoUpdatedAt: timestamp("paymentInfoUpdatedAt"), // Última atualização de dados de pagamento
  zapStorageFilename: varchar("zapStorageFilename", { length: 255 }), // Nome do arquivo no storage Zap (ex: R7GERADORESLTDA_9peIejdj.pdf)
  zapStorageFileSize: int("zapStorageFileSize"), // Tamanho do arquivo em bytes
  zapStorageUploadedAt: timestamp("zapStorageUploadedAt"), // Quando foi feito upload no storage Zap
  source: varchar("source", { length: 20 }).default("test").notNull(),
  lastDispatchedAt: timestamp("lastDispatchedAt"),
  dispatchCount: int("dispatchCount").default(0),
  collectionScore: decimal("collectionScore", { precision: 12, scale: 2 }).default("0").notNull(), // Score de priorização: (daysOverdue × 2) + (amount / 100)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  paymentInfoPublicIdx: index("receivables_paymentInfoPublic_idx").on(table.paymentInfoPublic),
}));

export type Receivable = typeof receivables.$inferSelect;
export type InsertReceivable = typeof receivables.$inferInsert;

/**
 * Histórico de cobranças via WhatsApp
 */
export const collectionMessages = mysqlTable("collectionMessages", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId"),
  cnpj: varchar("cnpj", { length: 20 }).notNull(),
  receivableId: int("receivableId"),
  messageType: mysqlEnum("messageType", ["friendly", "administrative", "formal"]).notNull(),
  messageTemplate: text("messageTemplate").notNull(),
  messageSent: text("messageSent"),
  whatsappMessageId: varchar("whatsappMessageId", { length: 255 }),
  status: mysqlEnum("status", ["pending", "sent", "delivered", "read", "failed"]).default("pending").notNull(),
  responseReceived: boolean("responseReceived").default(false),
  responseText: text("responseText"),
  responseDate: timestamp("responseDate"),
  
  // Análise de sentimento da resposta
  sentiment: mysqlEnum("sentiment", ["positive", "negative", "neutral", "mixed", "pending"]).default("pending"),
  sentimentScore: decimal("sentimentScore", { precision: 3, scale: 2 }), // 0.00 a 1.00
  sentimentAnalysis: text("sentimentAnalysis"), // Explicação da análise
  
  outcome: mysqlEnum("outcome", ["pending", "agreed", "paid", "no_response", "rejected"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  
  // Rastreamento de tentativas
  attemptCount: int("attemptCount").default(1).notNull(),
  lastError: text("lastError"),
  
  // Rastreamento do provedor (Zappy)
  providerMessageId: varchar("providerMessageId", { length: 255 }), // ID da mensagem no Zappy
  providerStatus: mysqlEnum("providerStatus", ["queued", "sent", "delivered", "read", "failed", "unknown"]).default("unknown"), // Status no provedor
  providerRawStatus: text("providerRawStatus"), // Resposta bruta do provedor
  providerError: text("providerError"), // Erro do provedor (se houver)
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  cnpjIndex: index("idx_cnpj").on(table.cnpj),
}));

export type CollectionMessage = typeof collectionMessages.$inferSelect;
export type InsertCollectionMessage = typeof collectionMessages.$inferInsert;

/**
 * Tabela para armazenar templates de mensagens dinâmicos por sentimento
 */
export const messageTemplates = mysqlTable("messageTemplates", {
  id: int("id").autoincrement().primaryKey(),
  
  // Identificação
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Tipo de mensagem e sentimento
  messageType: mysqlEnum("messageType", ["friendly", "administrative", "formal"]).notNull(),
  targetSentiment: mysqlEnum("targetSentiment", ["positive", "negative", "neutral", "mixed"]).notNull(),
  
  // Template
  template: text("template").notNull(),
  
  // Ativo/Inativo
  isActive: boolean("isActive").default(true).notNull(),
  
  // Controle
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = typeof messageTemplates.$inferInsert;

/**
 * Acordos de parcelamento
 */
export const agreements = mysqlTable("agreements", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  totalAmount: decimal("totalAmount", { precision: 12, scale: 2 }).notNull(),
  installments: int("installments").notNull(),
  installmentAmount: decimal("installmentAmount", { precision: 12, scale: 2 }).notNull(),
  startDate: timestamp("startDate").notNull(),
  status: mysqlEnum("status", ["active", "completed", "defaulted"]).default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Agreement = typeof agreements.$inferSelect;
export type InsertAgreement = typeof agreements.$inferInsert;

/**
 * Métricas de performance do agente de cobrança
 */
export const collectionMetrics = mysqlTable("collectionMetrics", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  messageType: mysqlEnum("messageType", ["friendly", "administrative", "formal"]).notNull(),
  
  // Métricas de resposta
  messageSent: boolean("messageSent").default(false),
  messageDelivered: boolean("messageDelivered").default(false),
  messageRead: boolean("messageRead").default(false),
  responseReceived: boolean("responseReceived").default(false),
  
  // Tempos
  sentAt: timestamp("sentAt"),
  deliveredAt: timestamp("deliveredAt"),
  readAt: timestamp("readAt"),
  respondedAt: timestamp("respondedAt"),
  
  // Resultado
  outcome: mysqlEnum("outcome", ["pending", "agreed", "paid", "no_response", "rejected"]).default("pending").notNull(),
  
  // Valores
  amountRequested: decimal("amountRequested", { precision: 12, scale: 2 }),
  amountRecovered: decimal("amountRecovered", { precision: 12, scale: 2 }),
  
  // Notas
  notes: text("notes"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CollectionMetric = typeof collectionMetrics.$inferSelect;
export type InsertCollectionMetric = typeof collectionMetrics.$inferInsert;

/**
 * Resumo diário de performance
 */
export const dailyPerformanceSummary = mysqlTable("dailyPerformanceSummary", {
  id: int("id").autoincrement().primaryKey(),
  date: date("date").notNull().unique(),
  
  // Totais do dia
  messagesSent: int("messagesSent").default(0).notNull(),
  messagesDelivered: int("messagesDelivered").default(0).notNull(),
  messagesRead: int("messagesRead").default(0).notNull(),
  responsesReceived: int("responsesReceived").default(0).notNull(),
  
  // Taxa de resposta
  responseRate: decimal("responseRate", { precision: 5, scale: 2 }).default("0.00").notNull(),
  
  // Resultados
  agreementsReached: int("agreementsReached").default(0).notNull(),
  paymentsReceived: int("paymentsReceived").default(0).notNull(),
  rejections: int("rejections").default(0).notNull(),
  
  // Valores
  totalRequested: decimal("totalRequested", { precision: 12, scale: 2 }).default("0.00").notNull(),
  totalRecovered: decimal("totalRecovered", { precision: 12, scale: 2 }).default("0.00").notNull(),
  recoveryRate: decimal("recoveryRate", { precision: 5, scale: 2 }).default("0.00").notNull(),
  
  // Tempo médio de resposta (em minutos)
  avgResponseTime: int("avgResponseTime").default(0).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyPerformanceSummary = typeof dailyPerformanceSummary.$inferSelect;
export type InsertDailyPerformanceSummary = typeof dailyPerformanceSummary.$inferInsert;

/**
 * Índices para busca rápida por telefone
 */
// Criar índices nas tabelas existentes
export const clientPhoneIndex = index("idx_client_whatsapp").on(clients.whatsappNumber);
export const clientPhoneIndex2 = index("idx_client_phone").on(clients.phone);

/**
 * Regras de cobrança por cliente (telefone, horários, etc)
 */
export const collectionRules = mysqlTable("collectionRules", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull().references(() => clients.id),
  contaAzulId: varchar("contaAzulId", { length: 64 }).notNull(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  whatsappNumber: varchar("whatsappNumber", { length: 20 }).notNull(),
  origin: mysqlEnum("origin", ["contaazul", "manual", "api"]).default("contaazul").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  contaAzulIdIndex: index("idx_collection_rules_conta_azul_id").on(table.contaAzulId),
  clientIdIndex: index("idx_collection_rules_client_id").on(table.clientId),
}));

export type CollectionRule = typeof collectionRules.$inferSelect;
export type InsertCollectionRule = typeof collectionRules.$inferInsert;

/**
 * Agendamento de follow-ups baseado em respostas anteriores
 */
export const scheduledFollowUps = mysqlTable("scheduledFollowUps", {
  id: int("id").autoincrement().primaryKey(),
  
  // Referências
  clientId: int("clientId").notNull().references(() => clients.id),
  previousMessageId: int("previousMessageId").references(() => collectionMessages.id),
  
  // Informações do follow-up
  scheduledFor: timestamp("scheduledFor").notNull(),
  messageType: mysqlEnum("messageType", ["friendly", "administrative", "formal"]).notNull(),
  messageTemplate: text("messageTemplate"),
  
  // Análise da resposta anterior
  previousResponse: text("previousResponse"),
  responseAnalysis: mysqlEnum("responseAnalysis", [
    "positive", // Cliente vai pagar
    "negative", // Cliente recusou
    "neutral", // Cliente pediu mais tempo
    "no_response", // Sem resposta
    "partial_agreement", // Acordo parcial
  ]).notNull(),
  
  // Status do agendamento
  status: mysqlEnum("status", [
    "pending", // Aguardando envio
    "sent", // Enviado
    "cancelled", // Cancelado
    "completed", // Concluído
  ]).default("pending").notNull(),
  
  // Motivo do agendamento
  reason: text("reason"),
  
  // Rastreamento
  sentAt: timestamp("sentAt"),
  cancelledAt: timestamp("cancelledAt"),
  cancelledReason: text("cancelledReason"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduledFollowUp = typeof scheduledFollowUps.$inferSelect;
export type InsertScheduledFollowUp = typeof scheduledFollowUps.$inferInsert;

/**
 * Histórico de análises de respostas (para treinamento de IA)
 */
export const responseAnalysisHistory = mysqlTable("responseAnalysisHistory", {
  id: int("id").autoincrement().primaryKey(),
  
  // Referência
  messageId: int("messageId").references(() => collectionMessages.id),
  followUpId: int("followUpId").references(() => scheduledFollowUps.id),
  
  // Resposta analisada
  responseText: text("responseText").notNull(),
  
  // Análise de sentimento
  sentiment: mysqlEnum("sentiment", ["positive", "negative", "neutral", "mixed"]).notNull(),
  sentimentScore: decimal("sentimentScore", { precision: 3, scale: 2 }).notNull(), // 0.00 a 1.00
  sentimentExplanation: text("sentimentExplanation"),
  
  // Ações sugeridas
  suggestedAction: mysqlEnum("suggestedAction", [
    "send_payment_link", // Enviar link de pagamento
    "schedule_call", // Agendar ligação
    "offer_discount", // Oferecer desconto
    "escalate_to_manager", // Escalar para gerente
    "wait_and_retry", // Aguardar e tentar novamente
    "mark_as_paid", // Marcar como pago
    "send_agreement", // Enviar acordo
  ]).notNull(),
  
  // Confiança na sugestão
  actionConfidence: decimal("actionConfidence", { precision: 3, scale: 2 }).notNull(),
  
  // Sugestão de próximo tom de mensagem
  suggestedNextTone: mysqlEnum("suggestedNextTone", ["friendly", "administrative", "formal", "escalate"]).notNull(),
  
  // Modelo de IA usado
  aiModel: varchar("aiModel", { length: 64 }).default("gpt-4").notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ResponseAnalysisHistory = typeof responseAnalysisHistory.$inferSelect;
export type InsertResponseAnalysisHistory = typeof responseAnalysisHistory.$inferInsert;

/**
 * Índices para follow-ups
 */
export const followUpClientIndex = index("idx_followup_client").on(scheduledFollowUps.clientId);
export const followUpScheduledIndex = index("idx_followup_scheduled").on(scheduledFollowUps.scheduledFor);
export const followUpStatusIndex = index("idx_followup_status").on(scheduledFollowUps.status);

/**
 * Índices para análise de sentimento
 */

export const responseAnalysisIndex = index("idx_response_analysis").on(responseAnalysisHistory.sentiment);

/**
 * Agendamento da régua de cobrança automática (7 estágios)
 * D-5, D-1, D+3, D+7, D+15, D+30, D+45, D+60
 */
export const collectionSchedule = mysqlTable("collectionSchedule", {
  id: int("id").autoincrement().primaryKey(),
  
  // Referências
  clientId: int("clientId").notNull().references(() => clients.id),
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  
  // Estágio da régua
  stage: mysqlEnum("stage", [
    "reset", // Mensagem de reset para clientes > 60 dias
    "d_minus_5", // D-5: Lembrete preventivo
    "d_minus_1", // D-1: Lembrete final
    "d_plus_3", // D+3: Aviso de pendência
    "d_plus_7", // D+7: Cobrança administrativa
    "d_plus_15", // D+15: Aviso formal
    "d_plus_30", // D+30: Aviso de restrição
    "d_plus_45", // D+45: Notificação final
    "d_plus_60", // D+60: Suspensão administrativa
  ]).notNull(),
  
  // Canais de envio
  channels: varchar("channels", { length: 255 }).notNull(), // "whatsapp,email" ou "email"
  
  // Agendamento
  scheduledFor: timestamp("scheduledFor").notNull(),
  sentAt: timestamp("sentAt"),
  
  // Status
  status: mysqlEnum("status", [
    "pending", // Aguardando envio
    "sent", // Enviado
    "delivered", // Entregue
    "failed", // Falha no envio
    "cancelled", // Cancelado (cliente pagou)
  ]).default("pending").notNull(),
  
  // Mensagens enviadas
  whatsappMessageId: varchar("whatsappMessageId", { length: 255 }),
  emailMessageId: varchar("emailMessageId", { length: 255 }),
  
  // Motivo do cancelamento
  cancelledReason: text("cancelledReason"),
  cancelledAt: timestamp("cancelledAt"),
  
  // Rastreamento
  attempts: int("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  lastError: text("lastError"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIndex: index("idx_schedule_client").on(table.clientId),
  receivableIdIndex: index("idx_schedule_receivable").on(table.receivableId),
  stageIndex: index("idx_schedule_stage").on(table.stage),
  statusIndex: index("idx_schedule_status").on(table.status),
  scheduledForIndex: index("idx_schedule_scheduled").on(table.scheduledFor),
}));

export type CollectionSchedule = typeof collectionSchedule.$inferSelect;
export type InsertCollectionSchedule = typeof collectionSchedule.$inferInsert;

/**
 * Tokens OAuth 2.0 do Conta Azul
 * Armazena access_token e refresh_token para autenticação persistente
 */
export const contaAzulTokens = mysqlTable("contaAzulTokens", {
  id: int("id").autoincrement().primaryKey(),
  
  // Tokens OAuth
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  
  // Expiração do access_token
  expiresAt: timestamp("expiresAt").notNull(),
  
  // Informações do usuário autorizado
  userId: int("userId").references(() => users.id),
  
  // Rastreamento
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  
  // Refresh tracking (correção estrutural 09/03/2026)
  lastRefreshAt: timestamp("lastRefreshAt"),
  lastRefreshStatus: varchar("lastRefreshStatus", { length: 20 }), // 'success' | 'failed' | 'pending'
  lastRefreshError: text("lastRefreshError"),
  consecutiveFailures: int("consecutiveFailures").default(0),
  needsReauth: boolean("needsReauth").default(false),
}, (table) => ({
  userIdIndex: index("idx_conta_azul_tokens_user").on(table.userId),
}));

export type ContaAzulToken = typeof contaAzulTokens.$inferSelect;
export type InsertContaAzulToken = typeof contaAzulTokens.$inferInsert;


/**
 * Webhooks recebidos do Conta Azul
 * Registra todas as notificações de pagamento para auditoria
 */
export const contaAzulWebhooks = mysqlTable("contaAzulWebhooks", {
  id: int("id").autoincrement().primaryKey(),
  
  // Identificador único do webhook do Conta Azul
  webhookId: varchar("webhookId", { length: 64 }).notNull().unique(),
  
  // Tipo de evento
  eventType: varchar("eventType", { length: 64 }).notNull(), // "payment", "invoice", etc
  
  // Dados brutos do webhook
  payload: text("payload").notNull(), // JSON serializado
  
  // Informações do pagamento
  receivableId: int("receivableId").references(() => receivables.id),
  clientId: int("clientId").references(() => clients.id),
  
  // Valor pago
  amountPaid: decimal("amountPaid", { precision: 12, scale: 2 }),
  
  // Data do pagamento
  paymentDate: timestamp("paymentDate"),
  
  // Status do processamento
  status: mysqlEnum("status", [
    "received", // Webhook recebido
    "processed", // Processado com sucesso
    "failed", // Erro ao processar
    "duplicate", // Duplicado
  ]).default("received").notNull(),
  
  // Erro se houver
  error: text("error"),
  
  // Rastreamento
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  webhookIdIndex: index("idx_webhook_id").on(table.webhookId),
  receivableIdIndex: index("idx_webhook_receivable").on(table.receivableId),
  clientIdIndex: index("idx_webhook_client").on(table.clientId),
  statusIndex: index("idx_webhook_status").on(table.status),
  eventTypeIndex: index("idx_webhook_event").on(table.eventType),
}));

export type ContaAzulWebhook = typeof contaAzulWebhooks.$inferSelect;
export type InsertContaAzulWebhook = typeof contaAzulWebhooks.$inferInsert;

/**
 * Histórico de pagamentos processados
 * Rastreia quando a régua de cobrança foi cancelada por pagamento
 */
export const paymentHistory = mysqlTable("paymentHistory", {
  id: int("id").autoincrement().primaryKey(),
  
  // Referências
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  clientId: int("clientId").notNull().references(() => clients.id),
  webhookId: int("webhookId").references(() => contaAzulWebhooks.id),
  
  // Informações do pagamento
  amountPaid: decimal("amountPaid", { precision: 12, scale: 2 }).notNull(),
  paymentDate: timestamp("paymentDate").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 64 }), // "boleto", "pix", "cartao", etc
  
  // Ação na régua de cobrança
  collectionScheduleCancelled: boolean("collectionScheduleCancelled").default(false).notNull(),
  cancelledSchedules: int("cancelledSchedules").default(0).notNull(), // Quantas mensagens foram canceladas
  
  // Notificação ao cliente
  notificationSent: boolean("notificationSent").default(false).notNull(),
  notificationMethod: varchar("notificationMethod", { length: 64 }), // "whatsapp", "email"
  
  // Rastreamento
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  receivableIdIndex: index("idx_payment_receivable").on(table.receivableId),
  clientIdIndex: index("idx_payment_client").on(table.clientId),
  webhookIdIndex: index("idx_payment_webhook").on(table.webhookId),
  paymentDateIndex: index("idx_payment_date").on(table.paymentDate),
}));

export type PaymentHistory = typeof paymentHistory.$inferSelect;
export type InsertPaymentHistory = typeof paymentHistory.$inferInsert;


/**
 * Fila de mensagens WhatsApp/Email
 * Rastreia todas as mensagens agendadas e enviadas
 */
export const messageQueue = mysqlTable("messageQueue", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull().references(() => clients.id),
  receivableId: int("receivableId").references(() => receivables.id),
  messageType: mysqlEnum("messageType", ["whatsapp", "email"]).notNull(),
  status: mysqlEnum("status", ["pending", "scheduled", "sent", "failed", "delivered"]).default("pending").notNull(),
  stage: varchar("stage", { length: 20 }).notNull(), // "d_minus_5", "d_minus_1", "d_plus_3", etc
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  subject: varchar("subject", { length: 255 }),
  body: text("body").notNull(),
  scheduledFor: timestamp("scheduledFor").notNull(),
  sentAt: timestamp("sentAt"),
  deliveredAt: timestamp("deliveredAt"),
  failureReason: text("failureReason"),
  externalMessageId: varchar("externalMessageId", { length: 255 }), // ID retornado pela API
  retryCount: int("retryCount").default(0),
  maxRetries: int("maxRetries").default(3),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIndex: index("idx_queue_client").on(table.clientId),
  receivableIdIndex: index("idx_queue_receivable").on(table.receivableId),
  statusIndex: index("idx_queue_status").on(table.status),
  scheduledForIndex: index("idx_queue_scheduled").on(table.scheduledFor),
  messageTypeIndex: index("idx_queue_type").on(table.messageType),
}));

export type MessageQueue = typeof messageQueue.$inferSelect;
export type InsertMessageQueue = typeof messageQueue.$inferInsert;


/**
 * 🚨 Histórico de Envios (Idempotência Forte)
 * Garante que o mesmo boleto não seja enviado 2x mesmo com processos concorrentes
 * Usa unique index em (receivableId, channel) para bloquear duplicatas
 */
export const dispatches = mysqlTable("dispatches", {
  id: int("id").autoincrement().primaryKey(),
  
  // Referência ao boleto
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  clientId: int("clientId").notNull().references(() => clients.id),
  
  // Canal de envio
  channel: mysqlEnum("channel", ["whatsapp", "email", "sms"]).notNull(),
  
  // Versão do template (para permitir reenvio com template novo)
  templateVersion: int("templateVersion").default(1).notNull(),
  
  // Resultado do envio
  messageId: varchar("messageId", { length: 255 }),
  status: mysqlEnum("status", ["pending", "sent", "failed", "blocked"]).notNull(),
  errorMessage: text("errorMessage"),
  
  // Rastreamento
  sentAt: timestamp("sentAt"),  // nullable - só preencher quando status='sent'
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
}, (table) => ({
  // 🔑 UNIQUE INDEX: Impede envio duplicado do mesmo boleto no mesmo canal
  // Se tentar inserir (receivableId=1, channel='whatsapp') 2x → erro de constraint
  uniqueDispatch: uniqueIndex("idx_unique_dispatch").on(table.receivableId, table.channel),
  
  // Índices para queries
  clientIdIndex: index("idx_dispatch_client").on(table.clientId),
  channelIndex: index("idx_dispatch_channel").on(table.channel),
  statusIndex: index("idx_dispatch_status").on(table.status),
  sentAtIndex: index("idx_dispatch_sent").on(table.sentAt),
}));

export type Dispatch = typeof dispatches.$inferSelect;
export type InsertDispatch = typeof dispatches.$inferInsert;


/**
 * 📊 Auditoria de Envios WhatsApp
 * Registra todos os envios de cobrança via WhatsApp com rastreamento completo
 */
export const whatsappAudit = mysqlTable("whatsappAudit", {
  id: int("id").autoincrement().primaryKey(),
  
  // Referências
  clientId: int("clientId").notNull().references(() => clients.id),
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  
  // Identificador da mensagem (retornado pela API ZapContabil)
  // Para ACK-only: pode ser NULL se API nao retorna ID
  messageId: varchar("messageId", { length: 255 }),
  
  // CorrelationId: ID unico gerado por nos para rastreamento
  // Formato: [#FRAGA:clientId:receivableId:timestamp]
  // Incluido na mensagem de texto para rastreamento manual
  // Nullable para dados legados, unique para novos registros
  correlationId: varchar("correlationId", { length: 100 }).unique(),
  
  // Modo de rastreamento do provider
  // WITH_ID: API retorna messageId real
  // ACK_ONLY: API retorna apenas ACK (status=true), sem ID
  // WEBHOOK: ID vem via webhook/callback
  providerTrackingMode: mysqlEnum("providerTrackingMode", ["WITH_ID", "ACK_ONLY", "NO_ID_ACK", "WEBHOOK"]).default("WITH_ID").notNull(),
  
  // Flag: API confirmou recebimento (ACK)
  providerAck: boolean("providerAck").default(false).notNull(),
  
  // Hash do payload enviado (para idempotencia e auditoria)
  payloadHash: varchar("payloadHash", { length: 64 }),
  
  // URL do provider para status check (se disponivel)
  providerStatusUrl: text("providerStatusUrl"),
  
  // Timestamp do envio
  sentAt: timestamp("sentAt").notNull(),
  
  // Template utilizado
  templateUsed: varchar("templateUsed", { length: 100 }),
  
  // Status do envio
  status: mysqlEnum("status", [
    "sent", // Enviado com sucesso
    "failed", // Falha no envio
    "delivered", // Entregue
    "read", // Lido pelo cliente
    "error", // Erro na API
  ]).default("sent").notNull(),
  
  // Mensagem de erro (se houver)
  errorMessage: text("errorMessage"),
  
  // Dados da mensagem
  phoneNumber: varchar("phoneNumber", { length: 20 }),
  messageContent: text("messageContent"),
  pdfUrl: text("pdfUrl"),
  
  // Timestamp quando o provider confirmou recebimento (ACK)
  providerAckAt: timestamp("providerAckAt"),
  
  // Rastreamento
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIndex: index("idx_audit_client").on(table.clientId),
  receivableIdIndex: index("idx_audit_receivable").on(table.receivableId),
  messageIdIndex: index("idx_audit_message").on(table.messageId),
  correlationIdIndex: index("idx_audit_correlation").on(table.correlationId),
  sentAtIndex: index("idx_audit_sent").on(table.sentAt),
  statusIndex: index("idx_audit_status").on(table.status),
  providerTrackingModeIndex: index("idx_audit_tracking_mode").on(table.providerTrackingMode),
}));

export type WhatsappAudit = typeof whatsappAudit.$inferSelect;
export type InsertWhatsappAudit = typeof whatsappAudit.$inferInsert;


/**
 * Casos jurídicos — controle manual de clientes encaminhados ao jurídico.
 * Workflow: draft → approved → sent_to_legal → closed
 * Constraint: apenas 1 caso ativo (draft/approved/sent_to_legal) por cliente.
 */
export const legalCases = mysqlTable("legal_cases", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  status: mysqlEnum("status", ["draft", "approved", "sent_to_legal", "closed"]).default("draft").notNull(),
  approvedBy: varchar("approvedBy", { length: 255 }),
  approvedAt: timestamp("approvedAt"),
  sentToLegalAt: timestamp("sentToLegalAt"),
  closedAt: timestamp("closedAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIndex: index("idx_legal_client").on(table.clientId),
  statusIndex: index("idx_legal_status").on(table.status),
  clientStatusIndex: index("idx_legal_client_status").on(table.clientId, table.status),
}));
export type LegalCase = typeof legalCases.$inferSelect;
export type InsertLegalCase = typeof legalCases.$inferInsert;


/**
 * Mensagens de entrada do WhatsApp — armazena mensagens recebidas de clientes
 * Usado para rastreamento e auditoria de interações inbound
 */
export const inboundMessages = mysqlTable("inbound_messages", {
  id: int("id").autoincrement().primaryKey(),
  fromPhone: varchar("fromPhone", { length: 20 }).notNull(),
  text: text("text").notNull(),
  messageId: varchar("messageId", { length: 255 }).unique(),
  clientId: int("clientId"), // NULL se cliente não identificado
  processed: boolean("processed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  fromPhoneIndex: index("idx_inbound_phone").on(table.fromPhone),
  clientIdIndex: index("idx_inbound_client").on(table.clientId),
  processedIndex: index("idx_inbound_processed").on(table.processed),
}));
export type InboundMessage = typeof inboundMessages.$inferSelect;
export type InsertInboundMessage = typeof inboundMessages.$inferInsert;

/**
 * Log de interações do assistente IA — auditoria completa de processamento
 * Registra: intenção detectada, query ao BD, resposta gerada, handoff
 */
export const aiAssistantLog = mysqlTable("ai_assistant_log", {
  id: int("id").autoincrement().primaryKey(),
  fromPhone: varchar("fromPhone", { length: 20 }).notNull(),
  clientId: int("clientId"), // NULL se cliente não identificado
  intent: varchar("intent", { length: 50 }).notNull(), // saldo, link, negociar, já_paguei, humano
  dbQueryMeta: text("dbQueryMeta"), // JSON com metadados da query (count, totalDebt, etc)
  response: text("response").notNull(), // Resposta enviada ao cliente
  correlationId: varchar("correlationId", { length: 100 }).unique(),
  handoffToHuman: boolean("handoffToHuman").default(false).notNull(),
  handoffReason: varchar("handoffReason", { length: 255 }), // Motivo do handoff (legal_threat, dispute, etc)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  fromPhoneIndex: index("idx_ai_phone").on(table.fromPhone),
  clientIdIndex: index("idx_ai_client").on(table.clientId),
  intentIndex: index("idx_ai_intent").on(table.intent),
  handoffIndex: index("idx_ai_handoff").on(table.handoffToHuman),
}));
export type AIAssistantLog = typeof aiAssistantLog.$inferSelect;
export type InsertAIAssistantLog = typeof aiAssistantLog.$inferInsert;


/**
 * Log bruto de webhooks recebidos (ZapContábil, etc)
 * Armazena o payload completo para debug e auditoria
 */
export const webhookRawLog = mysqlTable("webhook_raw_log", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 50 }).notNull(), // 'zapcontabil', 'conta-azul', etc
  path: varchar("path", { length: 255 }).notNull(), // '/api/webhook/zap-contabil/messages'
  method: varchar("method", { length: 10 }).default("POST").notNull(), // GET, POST, etc
  headersJson: text("headersJson"), // JSON com headers (sem Authorization)
  bodyJson: text("bodyJson"), // JSON com payload completo
  ip: varchar("ip", { length: 45 }), // IPv4 ou IPv6
  userAgent: text("userAgent"), // User-Agent header
  statusCode: int("statusCode"), // HTTP status da resposta
  responseJson: text("responseJson"), // JSON da resposta enviada
  processingTimeMs: int("processingTimeMs"), // Tempo de processamento em ms
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  providerIndex: index("idx_webhook_provider").on(table.provider),
  createdAtIndex: index("idx_webhook_created").on(table.createdAt),
  pathIndex: index("idx_webhook_path").on(table.path),
}));

export type WebhookRawLog = typeof webhookRawLog.$inferSelect;
export type InsertWebhookRawLog = typeof webhookRawLog.$inferInsert;


/**
 * Follow-up automático para clientes que não responderam após cobrança.
 * Controla ciclo de até 3 tentativas com cooldown e stop automático.
 */
export const noResponseFollowups = mysqlTable("no_response_followups", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  phoneE164: varchar("phoneE164", { length: 20 }).notNull(),
  bucketAtTrigger: varchar("bucketAtTrigger", { length: 5 }).notNull(), // B, C, D
  firstSentAt: timestamp("firstSentAt"), // Timestamp do primeiro envio do ciclo
  attemptCount: int("attemptCount").default(0).notNull(), // 0..3
  nextEligibleAt: timestamp("nextEligibleAt"), // Quando pode enviar próxima tentativa
  lastAttemptAt: timestamp("lastAttemptAt"), // Última tentativa
  status: mysqlEnum("status", ["active", "stopped", "completed"]).default("active").notNull(),
  stopReason: mysqlEnum("stopReason", ["replied", "paid", "optout", "max_attempts", "manual"]),
  metaJson: text("metaJson"), // JSON com metadados extras
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIndex: index("idx_followup_client").on(table.clientId),
  phoneIndex: index("idx_followup_phone").on(table.phoneE164),
  statusNextIndex: index("idx_followup_status_next").on(table.status, table.nextEligibleAt),
}));

export type NoResponseFollowup = typeof noResponseFollowups.$inferSelect;
export type InsertNoResponseFollowup = typeof noResponseFollowups.$inferInsert;


/**
 * Régua de Cobrança — Auditoria de Execuções
 * Registra cada tentativa de envio da régua automática com rastreamento completo.
 * Permite dryRun, dedup por (clientId + receivableId + etapa) e correlationId por execução.
 */
export const reguaAudit = mysqlTable("regua_audit", {
  id: int("id").autoincrement().primaryKey(),

  // Identificador da execução (batch) — mesmo correlationId para todos os registros de uma rodada
  runId: varchar("runId", { length: 64 }).notNull(),

  // Referências
  clientId: int("clientId").notNull(),
  receivableId: int("receivableId").notNull(),

  // Etapa da régua
  stage: mysqlEnum("stage", [
    "d_minus_3",  // D-3: 3 dias antes do vencimento
    "d_0",        // D0: dia do vencimento
    "d_plus_3",   // D+3: 3 dias de atraso
    "d_plus_7",   // D+7: 7 dias de atraso
    "d_plus_15",  // D+15: 15 dias de atraso
    "d_plus_30",  // D+30: 30 dias de atraso
    "d_plus_45",  // D+45: 45 dias de atraso
    "d_plus_60",  // D+60: 60 dias de atraso
    "d_plus_90",  // D+90: 90 dias de atraso
    "d_plus_180", // D+180: 180 dias de atraso
    "d_plus_365", // D+365: 365+ dias de atraso
    "ALL",        // Override para todos os estágios
  ]).notNull(),

  // Modo de execução
  dryRun: boolean("dryRun").default(false).notNull(),

  // Status do registro
  status: mysqlEnum("status", [
    "sent",         // Enviado com sucesso
    "skipped",      // Pulado (dedup, quiet hours, humano ativo, sem dívida, opt-out)
    "error",        // Erro no envio
    "dry_run",      // Simulação (dryRun=true)
    "overridden",   // Dedup marcado como override (não bloqueia próximo envio)
    "override_log", // Log de operação de override manual
  ]).notNull(),

  // Motivo do skip (quando status=skipped)
  skipReason: varchar("skipReason", { length: 100 }),
  // Possíveis valores: DEDUP, QUIET_HOURS, HUMAN_ASSIGNED, NO_DEBT, OPT_OUT, NO_WHATSAPP, TICKET_CLOSED

  // Dados do envio
  phoneE164: varchar("phoneE164", { length: 20 }),
  messageContent: text("messageContent"),
  totalDebt: decimal("totalDebt", { precision: 12, scale: 2 }),
  titlesCount: int("titlesCount"),
  maxDaysOverdue: int("maxDaysOverdue"),

  // Resultado do provider (ZapContábil)
  providerMessageId: varchar("providerMessageId", { length: 255 }),
  providerStatus: varchar("providerStatus", { length: 50 }),
  providerRawResult: text("providerRawResult"), // JSON completo da resposta

  // Erro (quando status=error)
  errorMessage: text("errorMessage"),

  // Rastreamento
  correlationId: varchar("correlationId", { length: 100 }).unique(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  runIdIndex: index("idx_regua_run").on(table.runId),
  clientIdIndex: index("idx_regua_client").on(table.clientId),
  receivableIdIndex: index("idx_regua_receivable").on(table.receivableId),
  stageIndex: index("idx_regua_stage").on(table.stage),
  statusIndex: index("idx_regua_status").on(table.status),
  createdAtIndex: index("idx_regua_created").on(table.createdAt),
  // Índice composto para dedup: (clientId, receivableId, stage)
  dedupIndex: index("idx_regua_dedup").on(table.clientId, table.receivableId, table.stage),
}));

export type ReguaAudit = typeof reguaAudit.$inferSelect;
export type InsertReguaAudit = typeof reguaAudit.$inferInsert;

/**
 * Configurações de alertas automáticos para o gestor
 */
export const alertSettings = mysqlTable("alert_settings", {
  id: int("id").autoincrement().primaryKey(),
  alertType: varchar("alertType", { length: 50 }).notNull(), // 'open_value_threshold' | 'open_value_increase'
  threshold: decimal("threshold", { precision: 12, scale: 2 }).notNull(), // valor ou percentual
  phone: varchar("phone", { length: 30 }).notNull(), // número E.164 do gestor
  enabled: boolean("enabled").default(true).notNull(),
  lastSentAt: timestamp("lastSentAt"), // rate limit: 1 por dia por tipo
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AlertSetting = typeof alertSettings.$inferSelect;
export type InsertAlertSetting = typeof alertSettings.$inferInsert;

/**
 * Auditoria de reconciliação Conta Azul × Banco Local
 * Registra comparações diárias entre totais e detecta divergências
 */
export const reconciliationAudit = mysqlTable("reconciliation_audit", {
  id: int("id").autoincrement().primaryKey(),

  // Identificador da execução
  runId: varchar("runId", { length: 64 }).notNull().unique(),

  // Totais do Conta Azul (janela 365 dias)
  caTotal: decimal("caTotal", { precision: 12, scale: 2 }).notNull(), // Total overdue no CA
  caCount: int("caCount").notNull(), // Quantidade de títulos no CA
  caWindow: varchar("caWindow", { length: 50 }).notNull(), // Janela de busca (ex: "365 dias")

  // Totais do Banco Local (DB)
  dbTotal: decimal("dbTotal", { precision: 12, scale: 2 }).notNull(), // Total overdue no DB
  dbCount: int("dbCount").notNull(), // Quantidade de títulos no DB

  // Análise de divergência
  diffValue: decimal("diffValue", { precision: 12, scale: 2 }).notNull(), // Valor absoluto da diferença
  diffPercent: decimal("diffPercent", { precision: 5, scale: 2 }).notNull(), // Percentual da diferença
  isAlerted: boolean("isAlerted").default(false).notNull(), // Se gerou alerta (diff > 1%)

  // Contadores de problemas
  orphanCount: int("orphanCount").default(0).notNull(), // Títulos no DB mas não no CA
  statusMismatchCount: int("statusMismatchCount").default(0).notNull(), // Títulos com status diferente
  valueMismatchCount: int("valueMismatchCount").default(0).notNull(), // Títulos com valor diferente
  renegotiationCount: int("renegotiationCount").default(0).notNull(), // Títulos marcados como renegociação

  // Detalhes do alerta (se houver)
  alertMessage: text("alertMessage"),
  alertSentAt: timestamp("alertSentAt"),

  // Rastreamento
  startedAt: timestamp("startedAt").notNull(),
  completedAt: timestamp("completedAt"),
  durationMs: int("durationMs"), // Tempo de execução em ms
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  errorMessage: text("errorMessage"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  runIdIndex: index("idx_reconciliation_run").on(table.runId),
  createdAtIndex: index("idx_reconciliation_created").on(table.createdAt),
  statusIndex: index("idx_reconciliation_status").on(table.status),
  isAlertedIndex: index("idx_reconciliation_alerted").on(table.isAlerted),
}));

export type ReconciliationAudit = typeof reconciliationAudit.$inferSelect;
export type InsertReconciliationAudit = typeof reconciliationAudit.$inferInsert;

/**
 * Detecção de títulos órfãos (no DB mas não no CA)
 * Rastreia receivables que desapareceram do Conta Azul
 */
export const orphanReceivables = mysqlTable("orphan_receivables", {
  id: int("id").autoincrement().primaryKey(),

  // Referência do título no DB
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  clientId: int("clientId").notNull().references(() => clients.id),
  contaAzulId: varchar("contaAzulId", { length: 64 }).notNull(), // ID que deveria existir no CA

  // Informações do título
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  dbStatus: varchar("dbStatus", { length: 50 }).notNull(), // Status no DB (pending, overdue, etc)

  // Detecção
  detectedAt: timestamp("detectedAt").notNull(), // Quando foi detectado como órfão
  lastFoundInCA: timestamp("lastFoundInCA"), // Última vez que foi encontrado no CA (null = nunca encontrado)

  // Classificação
  orphanType: mysqlEnum("orphanType", [
    "never_synced", // Nunca foi sincronizado do CA
    "deleted_from_ca", // Existia no CA e foi deletado
    "renegotiated", // Foi renegociado (novo título criado)
    "unknown", // Motivo desconhecido
  ]).default("unknown").notNull(),

  // Ação tomada
  action: mysqlEnum("action", [
    "pending", // Aguardando análise
    "mark_as_cancelled", // Marcado como cancelado
    "investigate", // Requer investigação manual
    "resolved", // Resolvido
  ]).default("pending").notNull(),

  // Notas
  notes: text("notes"),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: varchar("resolvedBy", { length: 255 }), // Email ou ID do admin

  // Rastreamento
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  receivableIdIndex: index("idx_orphan_receivable").on(table.receivableId),
  clientIdIndex: index("idx_orphan_client").on(table.clientId),
  contaAzulIdIndex: index("idx_orphan_conta_azul").on(table.contaAzulId),
  orphanTypeIndex: index("idx_orphan_type").on(table.orphanType),
  actionIndex: index("idx_orphan_action").on(table.action),
  detectedAtIndex: index("idx_orphan_detected").on(table.detectedAt),
}));

export type OrphanReceivable = typeof orphanReceivables.$inferSelect;
export type InsertOrphanReceivable = typeof orphanReceivables.$inferInsert;

/**
 * Histórico de divergências por título
 * Rastreia mudanças de status e valor para cada receivable
 */
export const receivableMismatchHistory = mysqlTable("receivable_mismatch_history", {
  id: int("id").autoincrement().primaryKey(),

  // Referência
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  reconciliationRunId: varchar("reconciliationRunId", { length: 64 }).notNull(),

  // Valores no CA
  caStatus: varchar("caStatus", { length: 50 }),
  caAmount: decimal("caAmount", { precision: 12, scale: 2 }),
  caDueDate: timestamp("caDueDate"),

  // Valores no DB
  dbStatus: varchar("dbStatus", { length: 50 }).notNull(),
  dbAmount: decimal("dbAmount", { precision: 12, scale: 2 }).notNull(),
  dbDueDate: timestamp("dbDueDate").notNull(),

  // Tipo de divergência
  mismatchType: mysqlEnum("mismatchType", [
    "status_changed", // Status diferente
    "amount_changed", // Valor diferente
    "date_changed", // Data de vencimento diferente
    "multiple_changes", // Múltiplas mudanças
  ]).notNull(),

  // Análise
  severity: mysqlEnum("severity", [
    "low", // Divergência menor (ex: centavos)
    "medium", // Divergência moderada
    "high", // Divergência significativa
    "critical", // Divergência crítica
  ]).default("medium").notNull(),

  // Ação
  action: mysqlEnum("action", [
    "pending", // Aguardando análise
    "auto_sync", // Sincronizado automaticamente
    "manual_review", // Requer revisão manual
    "ignored", // Ignorado
  ]).default("pending").notNull(),

  // Notas
  notes: text("notes"),

  // Rastreamento
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  receivableIdIndex: index("idx_mismatch_receivable").on(table.receivableId),
  reconciliationRunIdIndex: index("idx_mismatch_run").on(table.reconciliationRunId),
  mismatchTypeIndex: index("idx_mismatch_type").on(table.mismatchType),
  severityIndex: index("idx_mismatch_severity").on(table.severity),
  createdAtIndex: index("idx_mismatch_created").on(table.createdAt),
}));

export type ReceivableMismatchHistory = typeof receivableMismatchHistory.$inferSelect;
export type InsertReceivableMismatchHistory = typeof receivableMismatchHistory.$inferInsert;

/**
 * Validação em tempo real antes da régua rodar
 * Confirma status no CA para cada cliente elegível
 */
export const preReguaValidation = mysqlTable("pre_regua_validation", {
  id: int("id").autoincrement().primaryKey(),

  // Identificador da execução
  runId: varchar("runId", { length: 64 }).notNull(),

  // Cliente e títulos
  clientId: int("clientId").notNull().references(() => clients.id),
  receivableId: int("receivableId").notNull().references(() => receivables.id),
  contaAzulId: varchar("contaAzulId", { length: 64 }).notNull(),

  // Status no CA (consultado em tempo real)
  caStatus: varchar("caStatus", { length: 50 }).notNull(),
  caAmount: decimal("caAmount", { precision: 12, scale: 2 }).notNull(),

  // Status no DB (antes da validação)
  dbStatus: varchar("dbStatus", { length: 50 }).notNull(),
  dbAmount: decimal("dbAmount", { precision: 12, scale: 2 }).notNull(),

  // Resultado da validação
  isValid: boolean("isValid").notNull(), // true se status e valor coincidem
  validationMessage: text("validationMessage"),

  // Ação tomada
  action: mysqlEnum("action", [
    "proceed", // Prosseguir com envio
    "skip", // Pular este título
    "update_and_proceed", // Atualizar DB e prosseguir
    "cancel_regua", // Cancelar envio da régua
  ]).default("proceed").notNull(),

  // Rastreamento
  validatedAt: timestamp("validatedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  runIdIndex: index("idx_pre_regua_run").on(table.runId),
  clientIdIndex: index("idx_pre_regua_client").on(table.clientId),
  receivableIdIndex: index("idx_pre_regua_receivable").on(table.receivableId),
  isValidIndex: index("idx_pre_regua_valid").on(table.isValid),
  validatedAtIndex: index("idx_pre_regua_validated").on(table.validatedAt),
}));

export type PreReguaValidation = typeof preReguaValidation.$inferSelect;
export type InsertPreReguaValidation = typeof preReguaValidation.$inferInsert;


/**
 * Cursor de sincronização incremental
 * Armazena o timestamp da última sincronização bem-sucedida
 * para buscar apenas títulos alterados desde então
 */
export const syncCursor = mysqlTable("sync_cursor", {
  id: int("id").autoincrement().primaryKey(),
  // Tipo de sincronização
  syncType: mysqlEnum("syncType", [
    "payments_lite", // Sincronização incremental de pagamentos (últimas 24h)
    "payments_full", // Sincronização completa de pagamentos (365 dias)
    "receivables_lite", // Sincronização incremental de títulos
    "receivables_full", // Sincronização completa de títulos
  ]).notNull(),
  // Último timestamp de sincronização bem-sucedida
  lastSyncAt: timestamp("lastSyncAt").notNull(),
  // Próximo timestamp esperado (para evitar gaps)
  nextSyncAt: timestamp("nextSyncAt"),
  // Status da última sincronização
  lastStatus: mysqlEnum("lastStatus", ["success", "partial", "failed"]).default("success").notNull(),
  // Detalhes da última execução
  lastResult: text("lastResult"), // JSON com { checkedLocal, resolvedCount, updatedCount, error }
  // Controle
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  syncTypeIndex: index("idx_sync_cursor_type").on(table.syncType),
  lastSyncIndex: index("idx_sync_cursor_last").on(table.lastSyncAt),
}));

export type SyncCursor = typeof syncCursor.$inferSelect;
export type InsertSyncCursor = typeof syncCursor.$inferInsert;


// ============================================================
// eKontrol + Precificação de Honorários
// ============================================================

/**
 * Empresas sincronizadas do eKontrol (listar_empresas).
 * Cada empresa pode ser vinculada a um client do Conta Azul via CNPJ.
 */
export const ekontrolCompanies = mysqlTable("ekontrol_companies", {
  id: int("id").autoincrement().primaryKey(),
  codiEmp: int("codi_emp").notNull(), // código no eKontrol
  inscricaoFederal: varchar("inscricao_federal", { length: 20 }).notNull(),
  razaoSocial: varchar("razao_social", { length: 300 }).notNull(),
  statusEmpresa: varchar("status_empresa", { length: 2 }).notNull(), // A, B, I, M, C
  segmento: varchar("segmento", { length: 10 }), // I, C, S
  cnaePrincipal: varchar("cnae_principal", { length: 20 }),
  cnaeSecundario: text("cnae_secundario"),
  regimeTributario: varchar("regime_tributario", { length: 60 }).notNull(),
  honorariosAtual: decimal("honorarios_atual", { precision: 12, scale: 2 }),
  competenciaReajuste: varchar("competencia_reajuste", { length: 10 }),
  arrayHonorarios: text("array_honorarios"), // JSON do histórico de contratos
  responsavel: varchar("responsavel", { length: 200 }),
  emailResponsavel: varchar("email_responsavel", { length: 320 }),
  apiKeyCliente: varchar("api_key_cliente", { length: 100 }), // para buscar dados individuais
  usafolha: boolean("usafolha").default(false),
  usafiscal: boolean("usafiscal").default(false),
  usacontabil: boolean("usacontabil").default(false),
  honorariosFonte: varchar("honorarios_fonte", { length: 50 }), // ekontrol, receivables_recorrentes, manual
  // Vínculo com tabela clients (Conta Azul)
  clientId: int("client_id"), // FK para clients.id (match por CNPJ)
  // Controle
  lastSyncAt: timestamp("last_sync_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  cnpjIdx: uniqueIndex("idx_ek_company_cnpj").on(table.inscricaoFederal),
  codiEmpIdx: index("idx_ek_company_codi").on(table.codiEmp),
  clientIdIdx: index("idx_ek_company_client").on(table.clientId),
}));
export type EkontrolCompany = typeof ekontrolCompanies.$inferSelect;

/**
 * Métricas mensais por empresa (faturamento, funcionários, notas).
 * Populado via API eKontrol (endpoints 3.03, 3.05, 4.01) quando api_key_cliente disponível,
 * ou via dados do banco (receivables, etc.) quando não disponível.
 */
export const ekontrolMetricsMonthly = mysqlTable("ekontrol_metrics_monthly", {
  id: int("id").autoincrement().primaryKey(),
  ekCompanyId: int("ek_company_id").notNull(), // FK para ekontrol_companies.id
  competencia: varchar("competencia", { length: 7 }).notNull(), // yyyy-MM
  // Faturamento
  faturamentoTotal: decimal("faturamento_total", { precision: 14, scale: 2 }),
  // Pessoal
  funcionarios: int("funcionarios"),
  admissoes: int("admissoes"),
  demissoes: int("demissoes"),
  // Fiscal
  notasEmitidas: int("notas_emitidas"),
  lancamentos: int("lancamentos"),
  // Fonte dos dados
  fonte: mysqlEnum("fonte", ["ekontrol_api", "conta_azul", "manual"]).default("conta_azul").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyCompIdx: uniqueIndex("idx_ek_metrics_company_comp").on(table.ekCompanyId, table.competencia),
}));
export type EkontrolMetric = typeof ekontrolMetricsMonthly.$inferSelect;

/**
 * Precificação atual de cada empresa (fee atual vs fee sugerido).
 * Uma linha por empresa, atualizada pelo motor de precificação.
 */
export const pricingCurrent = mysqlTable("pricing_current", {
  id: int("id").autoincrement().primaryKey(),
  ekCompanyId: int("ek_company_id").notNull(), // FK para ekontrol_companies.id
  // Fee atual (do eKontrol ou manual)
  feeAtual: decimal("fee_atual", { precision: 12, scale: 2 }),
  // Fee sugerido (calculado pelo motor)
  feeSugerido: decimal("fee_sugerido", { precision: 12, scale: 2 }),
  // Componentes do cálculo
  feeBase: decimal("fee_base", { precision: 12, scale: 2 }),
  feeFuncionarios: decimal("fee_funcionarios", { precision: 12, scale: 2 }),
  feeFaturamento: decimal("fee_faturamento", { precision: 12, scale: 2 }),
  feeComplexidade: decimal("fee_complexidade", { precision: 12, scale: 2 }),
  // Score de complexidade
  complexityScore: int("complexity_score").default(0),
  complexityDetails: text("complexity_details"), // JSON com breakdown do score
  // Defasagem
  isDefasado: boolean("is_defasado").default(false),
  defasagemReason: text("defasagem_reason"), // JSON com motivos
  defasagemDetectedAt: timestamp("defasagem_detected_at"),
  // Snooze
  snoozedUntil: timestamp("snoozed_until"),
  // Último reajuste
  lastReajusteAt: timestamp("last_reajuste_at"),
  // Precificação manual (acima do teto)
  isPrecificacaoManual: boolean("is_precificacao_manual").default(false),
  // Controle
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ekCompanyIdx: uniqueIndex("idx_pricing_ek_company").on(table.ekCompanyId),
  defasadoIdx: index("idx_pricing_defasado").on(table.isDefasado),
}));
export type PricingCurrent = typeof pricingCurrent.$inferSelect;

/**
 * Sugestões de reajuste geradas pelo motor de precificação.
 * Cada sugestão pode ser: pending, applied, dismissed, snoozed.
 */
export const pricingSuggestions = mysqlTable("pricing_suggestions", {
  id: int("id").autoincrement().primaryKey(),
  ekCompanyId: int("ek_company_id").notNull(),
  // Valores
  feeAnterior: decimal("fee_anterior", { precision: 12, scale: 2 }),
  feeSugerido: decimal("fee_sugerido", { precision: 12, scale: 2 }),
  // Motivo da sugestão
  reason: text("reason").notNull(), // JSON com motivos detalhados
  // Status
  status: mysqlEnum("status", ["pending", "applied", "dismissed", "snoozed"]).default("pending").notNull(),
  // Ação
  appliedAt: timestamp("applied_at"),
  appliedBy: varchar("applied_by", { length: 100 }),
  feeAplicado: decimal("fee_aplicado", { precision: 12, scale: 2 }), // valor efetivamente aplicado (pode diferir do sugerido)
  snoozedUntil: timestamp("snoozed_until"),
  dismissedReason: text("dismissed_reason"),
  // Controle
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ekCompanyIdx: index("idx_suggestion_ek_company").on(table.ekCompanyId),
  statusIdx: index("idx_suggestion_status").on(table.status),
}));
export type PricingSuggestion = typeof pricingSuggestions.$inferSelect;

/**
 * Auditoria de todas as ações de precificação.
 */
export const pricingAudit = mysqlTable("pricing_audit", {
  id: int("id").autoincrement().primaryKey(),
  ekCompanyId: int("ek_company_id").notNull(),
  action: mysqlEnum("action", [
    "fee_calculated",
    "defasagem_detected",
    "reajuste_suggested",
    "reajuste_applied",
    "reajuste_dismissed",
    "snooze_set",
    "manual_override",
    "ekontrol_synced",
  ]).notNull(),
  details: text("details"), // JSON com detalhes da ação
  performedBy: varchar("performed_by", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ekCompanyIdx: index("idx_pricing_audit_company").on(table.ekCompanyId),
  actionIdx: index("idx_pricing_audit_action").on(table.action),
  createdAtIdx: index("idx_pricing_audit_created").on(table.createdAt),
}));
export type PricingAudit = typeof pricingAudit.$inferSelect;

// ============================================================
// Estado persistente do Cron de Cobrança (CronWatchdog)
// ============================================================
/**
 * Persiste o estado do cron de cobrança no banco de dados.
 * Sobrevive a hibernações do sandbox onde variáveis em memória são zeradas.
 * Chave única: cronKey (ex: "collection_daily")
 */
export const cronState = mysqlTable("cron_state", {
  id: int("id").autoincrement().primaryKey(),
  // Identificador único do cron
  cronKey: varchar("cronKey", { length: 64 }).notNull().unique(),
  // Última execução bem-sucedida (UTC)
  lastRunAt: timestamp("lastRunAt"),
  // Resultado da última execução (JSON)
  lastResult: text("lastResult"), // JSON { totalSent, totalSkipped, totalFailed, bucketBreakdown }
  // Status da última execução
  lastStatus: mysqlEnum("lastStatus", ["success", "partial", "failed", "skipped"]),
  // Controle
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  cronKeyIdx: uniqueIndex("idx_cron_state_key").on(table.cronKey),
  lastRunIdx: index("idx_cron_state_last_run").on(table.lastRunAt),
}));
export type CronState = typeof cronState.$inferSelect;
export type InsertCronState = typeof cronState.$inferInsert;

// ============================================================
// Módulo: Certificados Digitais A1
// ============================================================

export const certificates = mysqlTable("certificates", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("company_id"),
  cnpj: varchar("cnpj", { length: 20 }).notNull(),
  companyName: varchar("company_name", { length: 255 }),
  filePath: varchar("file_path", { length: 512 }),
  fileName: varchar("file_name", { length: 255 }),
  fileHash: varchar("file_hash", { length: 64 }),
  serialNumber: varchar("serial_number", { length: 128 }),
  issuer: varchar("issuer", { length: 512 }),
  subject: varchar("subject", { length: 512 }),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  status: mysqlEnum("status", ["valid", "expiring_30", "expiring_15", "expiring_7", "expired", "invalid", "unknown"]).default("unknown").notNull(),
  source: mysqlEnum("source", ["scanner", "upload", "manual"]).default("scanner").notNull(),
  version: int("version").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastCheckedAt: timestamp("last_checked_at"),
  uploadedByUserId: int("uploaded_by_user_id"),
  notes: text("notes"),
  /** Conteúdo binário do arquivo PFX/P12 — persiste no banco para sobreviver a deploys */
  pfxData: mediumblob("pfx_data"),
  /** Status de envio ao SIEG: pending | sent | error | skipped */
  siegStatus: varchar("sieg_status", { length: 20 }).default("pending"),
  /** ID do certificado retornado pela API SIEG após cadastro */
  siegId: varchar("sieg_id", { length: 100 }),
  /** Timestamp UTC do último envio ao SIEG */
  siegSentAt: timestamp("sieg_sent_at"),
  /** Mensagem de erro do último envio ao SIEG */
  siegError: varchar("sieg_error", { length: 255 }),
  // ─── Campos de reconciliação SIEG ─────────────────────────────────────────
  /** Se o certificado está ativo no painel remoto do SIEG */
  siegRemoteActive: boolean("sieg_remote_active"),
  /** Data de expiração reportada pelo SIEG remoto */
  siegRemoteExpiry: timestamp("sieg_remote_expiry"),
  /** Status textual retornado pelo SIEG (ex: 'Ativo', 'Inativo', 'Deletado') */
  siegRemoteStatus: varchar("sieg_remote_status", { length: 50 }),
  /** Timestamp da última reconciliação com SIEG */
  siegSyncedAt: timestamp("sieg_synced_at"),
  /** Origem do registro: local (arquivo PFX) | sieg_remote (criado pela reconciliação) | reconciled (ambos) */
  siegSource: mysqlEnum("sieg_source", ["local", "sieg_remote", "reconciled"]),
  /** Classificação visual: local_ok | sieg_only | local_only | divergent */
  siegReconStatus: varchar("sieg_recon_status", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  cnpjIdx: index("idx_cert_cnpj").on(table.cnpj),
  statusIdx: index("idx_cert_status").on(table.status),
  validToIdx: index("idx_cert_valid_to").on(table.validTo),
  isActiveIdx: index("idx_cert_is_active").on(table.isActive),
}));
export type Certificate = typeof certificates.$inferSelect;
export type InsertCertificate = typeof certificates.$inferInsert;

export const certificateSecrets = mysqlTable("certificate_secrets", {
  id: int("id").autoincrement().primaryKey(),
  certificateId: int("certificate_id").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  certIdIdx: uniqueIndex("idx_cert_secret_cert_id").on(table.certificateId),
}));
export type CertificateSecret = typeof certificateSecrets.$inferSelect;

// ============================================================
// Módulo: Status de Integrações Fiscais (SIEG / Domínio)
// ============================================================

export const integrationStatus = mysqlTable("integration_status", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("company_id"),
  cnpj: varchar("cnpj", { length: 20 }).notNull(),
  companyName: varchar("company_name", { length: 255 }),
  // SIEG
  siegStatus: mysqlEnum("sieg_status", ["active", "inactive", "error", "unknown"]).default("unknown"),
  siegCertificateId: int("sieg_certificate_id"),
  siegLastCheckAt: timestamp("sieg_last_check_at"),
  siegNotes: text("sieg_notes"),
  // Domínio
  dominioStatus: mysqlEnum("dominio_status", ["active", "inactive", "error", "unknown"]).default("unknown"),
  dominioLastCheckAt: timestamp("dominio_last_check_at"),
  dominioNotes: text("dominio_notes"),
  // Divergências
  hasDivergence: boolean("has_divergence").default(false),
  divergenceDetails: text("divergence_details"),
  // Controle manual
  manualNotes: text("manual_notes"),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: int("resolved_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  cnpjIdx: uniqueIndex("idx_integration_cnpj").on(table.cnpj),
  siegStatusIdx: index("idx_integration_sieg_status").on(table.siegStatus),
  dominioStatusIdx: index("idx_integration_dominio_status").on(table.dominioStatus),
}));
export type IntegrationStatus = typeof integrationStatus.$inferSelect;
export type InsertIntegrationStatus = typeof integrationStatus.$inferInsert;


// ============================================================
// Módulo: Integração ZapContábil - Atendimentos e NFS-e
// ============================================================

/**
 * Atendimentos do ZapContábil
 * Armazena tickets/atendimentos sincronizados do ZapContábil
 */
export const zapcontabilTickets = mysqlTable("zapcontabil_tickets", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: varchar("ticket_id", { length: 64 }).notNull().unique(), // ID do ticket no ZapContábil
  clientId: int("client_id"), // Referência ao cliente (se houver)
  phoneE164: varchar("phone_e164", { length: 20 }).notNull(), // Telefone do cliente
  clientName: varchar("client_name", { length: 255 }), // Nome do cliente
  clientDocument: varchar("client_document", { length: 20 }), // CPF/CNPJ do cliente
  currentSector: varchar("current_sector", { length: 100 }), // Setor atual do atendimento
  previousSector: varchar("previous_sector", { length: 100 }), // Setor anterior
  subject: text("subject"), // Assunto do atendimento
  description: text("description"), // Descrição/histórico
  // Dados para emissão de NFS-e
  serviceDescription: text("service_description"), // Descrição do serviço
  serviceValue: decimal("service_value", { precision: 12, scale: 2 }), // Valor do serviço
  emitterCompanyId: int("emitter_company_id"), // Empresa emissora
  emitterCnpj: varchar("emitter_cnpj", { length: 20 }), // CNPJ da empresa emissora
  // Status
  status: mysqlEnum("status", ["open", "in_progress", "pending_data", "nfse_emitted", "closed", "error"]).default("open").notNull(),
  nfseEmissionId: int("nfse_emission_id"), // Referência à emissão de NFS-e
  lastErrorMessage: text("last_error_message"), // Última mensagem de erro
  // Webhook
  lastWebhookAt: timestamp("last_webhook_at"), // Último webhook recebido
  webhookPayload: text("webhook_payload"), // JSON do último webhook
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ticketIdIdx: uniqueIndex("idx_zapcontabil_ticket_id").on(table.ticketId),
  phoneIdx: index("idx_zapcontabil_phone").on(table.phoneE164),
  sectorIdx: index("idx_zapcontabil_sector").on(table.currentSector),
  statusIdx: index("idx_zapcontabil_status").on(table.status),
}));
export type ZapcontabilTicket = typeof zapcontabilTickets.$inferSelect;
export type InsertZapcontabilTicket = typeof zapcontabilTickets.$inferInsert;

/**
 * Emissões de NFS-e
 * Armazena todas as emissões de notas fiscais de serviço
 */
export const nfseEmissions = mysqlTable("nfse_emissions", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticket_id"), // Referência ao ticket do ZapContábil
  emitterCompanyId: int("emitter_company_id").notNull(), // Empresa emissora
  emitterCnpj: varchar("emitter_cnpj", { length: 20 }).notNull(), // CNPJ da empresa emissora
  // Dados do tomador (cliente)
  takerName: varchar("taker_name", { length: 255 }).notNull(), // Nome do tomador
  takerDocument: varchar("taker_document", { length: 20 }).notNull(), // CPF/CNPJ do tomador
  takerEmail: varchar("taker_email", { length: 320 }), // Email do tomador
  takerPhone: varchar("taker_phone", { length: 20 }), // Telefone do tomador
  // Dados da nota fiscal
  serviceDescription: text("service_description").notNull(), // Descrição do serviço
  serviceValue: decimal("service_value", { precision: 12, scale: 2 }).notNull(), // Valor do serviço
  deductionValue: decimal("deduction_value", { precision: 12, scale: 2 }).default("0"), // Valor de dedução
  netValue: decimal("net_value", { precision: 12, scale: 2 }), // Valor líquido
  issueDate: timestamp("issue_date"), // Data de emissão
  // Resultado da emissão
  status: mysqlEnum("status", ["pending", "processing", "emitted", "error", "cancelled"]).default("pending").notNull(),
  nfseNumber: varchar("nfse_number", { length: 20 }), // Número da NFS-e emitida
  nfseKey: varchar("nfse_key", { length: 50 }), // Chave de acesso da NFS-e
  nfsePdfUrl: text("nfse_pdf_url"), // URL do PDF da NFS-e
  nfseXmlUrl: text("nfse_xml_url"), // URL do XML da NFS-e
  // Rastreamento
  emissionAttempts: int("emission_attempts").default(0), // Número de tentativas
  lastAttemptAt: timestamp("last_attempt_at"), // Última tentativa
  lastErrorMessage: text("last_error_message"), // Última mensagem de erro
  emittedAt: timestamp("emitted_at"), // Quando foi emitida com sucesso
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ticketIdIdx: index("idx_nfse_ticket_id").on(table.ticketId),
  emitterIdx: index("idx_nfse_emitter").on(table.emitterCnpj),
  takerIdx: index("idx_nfse_taker").on(table.takerDocument),
  statusIdx: index("idx_nfse_status").on(table.status),
  nfseNumberIdx: index("idx_nfse_number").on(table.nfseNumber),
}));
export type NfseEmission = typeof nfseEmissions.$inferSelect;
export type InsertNfseEmission = typeof nfseEmissions.$inferInsert;
