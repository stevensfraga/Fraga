/**
 * Configurações do Orquestrador
 */

export const ORCHESTRATOR_CONFIG = {
  // Modelos
  models: {
    claude: {
      name: "claude-3-5-sonnet-20241022",
      maxTokens: 4096,
      costPerMilTokens: 3, // USD
    },
    deepseek: {
      name: "deepseek-r1",
      maxTokens: 8192,
      costPerMilTokens: 0.8, // USD (estimado)
    },
  },

  // Cache
  cache: {
    ttl: parseInt(process.env.ORCHESTRATOR_CACHE_TTL || "3600000"), // 1 hora
    maxSize: 1000, // máximo de entradas
  },

  // Timeouts
  timeouts: {
    claude: 30000, // 30 segundos
    deepseek: 60000, // 60 segundos (pode ser mais lento)
    total: parseInt(process.env.ORCHESTRATOR_TIMEOUT || "90000"), // 90 segundos
  },

  // Limites
  limits: {
    maxInputLength: 10000, // caracteres
    maxOutputLength: 50000, // caracteres
    maxConcurrentRequests: 10,
  },

  // Decisão de Deepseek
  deepseekThresholds: {
    minConfidence: 0.7,
    keywords: [
      "analise",
      "complexo",
      "raciocín",
      "matemátic",
      "algoritm",
      "profund",
      "decompor",
      "passo a passo",
    ],
  },

  // Rate Limiting
  rateLimiting: {
    enabled: true,
    windowMs: 60000, // 1 minuto
    maxRequests: 100,
    keyGenerator: (req: any) => req.ip || "unknown",
  },

  // Logging
  logging: {
    verbose: process.env.NODE_ENV === "development",
    logQueries: true,
    logResponses: process.env.NODE_ENV === "development",
    logTiming: true,
  },

  // Fallback
  fallback: {
    enabled: true,
    maxRetries: 2,
    retryDelay: 1000,
  },
};

// Validar configuração
export function validateConfig() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "⚠️ ANTHROPIC_API_KEY não configurada. Orquestrador em modo limitado."
    );
  }

  if (ORCHESTRATOR_CONFIG.cache.ttl < 0) {
    console.error("❌ CACHE TTL não pode ser negativo");
    process.exit(1);
  }

  console.log("✅ Configuração do orquestrador validada");
}

// Retornar configurações por ambiente
export function getConfig() {
  return {
    ...ORCHESTRATOR_CONFIG,
    env: process.env.NODE_ENV || "development",
  };
}
