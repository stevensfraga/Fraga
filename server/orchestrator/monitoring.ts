/**
 * Sistema de Monitoramento do Orquestrador
 */

interface RequestMetric {
  id: string;
  query: string;
  timestamp: number;
  duration: number;
  modelsUsed: string[];
  status: "success" | "error" | "timeout";
  costUSD: number;
}

class OrchestratorMonitor {
  private metrics: RequestMetric[] = [];
  private maxMetrics = 1000;

  /**
   * Registrar métrica de requisição
   */
  logRequest(metric: RequestMetric) {
    this.metrics.push(metric);

    // Limpar métricas antigas se exceder limite
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    console.log(
      `[METRIC] ${metric.status} | ${metric.duration}ms | $${metric.costUSD.toFixed(4)} | Models: ${metric.modelsUsed.join(",")}`
    );
  }

  /**
   * Obter estatísticas
   */
  getStats() {
    const totalRequests = this.metrics.length;
    const successRequests = this.metrics.filter(
      (m) => m.status === "success"
    ).length;
    const errorRequests = this.metrics.filter(
      (m) => m.status === "error"
    ).length;
    const timeoutRequests = this.metrics.filter(
      (m) => m.status === "timeout"
    ).length;

    const totalTime = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const avgTime = totalTime / totalRequests || 0;
    const totalCost = this.metrics.reduce((sum, m) => sum + m.costUSD, 0);

    const claudeOnlyRequests = this.metrics.filter(
      (m) => m.modelsUsed.length === 1 && m.modelsUsed[0] === "claude"
    ).length;
    const deepseekRequests = this.metrics.filter((m) =>
      m.modelsUsed.includes("deepseek-r1")
    ).length;

    return {
      totalRequests,
      successRate: ((successRequests / totalRequests) * 100).toFixed(2) + "%",
      errorRate: ((errorRequests / totalRequests) * 100).toFixed(2) + "%",
      timeoutRate: ((timeoutRequests / totalRequests) * 100).toFixed(2) + "%",
      avgResponseTime: avgTime.toFixed(0) + "ms",
      minResponseTime: Math.min(...this.metrics.map((m) => m.duration)) + "ms",
      maxResponseTime: Math.max(...this.metrics.map((m) => m.duration)) + "ms",
      totalCost: "$" + totalCost.toFixed(2),
      avgCostPerRequest: "$" + (totalCost / totalRequests).toFixed(4),
      claudeOnlyPercentage:
        ((claudeOnlyRequests / totalRequests) * 100).toFixed(1) + "%",
      deepseekPercentage:
        ((deepseekRequests / totalRequests) * 100).toFixed(1) + "%",
    };
  }

  /**
   * Obter métricas recentes
   */
  getRecentMetrics(limit = 50) {
    return this.metrics.slice(-limit).map((m) => ({
      timestamp: new Date(m.timestamp).toISOString(),
      duration: m.duration + "ms",
      models: m.modelsUsed.join(", "),
      status: m.status,
      cost: "$" + m.costUSD.toFixed(4),
    }));
  }

  /**
   * Obter modelo mais usado
   */
  getMostUsedModels() {
    const modelUsage: Record<string, number> = {};

    this.metrics.forEach((m) => {
      m.modelsUsed.forEach((model) => {
        modelUsage[model] = (modelUsage[model] || 0) + 1;
      });
    });

    return Object.entries(modelUsage)
      .sort(([, a], [, b]) => b - a)
      .map(([model, count]) => ({
        model,
        count,
        percentage: ((count / this.metrics.length) * 100).toFixed(1) + "%",
      }));
  }

  /**
   * Obter tempo de resposta por modelo
   */
  getResponseTimeByModel() {
    const modelTimes: Record<string, number[]> = {};

    this.metrics.forEach((m) => {
      m.modelsUsed.forEach((model) => {
        if (!modelTimes[model]) modelTimes[model] = [];
        modelTimes[model].push(m.duration);
      });
    });

    return Object.entries(modelTimes).map(([model, times]) => ({
      model,
      avgTime: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0) + "ms",
      minTime: Math.min(...times) + "ms",
      maxTime: Math.max(...times) + "ms",
      usageCount: times.length,
    }));
  }

  /**
   * Limpar métricas
   */
  clear() {
    this.metrics = [];
  }

  /**
   * Exportar métricas como JSON
   */
  export() {
    return {
      metrics: this.metrics,
      stats: this.getStats(),
      modelUsage: this.getMostUsedModels(),
      responseTimeByModel: this.getResponseTimeByModel(),
      exportedAt: new Date().toISOString(),
    };
  }
}

export const monitor = new OrchestratorMonitor();

/**
 * Função helper para calcular custo
 */
export function calculateCost(
  claudeTokens: number,
  deepseekTokens?: number
): number {
  let cost = 0;

  // Claude: $3 por 1M input tokens
  cost += (claudeTokens / 1000000) * 3;

  if (deepseekTokens) {
    // DeepSeek R1: ~$0.8 por 1M tokens (estimado)
    cost += (deepseekTokens / 1000000) * 0.8;
  }

  return cost;
}
