import express from 'express';
import { emitNfse } from './services/nfseEmissionEngine';
import mysql from 'mysql2/promise';

const router = express.Router();

/**
 * POST /api/nfse/emit-real
 * 
 * Endpoint para testar emissão real de NFS-e com uma empresa piloto
 * 
 * Body:
 * {
 *   "emissaoId": 1,  // ID da emissão no banco (nfse_emissoes)
 *   "adminKey": "Fraga@123"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "numeroNfse": "123456",
 *   "serieNfse": "1",
 *   "pdfUrl": "https://...",
 *   "logs": [...],
 *   "screenshotUrl": "https://...",
 *   "message": "NFS-e emitida com sucesso"
 * }
 */
router.post('/emit-real', async (req, res) => {
  try {
    console.log('[NfseRealEmissionRouter] POST /emit-real recebido');
    console.log('[NfseRealEmissionRouter] Body:', JSON.stringify(req.body));
    console.log('[NfseRealEmissionRouter] Headers:', JSON.stringify(req.headers));

    const { emissaoId } = req.body;
    const adminKeyHeader = req.headers['x-admin-key'];
    const adminKeyBody = req.body.adminKey;
    const adminKey = adminKeyHeader || adminKeyBody;

    console.log('[NfseRealEmissionRouter] Admin key (header):', adminKeyHeader);
    console.log('[NfseRealEmissionRouter] Admin key (body):', adminKeyBody);
    console.log('[NfseRealEmissionRouter] Admin key (final):', adminKey);

    // Validar admin key
    if (adminKey !== 'Fraga@123') {
      console.log('[NfseRealEmissionRouter] ❌ Admin key inválida');
      return res.status(401).json({
        success: false,
        message: 'Admin key inválida',
      });
    }
    console.log('[NfseRealEmissionRouter] ✅ Admin key validada');

    if (!emissaoId) {
      console.log('[NfseRealEmissionRouter] ❌ emissaoId não fornecido');
      return res.status(400).json({
        success: false,
        message: 'emissaoId é obrigatório',
      });
    }
    console.log('[NfseRealEmissionRouter] emissaoId:', emissaoId);

    // Executar emissão
    console.log('[NfseRealEmissionRouter] Chamando emitNfse...');
    const result = await emitNfse(emissaoId);
    console.log('[NfseRealEmissionRouter] emitNfse retornou:', JSON.stringify(result).substring(0, 500));

    // Retornar resultado
    console.log('[NfseRealEmissionRouter] Retornando resultado:', result.success ? '✅ SUCESSO' : '❌ ERRO');
    return res.status(result.success ? 200 : 400).json({
      success: result.success,
      status: result.success ? 'emitida' : 'erro',
      numeroNfse: result.numeroNfse,
      serieNfse: result.serieNfse,
      pdfUrl: result.pdfUrl,
      screenshotUrl: result.screenshotUrl,
      logs: result.logs,
      message: result.error || 'NFS-e emitida com sucesso',
      error: result.error,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log('[NfseRealEmissionRouter] ❌ Erro:', error);
    console.log('[NfseRealEmissionRouter] Stack:', err instanceof Error ? err.stack : 'N/A');
    return res.status(500).json({
      success: false,
      message: `Erro ao emitir NFS-e: ${error}`,
      error,
    });
  }
});

/**
 * GET /api/nfse/emit-status/:emissaoId
 * 
 * Verificar status de uma emissão
 */
router.get('/emit-status/:emissaoId', async (req, res) => {
  try {
    const { emissaoId } = req.params;

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      const [rowsResult] = await conn.execute(
        'SELECT id, status, numeroNfse, serieNfse, pdfUrl, createdAt, updatedAt FROM nfse_emissoes WHERE id = ?',
        [emissaoId]
      );

      const rows = rowsResult as any[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Emissão ${emissaoId} não encontrada`,
        });
      }

      const emissao = rows[0] as any;

      return res.status(200).json({
        success: true,
        emissao: {
          id: emissao.id,
          status: emissao.status,
          numeroNfse: emissao.numeroNfse,
          serieNfse: emissao.serieNfse,
          pdfUrl: emissao.pdfUrl,
          createdAt: emissao.createdAt,
          updatedAt: emissao.updatedAt,
        },
      });
    } finally {
      await conn.end();
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      message: `Erro ao buscar status: ${error}`,
      error,
    });
  }
});

/**
 * GET /api/nfse/test-data
 * 
 * Retornar dados de teste para criar uma emissão piloto
 */
router.get('/test-data', async (req, res) => {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      // Buscar uma config de teste (prestador)
      const [configsResult] = await conn.execute(
        'SELECT id, razaoSocial, cnpj, im FROM nfse_config LIMIT 1'
      );

      const configs = configsResult as any[];
      if (!Array.isArray(configs) || configs.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Nenhuma configuração de prestador encontrada. Configure um prestador em NFS-e > Configurações.',
        });
      }

      const config = configs[0] as any;

      // Buscar um tomador de teste
      const [tomadores] = await conn.execute(
        'SELECT id, nomeRazaoSocial, cpfCnpj, endereco, numero, complemento, bairro, cep, cidade, uf FROM nfse_tomadores LIMIT 1'
      );

      const tomador = Array.isArray(tomadores) && tomadores.length > 0 ? (tomadores[0] as any) : null;

      return res.status(200).json({
        success: true,
        testData: {
          prestador: {
            id: config.id,
            razaoSocial: config.razaoSocial,
            cnpj: config.cnpj,
            im: config.im,
          },
          tomador: tomador ? {
            id: tomador.id,
            nomeRazaoSocial: tomador.nomeRazaoSocial,
            cpfCnpj: tomador.cpfCnpj,
            endereco: tomador.endereco,
            numero: tomador.numero,
            complemento: tomador.complemento,
            bairro: tomador.bairro,
            cep: tomador.cep,
            cidade: tomador.cidade,
            uf: tomador.uf,
          } : null,
          instruction: tomador 
            ? 'Use os dados acima para criar uma emissão de teste'
            : 'Nenhum tomador encontrado. Cadastre um tomador em NFS-e > Tomadores antes de testar.',
        },
      });
    } finally {
      await conn.end();
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      message: `Erro ao buscar dados de teste: ${error}`,
      error,
    });
  }
});

export default router;
