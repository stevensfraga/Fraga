/**
 * TAREFA A+B - Testar Criação de Pessoa com Logs Detalhados
 * POST /api/test/conta-azul/test-create-person
 * POST /api/test/conta-azul/test-create-person-variations
 */

import { Router } from 'express';
import { testCreatePersonWithFieldName, testCreatePersonVariations } from './services/createPersonTestService';

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  const headerSecret = req.headers['x-dev-secret'];
  
  if (!devSecret || devSecret !== headerSecret) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  return true;
}

/**
 * POST /test-create-person
 * Testar criação com um campo específico
 * Body: { fieldName, fieldValue, name?, email? }
 */
router.post('/test-create-person', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const { fieldName, fieldValue, name, email, extraPayload } = req.body;

    if (!fieldName || !fieldValue) {
      return res.json({
        success: false,
        error: 'fieldName e fieldValue são obrigatórios',
      });
    }

    console.log(`[TestCreatePerson] Testando fieldName=${fieldName} fieldValue=${fieldValue}`);

    const result = await testCreatePersonWithFieldName(
      fieldName,
      fieldValue,
      name || 'CLIENTE TESTE FRAGA',
      email || 'contato+teste@fraga.com.br',
      extraPayload || {}
    );

    res.json({
      success: result.success,
      result,
    });
  } catch (error: any) {
    console.error(`[TestCreatePerson] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * POST /test-create-person-variations
 * Testar todas as variações de campo e valor
 */
router.post('/test-create-person-variations', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    console.log(`[TestCreatePersonVariations] Iniciando teste de variações...`);

    const results = await testCreatePersonVariations();

    // Encontrar primeira tentativa bem-sucedida
    const successResult = results.find(r => r.success);

    res.json({
      success: !!successResult,
      totalAttempts: results.length,
      successAttempt: successResult?.attempt,
      successFieldName: successResult?.fieldName,
      successFieldValue: successResult?.fieldValue,
      successUuid: successResult?.uuid,
      allResults: results,
    });
  } catch (error: any) {
    console.error(`[TestCreatePersonVariations] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
