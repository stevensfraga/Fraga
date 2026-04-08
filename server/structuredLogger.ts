/**
 * 📝 Structured Logger
 * Logger com traceId, campos fixos e prefixos padronizados
 */

export interface LogContext {
  traceId: string;
  clientId?: number;
  receivableId?: number;
  step?: 'probe' | 'tenant-check' | 'pessoas' | 'selectReceivable' | 'pdf' | 'zapSend' | 'audit' | 'bootstrap' | 'idempotency' | 'e2e' | 'finish' | 'unknown';
  provider?: 'contaazul' | 'zapcontabil' | 'storage' | 'db' | 'r2' | 'system';
  url?: string;
  status?: string | number;
  latencyMs?: number;
  idempotencyKey?: string;
  strategyUsed?: string;
  baseUrlEffective?: string;
  source?: 'cache' | 'probe' | 'api';
  stepFailed?: string;
  errorCode?: string;
  errorMessage?: string;
  providerResponseBody?: string;
  providerResponseHeaders?: string;
  fullUrl?: string;
  authMode?: string;
  requestId?: string;
  cfRay?: string;
  contentType?: string;
  bodyPreview?: string;
  responseStatus?: number;
  responseData?: any;
}

export interface LogEntry {
  timestamp: string;
  traceId: string;
  prefix: string;
  message: string;
  context: Partial<LogContext>;
}

const PREFIX_MAP: Record<string, string> = {
  probe: '[ContaAzulProbe]',
  'tenant-check': '[ContaAzulTenantCheck]',
  pessoas: '[ContaAzulPessoas]',
  selectReceivable: '[SelectReceivable]',
  pdf: '[PDFDownload]',
  zapSend: '[ZapContabilSend]',
  audit: '[WhatsAppAudit]',
  bootstrap: '[Bootstrap]',
  unknown: '[E2E]',
};

/**
 * Logger estruturado
 */
export class StructuredLogger {
  private context: LogContext;
  private logs: LogEntry[] = [];

  constructor(context: LogContext) {
    this.context = context;
  }

  /**
   * Log com contexto estruturado
   */
  log(message: string, overrides?: Partial<LogContext>) {
    const mergedContext = { ...this.context, ...overrides };
    const prefix = PREFIX_MAP[mergedContext.step || 'unknown'] || '[E2E]';
    const timestamp = new Date().toISOString();

    // Construir mensagem com campos fixos
    const fields: string[] = [];

    if (mergedContext.traceId) fields.push(`traceId=${mergedContext.traceId}`);
    if (mergedContext.clientId) fields.push(`clientId=${mergedContext.clientId}`);
    if (mergedContext.receivableId) fields.push(`receivableId=${mergedContext.receivableId}`);
    if (mergedContext.step) fields.push(`step=${mergedContext.step}`);
    if (mergedContext.provider) fields.push(`provider=${mergedContext.provider}`);
    if (mergedContext.url) fields.push(`url=${mergedContext.url}`);
    if (mergedContext.status !== undefined) fields.push(`status=${mergedContext.status}`);
    if (mergedContext.latencyMs !== undefined) fields.push(`latencyMs=${mergedContext.latencyMs}`);
    if (mergedContext.idempotencyKey) fields.push(`idempotencyKey=${mergedContext.idempotencyKey}`);
    if (mergedContext.strategyUsed) fields.push(`strategyUsed=${mergedContext.strategyUsed}`);
    if (mergedContext.baseUrlEffective) fields.push(`baseUrl=${mergedContext.baseUrlEffective}`);
    if (mergedContext.source) fields.push(`source=${mergedContext.source}`);

    const fullMessage = fields.length > 0 ? `${message} (${fields.join(', ')})` : message;

    const entry: LogEntry = {
      timestamp,
      traceId: mergedContext.traceId,
      prefix,
      message: fullMessage,
      context: mergedContext,
    };

    this.logs.push(entry);

    // Console log
    console.log(`${prefix} ${fullMessage}`);
  }

  /**
   * Log de erro
   */
  error(message: string, error?: any, overrides?: Partial<LogContext>) {
    const errorMsg = error?.message || error || message;
    this.log(`ERROR: ${errorMsg}`, overrides);
  }

  /**
   * Log de sucesso
   */
  success(message: string, overrides?: Partial<LogContext>) {
    this.log(`✓ ${message}`, overrides);
  }

  /**
   * Log de aviso
   */
  warn(message: string, overrides?: Partial<LogContext>) {
    this.log(`WARN: ${message}`, overrides);
  }

  /**
   * Obter todos os logs
   */
  getLogs(): LogEntry[] {
    return this.logs;
  }

  /**
   * Obter logs como string (para resposta HTTP)
   */
  getLogsAsString(): string {
    return this.logs.map((entry) => `${entry.timestamp} ${entry.prefix} ${entry.message}`).join('\n');
  }

  /**
   * Filtrar logs por traceId
   */
  static filterByTraceId(logs: LogEntry[], traceId: string): LogEntry[] {
    return logs.filter((log) => log.traceId === traceId);
  }

  /**
   * Filtrar logs por step
   */
  static filterByStep(logs: LogEntry[], step: string): LogEntry[] {
    return logs.filter((log) => log.context.step === step);
  }

  /**
   * Filtrar logs por provider
   */
  static filterByProvider(logs: LogEntry[], provider: string): LogEntry[] {
    return logs.filter((log) => log.context.provider === provider);
  }
}

/**
 * Criar logger com contexto inicial
 */
export function createLogger(traceId: string, clientId?: number, receivableId?: number): StructuredLogger {
  return new StructuredLogger({
    traceId,
    clientId,
    receivableId,
  });
}
