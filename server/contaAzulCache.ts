/**
 * Sistema de cache para dados financeiros da Conta Azul
 * Atualiza a cada 30 minutos com retry logic
 */

import { fetchLast6MonthsFinancialData } from "./contaAzulFinancial";

interface CacheData {
  data: any[];
  timestamp: number;
  expiresAt: number;
}

interface CacheStatus {
  isCached: boolean;
  lastUpdate: string;
  expiresIn: number;
  dataPoints: number;
}

// Cache em memória
let financialCache: CacheData | null = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

/**
 * Obter dados com cache
 */
export async function getFinancialDataWithCache(): Promise<any[]> {
  const now = Date.now();

  // Se cache está válido, retornar dados em cache
  if (financialCache && now < financialCache.expiresAt) {
    console.log("[Cache] Retornando dados do cache");
    return financialCache.data;
  }

  // Cache expirou ou não existe, buscar dados novos
  console.log("[Cache] Cache expirado ou não existe, buscando dados novos...");
  try {
    const data = await fetchLast6MonthsFinancialData();

    // Atualizar cache
    financialCache = {
      data,
      timestamp: now,
      expiresAt: now + CACHE_DURATION,
    };

    console.log(`[Cache] ✅ Cache atualizado com ${data.length} meses de dados`);
    return data;
  } catch (error: any) {
    console.error("[Cache] Erro ao buscar dados:", error.message);

    // Se houver cache antigo, retornar mesmo que expirado
    if (financialCache) {
      console.log("[Cache] Retornando cache antigo devido a erro");
      return financialCache.data;
    }

    return [];
  }
}

/**
 * Obter status do cache
 */
export function getCacheStatus(): CacheStatus {
  const now = Date.now();

  if (!financialCache) {
    return {
      isCached: false,
      lastUpdate: "Nunca",
      expiresIn: 0,
      dataPoints: 0,
    };
  }

  const expiresIn = Math.max(0, financialCache.expiresAt - now);
  const lastUpdate = new Date(financialCache.timestamp).toLocaleString("pt-BR");

  return {
    isCached: now < financialCache.expiresAt,
    lastUpdate,
    expiresIn: Math.ceil(expiresIn / 1000), // em segundos
    dataPoints: financialCache.data.length,
  };
}

/**
 * Limpar cache (útil para testes)
 */
export function clearCache(): void {
  financialCache = null;
  console.log("[Cache] Cache limpo");
}

/**
 * Inicializar cache (buscar dados na inicialização)
 */
export async function initializeCache(): Promise<void> {
  console.log("[Cache] Inicializando cache...");
  await getFinancialDataWithCache();
}
