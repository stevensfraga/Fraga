/**
 * TAREFA 3.1 - Criar Pessoa de Teste no Conta Azul
 * POST /api/test/conta-azul/create-person-test
 */

import { Router } from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { getDb } from './db';
import { clients } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

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
 * POST /create-person-test
 * Body: { name, email, document? }
 */
router.post('/create-person-test', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const { name, email, document } = req.body;

    if (!name || !email) {
      return res.json({
        success: false,
        error: 'name e email são obrigatórios',
      });
    }

    console.log(`[CreatePersonTest] Criando pessoa: name=${name} email=${email}`);

    // Obter token
    const accessToken = await getValidAccessToken();

    // Montar payload
    const payload: any = {
      nome: name,
      email: email,
      tipo: 'Jurídica', // Tipo obrigatório: Física, Jurídica ou Estrangeira
    };

    if (document) {
      payload.documento = document;
    }

    console.log(`[CreatePersonTest] Payload: ${JSON.stringify(payload)}`);
    console.log(`[CreatePersonTest] Enviando para Conta Azul com tipo=${payload.tipo}`);

    // Criar pessoa no Conta Azul
    const createResponse = await axios.post(
      'https://api-v2.contaazul.com/v1/pessoas',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const person = createResponse.data?.data || createResponse.data;
    const uuid = person?.id;

    console.log(`[CreatePersonTest] Pessoa criada: uuid=${uuid} httpStatus=${createResponse.status}`);

    // Salvar opcionalmente em cliente de teste local
    let localClientId = null;
    try {
      const db = await getDb();
      if (db) {
        // Buscar ou criar cliente de teste
        const testClients = await db
          .select()
          .from(clients)
          .where(eq(clients.email, email))
          .limit(1);

        if (testClients.length > 0) {
          localClientId = testClients[0].id;
          // Atualizar com UUID
          await db
            .update(clients)
            .set({ contaAzulPersonId: uuid })
            .where(eq(clients.id, localClientId));
          console.log(`[CreatePersonTest] UUID salvo em cliente local: clientId=${localClientId}`);
        }
      }
    } catch (error: any) {
      console.log(`[CreatePersonTest] Não foi possível salvar em cliente local: ${error?.message}`);
    }

    res.json({
      success: true,
      httpStatus: createResponse.status,
      uuid,
      name,
      email,
      localClientId,
      payload,
    });
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    console.error(`[CreatePersonTest] ERROR httpStatus=${status} error=${error?.message}`);

    res.json({
      success: false,
      error: error?.message,
      httpStatus: status,
      errorData,
    });
  }
});

export default router;
