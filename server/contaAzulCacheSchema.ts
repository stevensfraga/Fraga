/**
 * 🗄️ Conta Azul Cache Schema
 * Tabelas para cache de probe/tenant-check e auditoria estendida
 */

import { mysqlTable, int, varchar, text, timestamp, index, decimal } from 'drizzle-orm/mysql-core';

/**
 * Cache de probe/tenant-check por clientId
 * TTL: 6 horas
 */
export const contaAzulCache = mysqlTable('contaAzulCache', {
  id: int('id').autoincrement().primaryKey(),
  
  // Referência ao cliente
  clientId: int('clientId').notNull(),
  
  // Dados do cache
  baseUrlEffective: varchar('baseUrlEffective', { length: 255 }).notNull(),
  strategyUsed: varchar('strategyUsed', { length: 100 }).notNull(),
  identifiers: text('identifiers'), // JSON: { empresaId, tenant, accountId, organizacaoId }
  
  // Controle de cache
  cachedAt: timestamp('cachedAt').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  
  // Timestamps
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIdx: index('idx_cache_client').on(table.clientId),
  expiresAtIdx: index('idx_cache_expires').on(table.expiresAt),
}));

export type ContaAzulCache = typeof contaAzulCache.$inferSelect;
export type InsertContaAzulCache = typeof contaAzulCache.$inferInsert;

/**
 * Auditoria estendida de envios WhatsApp
 * Rastreia idempotência, latências, erros detalhados
 */
export const whatsappAuditExtended = mysqlTable('whatsappAuditExtended', {
  id: int('id').autoincrement().primaryKey(),
  
  // Referências
  clientId: int('clientId').notNull(),
  receivableId: int('receivableId').notNull(),
  
  // Identificadores únicos
  traceId: varchar('traceId', { length: 64 }).notNull().unique(), // UUID por request
  idempotencyKey: varchar('idempotencyKey', { length: 255 }).notNull(), // clientId+receivableId+template+dueDate
  
  // Mensagem
  messageId: varchar('messageId', { length: 255 }),
  
  // Status
  status: varchar('status', { length: 20 }).notNull(), // sent, failed, queued, error
  
  // Detalhes de erro
  stepFailed: varchar('stepFailed', { length: 100 }), // probe, tenant-check, pessoas, bootstrap, pdf, whatsapp, audit
  errorCode: varchar('errorCode', { length: 50 }),
  errorMessage: text('errorMessage'),
  
  // Latências (ms)
  probeLatencyMs: int('probeLatencyMs'),
  tenantCheckLatencyMs: int('tenantCheckLatencyMs'),
  pessoasLatencyMs: int('pessoasLatencyMs'),
  bootstrapLatencyMs: int('bootstrapLatencyMs'),
  pdfLatencyMs: int('pdfLatencyMs'),
  whatsappLatencyMs: int('whatsappLatencyMs'),
  totalLatencyMs: int('totalLatencyMs'),
  
  // Dados do envio
  phoneNumber: varchar('phoneNumber', { length: 20 }),
  messageContent: text('messageContent'),
  pdfUrl: text('pdfUrl'),
  
  // Provider info
  provider: varchar('provider', { length: 50 }), // zapcontabil, twilio, etc
  strategyUsed: varchar('strategyUsed', { length: 100 }), // probe strategy
  baseUrlEffective: varchar('baseUrlEffective', { length: 255 }),
  
  // Timestamps
  sentAt: timestamp('sentAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  clientIdIdx: index('idx_audit_ext_client').on(table.clientId),
  receivableIdIdx: index('idx_audit_ext_receivable').on(table.receivableId),
  traceIdIdx: index('idx_audit_ext_trace').on(table.traceId),
  idempotencyKeyIdx: index('idx_audit_ext_idempotency').on(table.idempotencyKey),
  statusIdx: index('idx_audit_ext_status').on(table.status),
  sentAtIdx: index('idx_audit_ext_sent').on(table.sentAt),
}));

export type WhatsappAuditExtended = typeof whatsappAuditExtended.$inferSelect;
export type InsertWhatsappAuditExtended = typeof whatsappAuditExtended.$inferInsert;

/**
 * Estatísticas de envio por período (agregadas)
 * Atualizado a cada envio para performance de queries
 */
export const whatsappSendStats = mysqlTable('whatsappSendStats', {
  id: int('id').autoincrement().primaryKey(),
  
  // Período
  date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD
  
  // Contadores
  totalSent: int('totalSent').default(0),
  totalFailed: int('totalFailed').default(0),
  totalQueued: int('totalQueued').default(0),
  
  // Latências médias (ms)
  avgProbeLatency: decimal('avgProbeLatency', { precision: 10, scale: 2 }),
  avgTenantLatency: decimal('avgTenantLatency', { precision: 10, scale: 2 }),
  avgPessoasLatency: decimal('avgPessoasLatency', { precision: 10, scale: 2 }),
  avgWhatsappLatency: decimal('avgWhatsappLatency', { precision: 10, scale: 2 }),
  avgTotalLatency: decimal('avgTotalLatency', { precision: 10, scale: 2 }),
  
  // Timestamps
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dateIdx: index('idx_stats_date').on(table.date),
}));

export type WhatsappSendStats = typeof whatsappSendStats.$inferSelect;
export type InsertWhatsappSendStats = typeof whatsappSendStats.$inferInsert;
