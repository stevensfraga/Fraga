/**
 * TAREFA 2.2 - Match Assistido
 * Comparar 1 pessoa do Conta Azul com base local
 */

import { Router } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { clients } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';

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
 * Mascarar email
 */
function maskEmail(email: string): string {
  if (!email || email.length < 3) return '***';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

/**
 * Mascarar documento
 */
function maskDocument(doc: string): string {
  if (!doc || doc.length < 8) return '****';
  return `${doc.substring(0, 4)}****${doc.substring(doc.length - 4)}`;
}

/**
 * Normalizar para comparação
 */
function normalize(value: string): string {
  if (!value) return '';
  return value.toLowerCase().trim().replace(/[^\w@.-]/g, '');
}

/**
 * POST /match-assisted
 * Body: { contaAzulPersonUuid: string, clientId?: number }
 */
router.post('/match-assisted', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const { contaAzulPersonUuid, clientId } = req.body;

    if (!contaAzulPersonUuid) {
      return res.json({
        success: false,
        error: 'contaAzulPersonUuid is required',
      });
    }

    console.log(`[MatchAssisted] Iniciando match assistido uuid=${contaAzulPersonUuid} clientId=${clientId}`);

    // Obter token
    const accessToken = await getValidAccessToken();

    // Buscar pessoa no Conta Azul por UUID
    console.log(`[MatchAssisted] Buscando pessoa uuid=${contaAzulPersonUuid} no Conta Azul`);

    const personResponse = await axios.get(
      `https://api-v2.contaazul.com/v1/pessoas/${contaAzulPersonUuid}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const person = personResponse.data?.data || personResponse.data;

    if (!person) {
      return res.json({
        success: false,
        error: 'Pessoa não encontrada no Conta Azul',
      });
    }

    console.log(`[MatchAssisted] Pessoa encontrada: ${person.nome}`);

    // Extrair dados
    const personEmails = person.emails
      ? (Array.isArray(person.emails) ? person.emails.map((e: any) => e.email || e) : [person.emails])
      : (person.email ? [person.email] : []);

    const personDocuments = person.documentos
      ? (Array.isArray(person.documentos) ? person.documentos.map((d: any) => d.numero || d) : [person.documentos])
      : (person.documento || person.cpf || person.cnpj ? [person.documento || person.cpf || person.cnpj] : []);

    console.log(`[MatchAssisted] Pessoa tem ${personEmails.length} emails e ${personDocuments.length} documentos`);

    // Buscar cliente local
    let localClient = null;
    let matchBy = 'none';
    let confidence = 0;

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Se clientId foi fornecido, buscar direto
    if (clientId) {
      const result = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (result.length > 0) {
        localClient = result[0];
        matchBy = 'provided';
        confidence = 100;
        console.log(`[MatchAssisted] Cliente local encontrado por ID: ${clientId}`);
      }
    } else {
      // Tentar match por email
      if (personEmails.length > 0) {
        for (const email of personEmails) {
          const normalized = normalize(email);
          if (!normalized) continue;

          const result = await db
            .select()
            .from(clients)
            .where(eq(clients.email, email))
            .limit(1);

          if (result.length > 0) {
            localClient = result[0];
            matchBy = 'email';
            confidence = 95;
            console.log(`[MatchAssisted] Cliente local encontrado por email`);
            break;
          }
        }
      }

      // Tentar match por documento
      if (!localClient && personDocuments.length > 0) {
        for (const doc of personDocuments) {
          const normalized = normalize(doc);
          if (!normalized) continue;

          const result = await db
            .select()
            .from(clients)
            .where(eq(clients.document, doc))
            .limit(1);

          if (result.length > 0) {
            localClient = result[0];
            matchBy = 'document';
            confidence = 90;
            console.log(`[MatchAssisted] Cliente local encontrado por documento`);
            break;
          }
        }
      }

      // Tentar match por nome (menos confiável)
      if (!localClient && person.nome) {
        const normalized = normalize(person.nome);
        if (normalized) {
          const result = await db
            .select()
            .from(clients)
            .where(eq(clients.name, person.nome))
            .limit(1);

          if (result.length > 0) {
            localClient = result[0];
            matchBy = 'name';
            confidence = 70;
            console.log(`[MatchAssisted] Cliente local encontrado por nome`);
          }
        }
      }
    }

    console.log(`[MatchAssisted] Match result: matchBy=${matchBy} confidence=${confidence}`);

    res.json({
      success: true,
      person: {
        uuid: person.id,
        name: person.nome || person.name || 'N/A',
        nameMasked: (person.nome || person.name || 'N/A').substring(0, 3) + '***',
        emailsMasked: personEmails.map((e: string) => maskEmail(e)),
        documentsMasked: personDocuments.map((d: string) => maskDocument(d)),
      },
      localMatch: {
        found: !!localClient,
        by: matchBy,
        clientId: localClient?.id || null,
        clientName: localClient?.name || null,
        confidence,
      },
    });
  } catch (error: any) {
    const status = error.response?.status;
    console.error(`[MatchAssisted] ERROR httpStatus=${status} error=${error?.message}`);

    res.json({
      success: false,
      error: error?.message,
      httpStatus: status,
    });
  }
});

export default router;
