/**
 * nfseCancelRouter.ts
 * Endpoint para cancelamento de NFS-e via ABRASF 2.03
 *
 * POST /api/nfse/cancelar
 * Body: { emissaoId: number, motivo?: string, adminKey?: string }
 * ou
 * Body: { numeroNfse: string, prestadorCnpj: string, prestadorIm: string, motivo?: string, adminKey?: string }
 */

import express from 'express';
import mysql from 'mysql2/promise';
import { cancelarViaSoap } from './services/abrasfService';

const router = express.Router();

// Código de cancelamento ABRASF: 1=Erro do contribuinte, 2=Serviço não prestado, 3=Duplicidade
const MOTIVO_CODE: Record<string, string> = {
  'erro': '1',
  'nao_prestado': '2',
  'duplicidade': '3',
};

function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

router.post('/cancelar', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
    if (adminKey !== 'Fraga@123') {
      return res.status(401).json({ success: false, message: 'Admin key inválida' });
    }

    const { emissaoId, numeroNfse: numeroNfseBody, prestadorCnpj: prestadorCnpjBody, prestadorIm: prestadorImBody, motivo } = req.body;
    const codigoCancelamento = MOTIVO_CODE[motivo || ''] || '2';

    let numeroNfse: string;
    let prestadorCnpj: string;
    let prestadorIm: string;
    let emissaoIdFinal: number | undefined;

    if (emissaoId) {
      // Buscar dados pelo emissaoId
      const conn = await getConn();
      try {
        const [rows] = await conn.execute(
          `SELECT e.numeroNf, e.status, c.cnpj, c.inscricaoMunicipal
           FROM nfse_emissoes e
           JOIN nfse_config c ON c.id = e.configId
           WHERE e.id = ?`,
          [emissaoId]
        ) as any[];

        const emissoes = rows as any[];
        if (!emissoes.length) {
          return res.status(404).json({ success: false, message: `Emissão ${emissaoId} não encontrada` });
        }

        const em = emissoes[0];
        if (!em.numeroNf) {
          return res.status(400).json({ success: false, message: 'Emissão não tem número de NFS-e para cancelar' });
        }
        if (em.status === 'cancelada') {
          return res.status(400).json({ success: false, message: 'Emissão já está cancelada' });
        }

        numeroNfse = em.numeroNf;
        prestadorCnpj = em.cnpj;
        prestadorIm = em.inscricaoMunicipal;
        emissaoIdFinal = emissaoId;
      } finally {
        await conn.end();
      }
    } else if (numeroNfseBody && prestadorCnpjBody && prestadorImBody) {
      numeroNfse = String(numeroNfseBody);
      prestadorCnpj = String(prestadorCnpjBody);
      prestadorIm = String(prestadorImBody);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Forneça emissaoId ou (numeroNfse + prestadorCnpj + prestadorIm)',
      });
    }

    console.log(`[CancelRouter] Cancelando NFS-e ${numeroNfse} — CNPJ: ${prestadorCnpj}`);

    const resultado = await cancelarViaSoap(prestadorCnpj, prestadorIm, numeroNfse, codigoCancelamento);

    if (resultado.success && emissaoIdFinal) {
      // Atualizar status no banco
      const conn = await getConn();
      try {
        await conn.execute(
          `UPDATE nfse_emissoes SET status = 'cancelada', erroDetalhes = ? WHERE id = ?`,
          [`Cancelada via ABRASF: ${resultado.mensagem}`, emissaoIdFinal]
        );
      } finally {
        await conn.end();
      }
    }

    return res.status(resultado.success ? 200 : 400).json({
      success: resultado.success,
      message: resultado.mensagem || resultado.erro,
      error: resultado.erro,
      xmlRetorno: resultado.xmlRetorno,
    });
  } catch (err: any) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[CancelRouter] Erro:', error);
    return res.status(500).json({ success: false, message: `Erro ao cancelar: ${error}` });
  }
});

/**
 * GET /api/nfse/cancelar-status/:emissaoId
 * Verifica se uma emissão pode ser cancelada
 */
router.get('/cancelar-status/:emissaoId', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== 'Fraga@123') {
      return res.status(401).json({ success: false, message: 'Admin key inválida' });
    }

    const conn = await getConn();
    try {
      const [rows] = await conn.execute(
        'SELECT id, status, numeroNf, configId FROM nfse_emissoes WHERE id = ?',
        [req.params.emissaoId]
      ) as any[];
      const emissoes = rows as any[];

      if (!emissoes.length) {
        return res.status(404).json({ success: false, message: 'Emissão não encontrada' });
      }

      const em = emissoes[0];
      const podeCancelar = em.status === 'emitida' && !!em.numeroNf;

      return res.json({
        success: true,
        emissaoId: em.id,
        status: em.status,
        numeroNf: em.numeroNf,
        podeCancelar,
        motivo: podeCancelar ? undefined : (em.status === 'cancelada' ? 'Já cancelada' : 'Sem número de NFS-e'),
      });
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
