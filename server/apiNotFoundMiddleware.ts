import { Request, Response, NextFunction } from 'express';

/**
 * Middleware fail-fast para /api/* routes não encontradas
 * Retorna 404 JSON em vez de servir index.html (SPA fallback)
 * Isso impede "200 HTML" enganoso e mata 50% do loop
 */
export function apiNotFoundMiddleware(req: Request, res: Response, next: NextFunction) {
  // Este middleware é registrado DEPOIS de todos os /api/* routers
  // Se chegou aqui, significa que a rota /api/* não foi encontrada
  
  if (req.path.startsWith('/api/')) {
    console.error(`[API 404] ${req.method} ${req.path} - Route not found`);
    
    return res.status(404).json({
      error: 'API_ROUTE_NOT_FOUND',
      message: `The API endpoint ${req.method} ${req.path} does not exist`,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }
  
  // Se não for /api/*, deixa passar (pode ser rota do frontend)
  next();
}
