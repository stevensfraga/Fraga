import { startCacheUpdateJob, stopCacheUpdateJob } from "./acessoriasCache";

let cacheJobInterval: NodeJS.Timeout | null = null;

/**
 * Inicia o gerenciador de cache
 */
export function initializeCacheManager(): void {
  if (cacheJobInterval) {
    console.log("[CacheManager] Cache manager já está rodando");
    return;
  }

  console.log("[CacheManager] Inicializando gerenciador de cache...");
  cacheJobInterval = startCacheUpdateJob();
  console.log("[CacheManager] ✅ Gerenciador de cache iniciado");
}

/**
 * Para o gerenciador de cache
 */
export function shutdownCacheManager(): void {
  if (!cacheJobInterval) {
    console.log("[CacheManager] Cache manager não está rodando");
    return;
  }

  console.log("[CacheManager] Parando gerenciador de cache...");
  stopCacheUpdateJob(cacheJobInterval);
  cacheJobInterval = null;
  console.log("[CacheManager] ✅ Gerenciador de cache parado");
}

/**
 * Retorna o status do gerenciador de cache
 */
export function isCacheManagerRunning(): boolean {
  return cacheJobInterval !== null;
}
