/**
 * Middleware para integração do Orquestrador
 * Intercepta requisições e as roteia através do orquestrador
 */

import { orchestrate } from "./orchestrator";
import type { Express, Request, Response, NextFunction } from "express";

export interface OrchestratorRequest extends Request {
  orchestratorResult?: unknown;
  orchestratorTime?: number;
}

/**
 * Middleware que intercepta requisições com header 'X-Use-Orchestrator'
 */
export function orchestratorMiddleware(
  req: OrchestratorRequest,
  res: Response,
  next: NextFunction
) {
  // Verificar se cliente quer usar orquestrador
  const useOrchestrator = req.headers["x-use-orchestrator"] === "true";

  if (!useOrchestrator) {
    return next();
  }

  // Extrair query da requisição
  const query = extractQuery(req);
  if (!query) {
    return next();
  }

  console.log(
    "[MIDDLEWARE] Orquestrador ativado para:",
    query.substring(0, 100)
  );

  // Processar através do orquestrador
  const startTime = Date.now();

  orchestrate({
    query,
    context: req.body,
    requiresDeepThinking: req.headers["x-deep-thinking"] === "true",
    priority:
      (req.headers["x-priority"] as "low" | "medium" | "high") || "medium",
  })
    .then((result) => {
      (req as OrchestratorRequest).orchestratorResult = result;
      (req as OrchestratorRequest).orchestratorTime = Date.now() - startTime;

      // Adicionar headers de resposta
      res.setHeader("X-Orchestrator-Used", "true");
      res.setHeader(
        "X-Orchestrator-Models",
        result.usedModels.join(", ")
      );
      res.setHeader("X-Orchestrator-Time", String(result.metadata.totalTime));

      next();
    })
    .catch((error) => {
      console.error("[MIDDLEWARE] Erro no orquestrador:", error);
      res.status(500).json({
        error: "Erro no orquestrador",
        message: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * Extrair query da requisição
 */
function extractQuery(req: Request): string | null {
  // Se for POST com body.query
  if (req.body?.query) {
    return req.body.query;
  }

  // Se for GET com query param
  if (req.query?.q) {
    return String(req.query.q);
  }

  // Se for POST com conteúdo raw
  if (req.method === "POST" && typeof req.body === "string") {
    return req.body;
  }

  return null;
}

/**
 * Função para integrar middleware no Express
 */
export function setupOrchestratorMiddleware(app: Express) {
  app.use(orchestratorMiddleware);
  console.log("[SETUP] Middleware do Orquestrador ativado");
}
