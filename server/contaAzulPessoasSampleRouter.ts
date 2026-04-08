/**
 * TAREFA 2.1 - Listar Primeiras Pessoas (sem filtros)
 * Tenta múltiplos formatos de URL para descobrir qual funciona
 */

import { Router } from 'express';
import axios from 'axios';
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
 * Mascarar email: test@example.com → t***@example.com
 */
function maskEmail(email: string): string {
  if (!email || email.length < 3) return '***';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

/**
 * Mascarar documento: 12345678901234 → 1234****901234
 */
function maskDocument(doc: string): string {
  if (!doc || doc.length < 8) return '****';
  return `${doc.substring(0, 4)}****${doc.substring(doc.length - 4)}`;
}

/**
 * GET /pessoas-sample?max=10
 * Tenta múltiplos formatos de URL para listar pessoas
 */
router.get('/pessoas-sample', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const max = Math.min(parseInt(req.query.max || '10'), 50);
    const accessToken = await getValidAccessToken();

    console.log(`[PessoasSample] Iniciando busca de pessoas (max=${max})...`);

    const attempts: any[] = [];
    let peopleSample: any[] = [];

    // Tentar diferentes formatos de URL
    const urlVariations = [
      { name: 'sem params', url: 'https://api-v2.contaazul.com/v1/pessoas' },
      { name: 'limit=10', url: 'https://api-v2.contaazul.com/v1/pessoas?limit=10' },
      { name: 'tamanho_pagina=10', url: 'https://api-v2.contaazul.com/v1/pessoas?tamanho_pagina=10' },
      { name: 'pagina=1', url: 'https://api-v2.contaazul.com/v1/pessoas?pagina=1' },
      { name: 'pagina=1&tamanho_pagina=10', url: 'https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=10' },
    ];

    for (const variation of urlVariations) {
      try {
        console.log(`[PessoasSample] Tentando: ${variation.name}`);

        const response = await axios.get(variation.url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

        const data = response.data?.data || [];
        const count = Array.isArray(data) ? data.length : 0;

        console.log(`[PessoasSample] ${variation.name} → httpStatus=${response.status} count=${count}`);

        attempts.push({
          url: variation.url,
          name: variation.name,
          httpStatus: response.status,
          count,
          error: null,
        });

        // Se conseguiu dados e ainda não temos amostra, salvar
        if (count > 0 && peopleSample.length === 0) {
          peopleSample = Array.isArray(data) ? data.slice(0, max) : [];
          console.log(`[PessoasSample] Amostra coletada: ${peopleSample.length} pessoas`);
        }
      } catch (error: any) {
        const status = error.response?.status;
        const errorMsg = error.response?.data?.fault?.faultstring || error?.message;

        console.log(`[PessoasSample] ${variation.name} → httpStatus=${status} error=${errorMsg}`);

        attempts.push({
          url: variation.url,
          name: variation.name,
          httpStatus: status,
          count: 0,
          error: errorMsg,
        });
      }
    }

    // Formatar amostra com dados mascarados
    const formattedSample = peopleSample.map((p: any) => ({
      uuid: p.id,
      name: p.nome || p.name || 'N/A',
      nameMasked: (p.nome || p.name || 'N/A').substring(0, 3) + '***',
      emailMasked: p.email ? maskEmail(p.email) : 'N/A',
      documentMasked: p.documento || p.cpf || p.cnpj ? maskDocument(p.documento || p.cpf || p.cnpj) : 'N/A',
      rawEmails: p.emails ? (Array.isArray(p.emails) ? p.emails.map((e: any) => maskEmail(e.email || e)) : []) : [],
      rawDocuments: p.documentos ? (Array.isArray(p.documentos) ? p.documentos.map((d: any) => maskDocument(d.numero || d)) : []) : [],
    }));

    console.log(`[PessoasSample] Retornando ${formattedSample.length} pessoas mascaradas`);

    res.json({
      success: true,
      attempts,
      peopleSample: formattedSample,
      summary: {
        totalAttempts: attempts.length,
        successfulAttempts: attempts.filter((a: any) => a.count > 0).length,
        totalPeopleFound: peopleSample.length,
      },
    });
  } catch (error: any) {
    console.error(`[PessoasSample] FATAL error=${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

export default router;
