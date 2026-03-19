/**
 * Simple In-Memory Cache with TTL
 * Não depende de Redis - funciona mesmo offline
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SimpleCache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  /**
   * Get value from cache
   * Retorna null se expirado ou não existe
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Verificar se expirou
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set value in cache with TTL
   * @param key cache key
   * @param value value to cache
   * @param ttlMs time to live in milliseconds (default: 24h)
   */
  set<T>(key: string, value: T, ttlMs: number = 24 * 60 * 60 * 1000): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Clean expired entries
   */
  cleanup(): number {
    let removed = 0;
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      removed++;
    });

    return removed;
  }
}

// Singleton instance
export const simpleCache = new SimpleCache();

// Cleanup expired entries every 1 hour
setInterval(() => {
  const removed = simpleCache.cleanup();
  if (removed > 0) {
    console.log(`[SimpleCache] Cleaned up ${removed} expired entries`);
  }
}, 60 * 60 * 1000);

export default simpleCache;
