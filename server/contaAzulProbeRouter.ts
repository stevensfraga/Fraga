import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { randomUUID } from 'crypto';

const router = Router();

/**
 * GET /api/contaazul/probe
 * Sonda a API Conta Azul sem side-effects
 * Retorna prova de que a API está respondendo em tempo real
 * 
 * Response:
 * {
 *   ok: true,
 *   source: "contaazul",
 *   traceId: UUID,
 *   timestamp: ISO,
 *   endpointHit: "GET /v1/pessoas?limit=1",
 *   statusCode: 200,
 *   evidence: { pessoaId, nome, documentoMascarado },
 *   latencyMs: number,
 *   logs: string[]
 * }
 */
router.get('/probe', async (req: Request, res: Response) => {
  const traceId = randomUUID();
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[ContaAzulProbe] ${msg}`);
    logs.push(msg);
  };

  const startTime = Date.now();

  try {
    log(`START traceId=${traceId}`);
    
    // Obter token válido
    const token = await getValidAccessToken();
    if (!token) {
      log(`ERROR: No valid access token available`);
      return res.status(401).json({
        ok: false,
        error: 'NO_VALID_TOKEN',
        traceId,
        logs,
      });
    }

    log(`Token obtained, making probe request...`);

    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';
    const probeUrl = `${baseUrl}/pessoas?limit=1`;
    
    log(`Probe URL: GET ${probeUrl}`);

    // Fazer requisição de sonda
    const response = await axios.get(probeUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    const latencyMs = Date.now() - startTime;
    log(`Response status: ${response.status}, latency: ${latencyMs}ms`);

    // Se status não for 200, retornar erro
    if (response.status !== 200) {
      log(`ERROR: API returned status ${response.status}`);
      
      // Tentar refresh token se 401
      if (response.status === 401) {
        log(`Attempting token refresh due to 401...`);
        // Aqui você implementaria refresh token
        // Por enquanto, apenas logar
      }

      return res.status(response.status).json({
        ok: false,
        error: `API_ERROR_${response.status}`,
        traceId,
        statusCode: response.status,
        endpointHit: `GET /v1/pessoas?limit=1`,
        logs,
      });
    }

    // Extrair evidência
    const items = response.data?.items || [];
    let evidence: any = null;

    if (items.length > 0) {
      const pessoa = items[0];
      log(`Full pessoa object: ${JSON.stringify(pessoa).substring(0, 500)}`);
      // Se documento estiver vazio, tentar extrair do nome (fallback)
      let docDigits = (pessoa.documento || '').replace(/\D/g, '');
      let nomeReal = pessoa.nomeFantasia || pessoa.nome || 'N/A';
      
      // Se documento vazio e nome parece ser um documento, usar nome como documento
      if (!docDigits && nomeReal && /^[0-9]{11,14}$/.test(nomeReal.replace(/\D/g, ''))) {
        docDigits = nomeReal.replace(/\D/g, '');
        nomeReal = 'N/A'; // Documento estava no campo nome
        log(`WARNING: documento estava no campo nome`);
      }
      
      // Mascarar documento: mostrar apenas os ultimos 2 digitos
      let docMascarado = '***';
      if (docDigits.length === 11) {
        // CPF: mascarar tudo exceto ultimos 2
        docMascarado = `***.***.***.${docDigits.substring(9)}`;
      } else if (docDigits.length === 14) {
        // CNPJ: mascarar tudo exceto ultimos 2
        docMascarado = `**.***.***/****-${docDigits.substring(12)}`;
      }

      evidence = {
        pessoaId: pessoa.id,
        nome: nomeReal,
        documentoMascarado: docMascarado,
      };
      log(`Evidence extracted: pessoaId=${pessoa.id}, nome=${pessoa.nome}`);
    }

    const timestamp = new Date().toISOString();

    // Adicionar headers anti-cache
    res.setHeader('Cache-Control', 'no-store');

    const probeResponse = {
      ok: true,
      source: 'contaazul',
      traceId,
      timestamp,
      endpointHit: 'GET /v1/pessoas?limit=1',
      statusCode: 200,
      evidence,
      latencyMs,
      logs,
    };

    log(`SUCCESS: Probe completed`);
    return res.status(200).json(probeResponse);

  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    log(`ERROR: ${error?.message}`);
    
    return res.status(500).json({
      ok: false,
      error: 'PROBE_FAILED',
      message: error?.message,
      traceId,
      latencyMs,
      logs,
    });
  }
});

export default router;
