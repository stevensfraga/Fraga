import mysql from 'mysql2/promise';
import { ENV } from '../_core/env';

interface AtivarConsultaResult {
  cnpj: string;
  companyName: string;
  siegId: string;
  success: boolean;
  message: string;
  timestamp: string;
}

interface AtivarConsultaStats {
  total: number;
  ativados: number;
  jaAtivos: number;
  erros: number;
  results: AtivarConsultaResult[];
}

/**
 * Ativa consulta fiscal (NFe, NFS-e, CTe, NFC-e, Noturna) para todos os certificados válidos
 * Certificados considerados válidos: status IN ('valid', 'expiring_30', 'expiring_7')
 * E que já foram enviados para SIEG: sieg_id IS NOT NULL AND sieg_status = 'sent'
 */
export async function ativarConsultaFiscalSieg(): Promise<AtivarConsultaStats> {
  const stats: AtivarConsultaStats = {
    total: 0,
    ativados: 0,
    jaAtivos: 0,
    erros: 0,
    results: []
  };

  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL não configurada');
    }

    const connection = await mysql.createConnection(dbUrl);

    // Buscar certificados válidos com sieg_id
    const [rows] = await connection.execute(
      `SELECT id, cnpj, company_name, sieg_id, status
       FROM certificates
       WHERE status IN ('valid', 'expiring_30', 'expiring_7')
       AND sieg_id IS NOT NULL
       AND sieg_status = 'sent'
       AND is_active = 1
       ORDER BY valid_to DESC`
    ) as [any[], any];

    const certificates = rows as any[];
    stats.total = certificates.length;

    console.log(`[AtivarConsultaFiscal] Total de certificados para ativar: ${stats.total}`);

    const apiKey = ENV.siegApiKey;
    if (!apiKey) {
      throw new Error('SIEG_API_KEY não configurada');
    }

    // Processar cada certificado
    for (const cert of certificates) {
      try {
        console.log(`[AtivarConsultaFiscal] Processando CNPJ ${cert.cnpj} (${cert.company_name})`);

        // Payload para ativar todos os módulos fiscais
        const payload = {
          Id: cert.sieg_id,
          ConsultaNfe: true,
          ConsultaNfse: 'Municipal',  // Usar modelo municipal
          ConsultaCte: true,
          ConsultaNfce: true,
          BaixarCancelados: true,
          ConsultaNoturna: true
        };

        // Enviar para SIEG via /Editar
        const url = `https://api.sieg.com/api/Certificado/Editar?api_key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });

        const rawText = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          // Resposta não é JSON
        }

        console.log(`[AtivarConsultaFiscal] SIEG Response (${cert.cnpj}):`, {
          status: response.status,
          response: rawText.substring(0, 200),
        });

        if (response.ok) {
          stats.ativados++;
          console.log(`[AtivarConsultaFiscal] ✅ CNPJ ${cert.cnpj} - Consulta fiscal ativada`);

          stats.results.push({
            cnpj: cert.cnpj,
            companyName: cert.company_name,
            siegId: cert.sieg_id,
            success: true,
            message: 'Consulta fiscal ativada com sucesso',
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
            stats.jaAtivos++;
            console.log(`[AtivarConsultaFiscal] ⏳ CNPJ ${cert.cnpj} - Já estava ativo`);

            stats.results.push({
              cnpj: cert.cnpj,
              companyName: cert.company_name,
              siegId: cert.sieg_id,
              success: true,
              message: 'Já estava ativo',
              timestamp: new Date().toISOString()
            });
          } else {
            stats.erros++;
            const errorMsg = rawText.substring(0, 200);
            console.error(`[AtivarConsultaFiscal] ❌ CNPJ ${cert.cnpj} - Erro: ${errorMsg}`);

            stats.results.push({
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
        stats.erros++;
        const errorMsg = err?.message || String(err);
        console.error(`[AtivarConsultaFiscal] ❌ CNPJ ${cert.cnpj} - Exceção: ${errorMsg}`);

        stats.results.push({
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

    console.log(`
[AtivarConsultaFiscal] 📊 RESUMO FINAL
- Total processado: ${stats.total}
- Ativados: ${stats.ativados}
- Já ativos: ${stats.jaAtivos}
- Erros: ${stats.erros}
    `);

    return stats;
  } catch (err: any) {
    console.error('[AtivarConsultaFiscal] Erro fatal:', err);
    throw err;
  }
}
