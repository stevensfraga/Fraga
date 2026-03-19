/**
 * BLOCO 11 — Módulo de Cobrança via WhatsApp
 * 
 * Exporta todos os submódulos:
 * - buckets: Classificação por faixa de atraso
 * - eligibilityFilter: Filtros obrigatórios pré-envio
 * - messageTemplates: Templates de mensagem por faixa
 * - batchSender: Envio controlado em lote
 * - collectionBatchRouter: Router Express
 */

export * from './buckets';
export * from './eligibilityFilter';
export * from './messageTemplates';
export * from './batchSender';
export { default as collectionBatchRouter } from './collectionBatchRouter';
