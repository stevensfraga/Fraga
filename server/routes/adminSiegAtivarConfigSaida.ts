/**
 * adminSiegAtivarConfigSaida.ts
 * 
 * Endpoint: POST /api/admin/sieg-ativar-config-saida
 * 
 * Ativa a "Configuração de Saída" (módulos fiscais) para todos os certificados válidos
 * que já foram enviados para SIEG (sieg_id IS NOT NULL AND sieg_status = 'sent')
 * 
 * Isso habilita:
 * - Consulta NFe (Nota Fiscal Eletrônica)
 * - Consulta CTe (Conhecimento de Transporte Eletrônico)
 * - Consulta NFS-e (Nota Fiscal de Serviço Eletrônica)
 * - Consulta NFC-e (Nota Fiscal do Consumidor Eletrônica)
 * - Consulta Noturna (fora do horário comercial)
 * - Baixar Cancelados
 */

import { Router, Request, Response } from 'express';
import mysql from 'mysql2/promise';

const router = Router();

interface ConfigSaidaResult {
  cnpj: string;
  companyName: string;
  siegId: string;
  success: boolean;
  message: string;
  timestamp: string;
}

interface ConfigSaidaResponse {
  success: boolean;
  total: number;
  ativados: number;
  jaAtivos: number;
  erros: number;
  results: ConfigSaidaResult[];
  duration: number;
}

/**
 * POST /api/admin/sieg-ativar-config-saida
 * 
 * Ativa configuração de saída para todos os certificados válidos
 */
router.post('/sieg-ativar-config-saida', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const adminKey = req.headers['x-admin-key'] || req.body.adminKey;

  // Validar chave admin
  if (adminKey !== process.env.FRAGA_ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const response: ConfigSaidaResponse = {
    success: false,
    total: 0,
    ativados: 0,
    jaAtivos: 0,
    erros: 0,
    results: [],
    duration: 0
  };

  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return res.status(500).json({ error: 'DATABASE_URL não configurada' });
    }

    const connection = await mysql.createConnection(dbUrl);

    // Buscar TODOS os certificados com sieg_id (sem nenhum filtro)
    const [rows] = await connection.execute(
      `SELECT id, cnpj, company_name, sieg_id, status
       FROM certificates
       WHERE sieg_id IS NOT NULL
       ORDER BY valid_to DESC`
    ) as [any[], any];

    const certificates = rows as any[];
    response.total = certificates.length;

    console.log(`[AdminSiegConfigSaida] Total de certificados para ativar: ${response.total}`);

    const apiKey = process.env.SIEG_API_KEY;
    if (!apiKey) {
      await connection.end();
      return res.status(500).json({ error: 'SIEG_API_KEY não configurada' });
    }

    // Processar cada certificado
    for (const cert of certificates) {
      try {
        console.log(`[AdminSiegConfigSaida] Processando CNPJ ${cert.cnpj} (${cert.company_name})`);

        // Payload para ativar configuração de saída (todos os módulos fiscais)
        // IMPORTANTE: SIEG usa "CertificadoId" (não "Id") para edição
        const payload = {
          CertificadoId: cert.sieg_id,
          ConsultaNfe: true,           // NFe
          ConsultaCte: true,           // CTe
          ConsultaNfse: true,          // NFS-e
          ConsultaNfce: true,          // NFC-e
          BaixarCancelados: true,      // Baixar notas canceladas
          ConsultaNoturna: true        // Consulta noturna
        };

        // Enviar para SIEG via /Editar
        const url = `https://api.sieg.com/api/Certificado/Editar?api_key=${encodeURIComponent(apiKey)}`;
        const response_sieg = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });

        const rawText = await response_sieg.text();
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          // Resposta não é JSON
        }

        console.log(`[AdminSiegConfigSaida] SIEG Response (${cert.cnpj}):`, {
          status: response_sieg.status,
          response: rawText.substring(0, 200),
        });

        if (response_sieg.ok) {
          response.ativados++;
          console.log(`[AdminSiegConfigSaida] ✅ CNPJ ${cert.cnpj} - Config. de Saída ativada`);

          response.results.push({
            cnpj: cert.cnpj,
            companyName: cert.company_name,
            siegId: cert.sieg_id,
            success: true,
            message: 'Configuração de Saída ativada com sucesso',
            timestamp: new Date().toISOString()
          });

          // Atualizar banco local com timestamp
          await connection.execute(
            `UPDATE certificates 
             SET sieg_synced_at = NOW()
             WHERE id = ?`,
            [cert.id]
          );
        } else {
          // Verificar se já estava ativo
          if (rawText.toLowerCase().includes('já') || rawText.toLowerCase().includes('ativo')) {
            response.jaAtivos++;
            console.log(`[AdminSiegConfigSaida] ⏳ CNPJ ${cert.cnpj} - Já estava ativo`);

            response.results.push({
              cnpj: cert.cnpj,
              companyName: cert.company_name,
              siegId: cert.sieg_id,
              success: true,
              message: 'Já estava ativo',
              timestamp: new Date().toISOString()
            });
          } else {
            response.erros++;
            const errorMsg = rawText.substring(0, 200);
            console.error(`[AdminSiegConfigSaida] ❌ CNPJ ${cert.cnpj} - Erro: ${errorMsg}`);

            response.results.push({
              cnpj: cert.cnpj,
              companyName: cert.company_name,
              siegId: cert.sieg_id,
              success: false,
              message: errorMsg,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (err: any) {
        response.erros++;
        const errorMsg = err?.message || String(err);
        console.error(`[AdminSiegConfigSaida] ❌ CNPJ ${cert.cnpj} - Exceção: ${errorMsg}`);

        response.results.push({
          cnpj: cert.cnpj,
          companyName: cert.company_name,
          siegId: cert.sieg_id,
          success: false,
          message: errorMsg,
          timestamp: new Date().toISOString()
        });
      }

      // Aguardar 200ms entre requisições
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await connection.end();

    response.success = true;
    response.duration = Date.now() - startTime;

    console.log(`
[AdminSiegConfigSaida] 📊 RESUMO FINAL
- Total processado: ${response.total}
- Ativados: ${response.ativados}
- Já ativos: ${response.jaAtivos}
- Erros: ${response.erros}
- Duração: ${response.duration}ms
    `);

    return res.json(response);
  } catch (err: any) {
    console.error('[AdminSiegConfigSaida] Erro fatal:', err);
    response.duration = Date.now() - startTime;
    return res.status(500).json({
      ...response,
      error: err?.message || String(err)
    });
  }
});

export default router;
