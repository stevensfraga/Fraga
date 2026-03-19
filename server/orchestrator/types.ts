/**
 * Tipos para o Orquestrador Claude ↔ DeepSeek
 * Sistema de coordenação automática de LLMs
 */

export interface OrchestratorRequest {
  query: string;
  context?: Record<string, unknown>;
  requiresDeepThinking?: boolean;
  priority?: "low" | "medium" | "high";
  timeout?: number;
}

export interface OrchestratorResponse {
  answer: string;
  usedModels: string[];
  reasoning: string;
  metadata: {
    totalTime: number;
    claudeTime?: number;
    deepseekTime?: number;
    fallbackUsed?: boolean;
  };
}

export interface ModelDecision {
  useDeepSeek: boolean;
  reason: string;
  confidence: number;
}

export interface TaskDecomposition {
  mainTask: string;
  subtasks: Array<{
    id: string;
    description: string;
    assignedModel: "claude" | "deepseek";
    priority: number;
  }>;
  parallelizable: boolean;
}

export interface CacheEntry {
  query: string;
  response: OrchestratorResponse;
  timestamp: number;
  ttl: number;
}

export interface ModelMetrics {
  callCount: number;
  totalTime: number;
  avgTime: number;
  errorCount: number;
  successRate: number;
  lastUsed: number;
}
