import { mysqlTable, varchar, text, timestamp, int, boolean, json } from 'drizzle-orm/mysql-core';

export const nfseEmissionLogs = mysqlTable('nfse_emission_logs', {
  id: int('id').primaryKey().autoincrement(),
  cnpj: varchar('cnpj', { length: 20 }).notNull(),
  companyName: varchar('company_name', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull(), // 'pending', 'in_progress', 'success', 'error'
  nfseNumber: varchar('nfse_number', { length: 50 }),
  nfseUrl: text('nfse_url'),
  
  // Detalhes da nota
  serviceDescription: text('service_description'),
  serviceValue: varchar('service_value', { length: 20 }),
  clientName: varchar('client_name', { length: 255 }),
  clientCnpj: varchar('client_cnpj', { length: 20 }),
  
  // Logs detalhados
  logs: json('logs').$type<Array<{
    timestamp: string;
    step: string;
    message: string;
    details?: Record<string, any>;
  }>>().default([]),
  
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  
  // Metadados
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  durationMs: int('duration_ms'),
  
  // Rastreamento
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export type NfseEmissionLog = typeof nfseEmissionLogs.$inferSelect;
export type NfseEmissionLogInsert = typeof nfseEmissionLogs.$inferInsert;
