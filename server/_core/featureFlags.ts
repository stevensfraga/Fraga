/**
 * Feature Flags para controlar comportamento em produção
 * Todos os flags têm valores padrão seguros (disabled)
 */

export const FEATURE_FLAGS = {
  /**
   * Ativar processamento automático de mensagens inbound via IA
   * Default: false (apenas log e debug)
   * Quando true: aciona handleInboundMessage() após receber webhook
   */
  INBOUND_AI_ENABLED: process.env.INBOUND_AI_ENABLED === 'true',

  /**
   * Permitir envio real de mensagens WhatsApp via ZapContábil
   * Default: false (modo teste/debug apenas)
   * Quando true: sendWhatsAppReply() envia de verdade
   */
  ALLOW_REAL_SEND: process.env.ALLOW_REAL_SEND === 'true',

  /**
   * Ativar cron jobs de cobrança automática
   * Default: false (modo manual/debug)
   * Quando true: cronScheduler inicia automaticamente
   */
  ALLOW_CRON_ENABLE: process.env.ALLOW_CRON_ENABLE === 'true',

  /**
   * Ativar dispatch em produção (envio de mensagens em batch)
   * Default: false
   * Quando true: dispatchWorker processa fila
   */
  DISPATCH_PROD_ONLY: process.env.DISPATCH_PROD_ONLY === 'true',

  /**
   * Ativar follow-up automático para clientes que não responderam
   * Default: false (ligar só depois do dry-run)
   * Quando true: runNoResponseFollowup() é executado no cron
   */
  FOLLOWUP_ENABLED: process.env.FOLLOWUP_ENABLED === 'true',

  /**
   * Kill switch global para desabilitar tudo em emergência
   * Default: false
   * Quando true: todos os envios são bloqueados
   */
  KILL_SWITCH: process.env.KILL_SWITCH === 'true',
};

// ─── WHITELIST IA INBOUND ─────────────────────────────────────────────────────

/**
 * Whitelist de telefones autorizados para IA inbound
 * 
 * Formato: lista de E.164 separados por vírgula
 * Ex: WHATSAPP_AI_WHITELIST=+5527981657804,+5511999999999
 * 
 * Se vazio ou não definido: NENHUM número é autorizado (segurança)
 * Se "*": TODOS os números são autorizados (produção aberta)
 */
function parseWhitelist(): Set<string> {
  const raw = process.env.WHATSAPP_AI_WHITELIST || '';
  if (!raw.trim()) return new Set();
  
  return new Set(
    raw
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  );
}

const AI_WHITELIST = parseWhitelist();

/**
 * Verificar se um telefone está na whitelist da IA
 * 
 * @param phoneE164 - Telefone em formato E.164 (ex: +5527981657804)
 * @returns true se autorizado, false se não
 */
export function isPhoneWhitelisted(phoneE164: string): boolean {
  // Se whitelist contém "*", todos são autorizados
  if (AI_WHITELIST.has('*')) return true;
  
  // Se whitelist vazia, ninguém é autorizado
  if (AI_WHITELIST.size === 0) return false;
  
  // Verificar match exato
  if (AI_WHITELIST.has(phoneE164)) return true;
  
  // Verificar match sem "+" (caso o webhook envie sem prefixo)
  const withoutPlus = phoneE164.replace(/^\+/, '');
  if (AI_WHITELIST.has(withoutPlus)) return true;
  if (AI_WHITELIST.has(`+${withoutPlus}`)) return true;
  
  return false;
}

/**
 * Log de feature flags no boot
 */
export function logFeatureFlags(): void {
  console.log('[FEATURE FLAGS]');
  console.log(`  INBOUND_AI_ENABLED: ${FEATURE_FLAGS.INBOUND_AI_ENABLED}`);
  console.log(`  ALLOW_REAL_SEND: ${FEATURE_FLAGS.ALLOW_REAL_SEND}`);
  console.log(`  ALLOW_CRON_ENABLE: ${FEATURE_FLAGS.ALLOW_CRON_ENABLE}`);
  console.log(`  DISPATCH_PROD_ONLY: ${FEATURE_FLAGS.DISPATCH_PROD_ONLY}`);
  console.log(`  FOLLOWUP_ENABLED: ${FEATURE_FLAGS.FOLLOWUP_ENABLED}`);
  console.log(`  KILL_SWITCH: ${FEATURE_FLAGS.KILL_SWITCH}`);
  console.log(`  WHATSAPP_AI_WHITELIST: ${AI_WHITELIST.size} números (${Array.from(AI_WHITELIST).map(n => n.slice(-4)).join(', ') || 'vazio'})`);
}
