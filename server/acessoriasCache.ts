import { fetchAcessoriasCompanyData } from "./acessoriasIntegration";

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

// Cache em memória
const cache: CacheStore = {};

// Configurações de cache
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutos
const UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

// Identificadores das empresas a cachear (R7 Geradores removida - não é mais cliente)
const COMPANY_IDENTIFIERS: string[] = [];

/**
 * Gera chave de cache para uma empresa
 */
function getCacheKey(identificador: string): string {
  return `acessorias_company_${identificador}`;
}

/**
 * Obtém dados do cache se ainda estiverem válidos
 */
export function getCachedData(identificador: string): any | null {
  const key = getCacheKey(identificador);
  const entry = cache[key];

  if (!entry) {
    console.log(`[Cache] Nenhum cache encontrado para ${identificador}`);
    return null;
  }

  // Verificar se o cache expirou
  if (Date.now() > entry.expiresAt) {
    console.log(`[Cache] Cache expirado para ${identificador}`);
    delete cache[key];
    return null;
  }

  const ageMinutes = Math.round((Date.now() - entry.timestamp) / 60000);
  console.log(`[Cache] Usando cache para ${identificador} (${ageMinutes} minutos atrás)`);
  return entry.data;
}

/**
 * Armazena dados no cache
 */
export function setCachedData(identificador: string, data: any): void {
  const key = getCacheKey(identificador);
  cache[key] = {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + CACHE_DURATION_MS,
  };
  console.log(`[Cache] Dados armazenados em cache para ${identificador}`);
}

/**
 * Busca dados com fallback para cache
 */
export async function fetchWithCache(identificador: string): Promise<any | null> {
  // Tentar obter do cache primeiro
  const cachedData = getCachedData(identificador);
  if (cachedData) {
    return cachedData;
  }

  // Se não estiver em cache, buscar da API
  try {
    console.log(`[Cache] Buscando dados da API para ${identificador}...`);
    const data = await fetchAcessoriasCompanyData(identificador);

    if (data) {
      setCachedData(identificador, data);
      return data;
    }

    return null;
  } catch (error: any) {
    console.error(`[Cache] Erro ao buscar dados da API para ${identificador}:`, error.message);
    return null;
  }
}

/**
 * Limpa todo o cache
 */
export function clearCache(): void {
  Object.keys(cache).forEach((key) => delete cache[key]);
  console.log("[Cache] Cache limpo");
}

/**
 * Retorna informações sobre o cache
 */
export function getCacheStats(): {
  totalEntries: number;
  entries: Array<{
    key: string;
    ageMinutes: number;
    expiresInMinutes: number;
  }>;
} {
  const entries = Object.entries(cache).map(([key, entry]) => ({
    key,
    ageMinutes: Math.round((Date.now() - entry.timestamp) / 60000),
    expiresInMinutes: Math.round((entry.expiresAt - Date.now()) / 60000),
  }));

  return {
    totalEntries: entries.length,
    entries,
  };
}

/**
 * Inicia job de atualização periódica do cache
 */
export function startCacheUpdateJob(): NodeJS.Timeout {
  console.log(`[Cache] Iniciando job de atualização a cada ${UPDATE_INTERVAL_MS / 60000} minutos`);

  // Atualizar imediatamente na inicialização
  updateCacheNow();

  // Agendar atualizações periódicas
  const intervalId = setInterval(() => {
    updateCacheNow();
  }, UPDATE_INTERVAL_MS);

  return intervalId;
}

/**
 * Atualiza o cache agora para todas as empresas
 */
async function updateCacheNow(): Promise<void> {
  console.log("[Cache] Atualizando cache de todas as empresas...");

  for (const identificador of COMPANY_IDENTIFIERS) {
    try {
      const data = await fetchAcessoriasCompanyData(identificador);
      if (data) {
        setCachedData(identificador, data);
        console.log(`[Cache] ✅ Atualização bem-sucedida para ${identificador}`);
      } else {
        console.warn(`[Cache] ⚠️ Nenhum dado retornado para ${identificador}`);
      }
    } catch (error: any) {
      console.error(`[Cache] ❌ Erro ao atualizar cache para ${identificador}:`, error.message);
    }
  }

  console.log("[Cache] Ciclo de atualização concluído");
}

/**
 * Para o job de atualização
 */
export function stopCacheUpdateJob(intervalId: NodeJS.Timeout): void {
  clearInterval(intervalId);
  console.log("[Cache] Job de atualização parado");
}
