import express from 'express';
import mysql from 'mysql2/promise';
import { getEmissionLogs } from './services/nfseEmissionLogger';

const router = express.Router();

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/**
 * GET /api/nfse/diagnostic/:emissaoId
 * Retorna diagnóstico completo de uma emissão com todos os logs, payloads, screenshots e HTML
 */
router.get('/diagnostic/:emissaoId', async (req, res) => {
  try {
    const emissaoId = parseInt(req.params.emissaoId, 10);
    
    if (isNaN(emissaoId)) {
      return res.status(400).json({ error: 'emissaoId inválido' });
    }

    const conn = await getConn();

    try {
      // 1. Buscar emissão
      const [emissoes] = await conn.execute(
        `SELECT id, configId, tomadorId, tomadorNome, tomadorCpfCnpj, 
                descricaoServico, valor, competencia, numeroNf, codigoVerificacao,
                status, pdfUrl, pdfStorageKey, erroDetalhes, solicitadoPor, solicitadoVia,
                processadoEm, createdAt, updatedAt 
         FROM nfse_emissoes WHERE id = ?`,
        [emissaoId]
      );

      if (!Array.isArray(emissoes) || emissoes.length === 0) {
        return res.status(404).json({ error: 'Emissão não encontrada' });
      }

      const emissao = emissoes[0] as any;

      // 2. Buscar logs detalhados
      const [logsData] = await conn.execute(
        `SELECT id, emissaoId, step, status, message, payload, screenshot_url, html_url, error_details, timestamp
         FROM nfse_emissao_logs
         WHERE emissaoId = ?
         ORDER BY timestamp ASC`,
        [emissaoId]
      );

      const logs = (logsData as any[]).map(log => ({
        id: log.id,
        step: log.step,
        status: log.status,
        message: log.message,
        payload: log.payload ? JSON.parse(log.payload) : null,
        screenshot_url: log.screenshot_url,
        html_url: log.html_url,
        error_details: log.error_details,
        timestamp: log.timestamp
      }));

      // 3. Analisar etapas completadas
      const stepsCompleted = logs
        .filter(l => l.status === 'ok')
        .map(l => l.step);

      const stepsWithErrors = logs
        .filter(l => l.status === 'error')
        .map(l => ({ step: l.step, message: l.message }));

      // 4. Identificar último erro
      const lastError = logs.reverse().find(l => l.status === 'error');

      // 5. Extrair mensagens do portal
      const portalMessages = logs
        .filter(l => l.payload?.pageMessages)
        .flatMap(l => l.payload.pageMessages)
        .filter((msg: string) => msg && msg.length > 0);

      // 6. Extrair valores do formulário
      const formValues = logs
        .find(l => l.payload?.formValues)?.payload?.formValues || {};

      // 7. Classificar tipo de erro
      let errorType = 'desconhecido';
      const errorStr = (emissao.erroDetalhes || lastError?.message || '').toLowerCase();

      if (errorStr.includes('captcha')) {
        errorType = 'CAPTCHA';
      } else if (errorStr.includes('login') || errorStr.includes('autenticação')) {
        errorType = 'LOGIN';
      } else if (errorStr.includes('empresa') || errorStr.includes('cnpj')) {
        errorType = 'SELEÇÃO_EMPRESA';
      } else if (errorStr.includes('campo') || errorStr.includes('obrigatório')) {
        errorType = 'CAMPO_OBRIGATÓRIO';
      } else if (errorStr.includes('validação')) {
        errorType = 'VALIDAÇÃO_PORTAL';
      } else if (errorStr.includes('submit') || errorStr.includes('envio')) {
        errorType = 'SUBMIT';
      } else if (errorStr.includes('número') || errorStr.includes('nfse')) {
        errorType = 'CAPTURA_NÚMERO';
      } else if (errorStr.includes('timeout')) {
        errorType = 'TIMEOUT_NAVEGADOR';
      } else if (errorStr.includes('sessão') || errorStr.includes('session')) {
        errorType = 'SESSÃO_EXPIRADA';
      } else if (errorStr.includes('falha ao concluir')) {
        errorType = 'FALHA_PORTAL_GENÉRICA';
      }

      // 8. Montar resposta completa
      const diagnostic = {
        emissao: {
          id: emissao.id,
          configId: emissao.configId,
          tomador: {
            id: emissao.tomadorId,
            nome: emissao.tomadorNome,
            cpfCnpj: emissao.tomadorCpfCnpj
          },
          descricao: emissao.descricaoServico,
          valor: emissao.valor,
          competencia: emissao.competencia,
          status: emissao.status,
          numeroNf: emissao.numeroNf,
          pdfUrl: emissao.pdfUrl,
          erroDetalhes: emissao.erroDetalhes,
          createdAt: emissao.createdAt,
          updatedAt: emissao.updatedAt,
          duracao: emissao.updatedAt && emissao.createdAt 
            ? new Date(emissao.updatedAt).getTime() - new Date(emissao.createdAt).getTime()
            : null
        },
        logs: logs,
        summary: {
          totalLogs: logs.length,
          stepsCompleted,
          stepsWithErrors,
          lastError: lastError ? {
            step: lastError.step,
            message: lastError.message,
            timestamp: lastError.timestamp,
            screenshot: lastError.screenshot_url,
            html: lastError.html_url
          } : null,
          errorType,
          portalMessages: Array.from(new Set(portalMessages)),
          formValues: formValues
        }
      };

      res.json(diagnostic);
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    console.error('[NfseDiagnostic] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/nfse/diagnostic/:emissaoId/logs
 * Retorna apenas os logs da emissão
 */
router.get('/diagnostic/:emissaoId/logs', async (req, res) => {
  try {
    const emissaoId = parseInt(req.params.emissaoId, 10);
    
    if (isNaN(emissaoId)) {
      return res.status(400).json({ error: 'emissaoId inválido' });
    }

    const logs = await getEmissionLogs(emissaoId);
    
    res.json({
      emissaoId,
      totalLogs: logs.length,
      logs: logs.map(log => ({
        step: log.step,
        status: log.status,
        message: log.message,
        screenshot_url: log.screenshot_url,
        html_url: log.html_url,
        error_details: log.error_details
      }))
    });
  } catch (err: any) {
    console.error('[NfseDiagnostic] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/nfse/diagnostic/:emissaoId/payload
 * Retorna o payload completo da emissão
 */
router.get('/diagnostic/:emissaoId/payload', async (req, res) => {
  try {
    const emissaoId = parseInt(req.params.emissaoId, 10);
    
    if (isNaN(emissaoId)) {
      return res.status(400).json({ error: 'emissaoId inválido' });
    }

    const logs = await getEmissionLogs(emissaoId);
    const payloads = logs
      .filter(l => l.payload)
      .map(l => ({
        step: l.step,
        payload: l.payload
      }));
    
    res.json({
      emissaoId,
      payloads
    });
  } catch (err: any) {
    console.error('[NfseDiagnostic] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
