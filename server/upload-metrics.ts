/**
 * 📊 Métricas Estruturadas para Upload de Boletos
 * Rastreia tempo, taxa de sucesso e provider utilizado
 */

export interface UploadMetric {
  timestamp: string;
  receivableId: string | number;
  provider: 'worker' | 'r2' | 'fallback';
  success: boolean;
  durationMs: number;
  fileSizeBytes: number;
  error?: string;
  publicUrl?: string;
  key?: string;
}

class UploadMetricsCollector {
  private metrics: UploadMetric[] = [];
  private dailyStats: Map<string, { success: number; fail: number; totalMs: number }> = new Map();

  /**
   * Registrar métrica de upload
   */
  recordMetric(metric: UploadMetric): void {
    this.metrics.push(metric);
    
    // Atualizar estatísticas diárias
    const date = new Date(metric.timestamp).toISOString().split('T')[0];
    const stats = this.dailyStats.get(date) || { success: 0, fail: 0, totalMs: 0 };
    
    if (metric.success) {
      stats.success++;
    } else {
      stats.fail++;
    }
    stats.totalMs += metric.durationMs;
    
    this.dailyStats.set(date, stats);

    // Log estruturado
    console.log(
      `[R2WorkerUpload] ` +
      `ms=${metric.durationMs} ` +
      `status=${metric.success ? 'success' : 'fail'} ` +
      `receivableId=${metric.receivableId} ` +
      `provider=${metric.provider} ` +
      `size=${metric.fileSizeBytes} ` +
      (metric.error ? `error=${metric.error} ` : '') +
      (metric.publicUrl ? `url=${metric.publicUrl}` : '')
    );
  }

  /**
   * Obter estatísticas do dia
   */
  getDailyStats(date?: string): { success: number; fail: number; avgMs: number; totalMs: number } {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const stats = this.dailyStats.get(targetDate) || { success: 0, fail: 0, totalMs: 0 };
    
    const total = stats.success + stats.fail;
    const avgMs = total > 0 ? Math.round(stats.totalMs / total) : 0;

    return {
      success: stats.success,
      fail: stats.fail,
      avgMs,
      totalMs: stats.totalMs,
    };
  }

  /**
   * Obter taxa de sucesso (%)
   */
  getSuccessRate(date?: string): number {
    const stats = this.getDailyStats(date);
    const total = stats.success + stats.fail;
    return total > 0 ? Math.round((stats.success / total) * 100) : 0;
  }

  /**
   * Obter últimas N métricas
   */
  getRecentMetrics(limit: number = 10): UploadMetric[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Obter resumo de métricas por provider
   */
  getProviderStats(): Record<string, { count: number; successRate: number; avgMs: number }> {
    const providerStats: Record<string, { success: number; total: number; totalMs: number }> = {};

    for (const metric of this.metrics) {
      if (!providerStats[metric.provider]) {
        providerStats[metric.provider] = { success: 0, total: 0, totalMs: 0 };
      }
      
      providerStats[metric.provider].total++;
      providerStats[metric.provider].totalMs += metric.durationMs;
      
      if (metric.success) {
        providerStats[metric.provider].success++;
      }
    }

    const result: Record<string, { count: number; successRate: number; avgMs: number }> = {};
    
    for (const [provider, stats] of Object.entries(providerStats)) {
      result[provider] = {
        count: stats.total,
        successRate: Math.round((stats.success / stats.total) * 100),
        avgMs: Math.round(stats.totalMs / stats.total),
      };
    }

    return result;
  }
}

// Singleton global
export const metricsCollector = new UploadMetricsCollector();

/**
 * Helper para registrar métrica de upload
 */
export function recordUploadMetric(
  receivableId: string | number,
  provider: 'worker' | 'r2' | 'fallback',
  success: boolean,
  durationMs: number,
  fileSizeBytes: number,
  error?: string,
  publicUrl?: string,
  key?: string
): void {
  metricsCollector.recordMetric({
    timestamp: new Date().toISOString(),
    receivableId,
    provider,
    success,
    durationMs,
    fileSizeBytes,
    error,
    publicUrl,
    key,
  });
}
