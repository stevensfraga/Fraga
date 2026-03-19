/**
 * Sistema de Retry com Backoff Exponencial
 * Implementa tentativas automáticas com aumento progressivo de tempo de espera
 */

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: number;
  totalTimeMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 segundo
  maxDelayMs: 30000, // 30 segundos
  backoffMultiplier: 2, // Dobra a cada tentativa
  timeoutMs: 10000, // 10 segundos por requisição
};

/**
 * Calcula o delay para a próxima tentativa usando backoff exponencial
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Executa uma função com retry automático e backoff exponencial
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      console.log(`[Retry] Tentativa ${attempt}/${finalConfig.maxRetries}`);

      // Executar com timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout após ${finalConfig.timeoutMs}ms`)),
          finalConfig.timeoutMs
        )
      );

      const result = await Promise.race([fn(), timeoutPromise]);

      const totalTimeMs = Date.now() - startTime;
      console.log(`[Retry] Sucesso na tentativa ${attempt} (${totalTimeMs}ms)`);

      return {
        success: true,
        data: result,
        attempts: attempt,
        totalTimeMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[Retry] Falha na tentativa ${attempt}: ${lastError.message}`);

      // Se não for a última tentativa, aguardar antes de tentar novamente
      if (attempt < finalConfig.maxRetries) {
        const delay = calculateDelay(attempt, finalConfig);
        console.log(`[Retry] Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  const totalTimeMs = Date.now() - startTime;
  console.error(
    `[Retry] Todas as ${finalConfig.maxRetries} tentativas falharam (${totalTimeMs}ms)`
  );

  return {
    success: false,
    error: lastError?.message || "Erro desconhecido",
    attempts: finalConfig.maxRetries,
    totalTimeMs,
  };
}

/**
 * Executa uma função com retry para requisições HTTP
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { retryConfig?: Partial<RetryConfig> } = {}
): Promise<Response> {
  const { retryConfig, ...fetchOptions } = options;

  const result = await executeWithRetry(
    () => fetch(url, fetchOptions),
    retryConfig
  );

  if (!result.success) {
    throw new Error(`Falha ao buscar ${url} após ${result.attempts} tentativas: ${result.error}`);
  }

  return result.data!;
}

/**
 * Retorna configuração padrão para referência
 */
export function getDefaultRetryConfig(): RetryConfig {
  return { ...DEFAULT_CONFIG };
}

/**
 * Cria configuração customizada para retry
 */
export function createRetryConfig(overrides: Partial<RetryConfig> = {}): RetryConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
