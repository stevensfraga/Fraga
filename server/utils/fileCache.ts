/**
 * File-based Cache with TTL
 * Persiste em ./data/zap_upload_cache.json
 * Opcional - fallback quando memória não é suficiente
 */

import fs from 'fs';
import path from 'path';

interface FileCacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface FileCacheData {
  [key: string]: FileCacheEntry<any>;
}

class FileCache {
  private cacheDir: string;
  private cacheFile: string;
  private data: FileCacheData = {};
  private initialized: boolean = false;

  constructor(cacheDir: string = './data') {
    this.cacheDir = cacheDir;
    this.cacheFile = path.join(cacheDir, 'zap_upload_cache.json');
    this.init();
  }

  /**
   * Initialize cache directory and load data
   */
  private init(): void {
    try {
      // Criar diretório se não existir
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      // Carregar dados existentes
      if (fs.existsSync(this.cacheFile)) {
        const content = fs.readFileSync(this.cacheFile, 'utf-8');
        this.data = JSON.parse(content);
        console.log(`[FileCache] Loaded ${Object.keys(this.data).length} entries from ${this.cacheFile}`);
      }

      this.initialized = true;
    } catch (error: any) {
      console.warn(`[FileCache] Init error: ${error.message}`);
      this.data = {};
      this.initialized = true;
    }
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    if (!this.initialized) {
      return null;
    }

    const entry = this.data[key];

    if (!entry) {
      return null;
    }

    // Verificar se expirou
    if (Date.now() > entry.expiresAt) {
      delete this.data[key];
      this.save();
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set value in cache with TTL
   */
  set<T>(key: string, value: T, ttlMs: number = 24 * 60 * 60 * 1000): void {
    if (!this.initialized) {
      return;
    }

    this.data[key] = {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    };

    this.save();
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    if (!this.initialized) {
      return false;
    }

    const existed = key in this.data;
    delete this.data[key];

    if (existed) {
      this.save();
    }

    return existed;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    if (!this.initialized) {
      return;
    }

    this.data = {};
    this.save();
  }

  /**
   * Get cache size
   */
  size(): number {
    return Object.keys(this.data).length;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Object.keys(this.data);
  }

  /**
   * Clean expired entries
   */
  cleanup(): number {
    if (!this.initialized) {
      return 0;
    }

    let removed = 0;
    const now = Date.now();

    for (const key in this.data) {
      if (now > this.data[key].expiresAt) {
        delete this.data[key];
        removed++;
      }
    }

    if (removed > 0) {
      this.save();
    }

    return removed;
  }

  /**
   * Save cache to file
   */
  private save(): void {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error: any) {
      console.warn(`[FileCache] Save error: ${error.message}`);
    }
  }
}

// Singleton instance
export const fileCache = new FileCache();

// Cleanup expired entries every 1 hour
setInterval(() => {
  const removed = fileCache.cleanup();
  if (removed > 0) {
    console.log(`[FileCache] Cleaned up ${removed} expired entries`);
  }
}, 60 * 60 * 1000);

export default fileCache;
