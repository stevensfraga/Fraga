import mysql from 'mysql2/promise';
import { uploadCertificadoSieg } from '../services/siegService.js';

interface ConsultationResult {
  cnpj: string;
  nome: string;
  success: boolean;
  message: string;
  timestamp: string;
}

interface ConsultationStats {
  total: number;
  activated: number;
  alreadyConfigured: number;
  errors: number;
  results: ConsultationResult[];
}

/**
 * Habilita consulta fiscal completa para todos os certificados ativos no SIEG
 * Ativa: ConsultaNfe, ConsultaCte, ConsultaNfse, ConsultaNfce, ConsultaNoturna, BaixarCancelados
 */
export async function enableFullFiscalConsultation(): Promise<ConsultationStats> {
  const stats: ConsultationStats = {
    total: 0,
    activated: 0,
    alreadyConfigured: 0,
    errors: 0,
    results: []
  };

  try {
    // Conectar ao banco de dados
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL não configurada');
    }
    const connection = await mysql.createConnection(dbUrl);

    // Buscar todos os certificados com sieg_status = 'sent'
    const [rows] = await connection.execute(
      `SELECT id, cnpj, company_name, sieg_id, file_path
       FROM certificates
       WHERE sieg_status = 'sent'
       AND is_active = 1
       ORDER BY valid_to DESC`
    ) as [any[], any];

    const certificates = rows as any[];
    stats.total = certificates.length;

    console.log(`[EnableFullFiscal] Total de certificados para processar: ${stats.total}`);

    // Processar cada certificado
    for (const cert of certificates) {
      try {
        console.log(`[EnableFullFiscal] Processando CNPJ ${cert.cnpj} (${cert.nome})`);

        // Preparar payload com todas as consultas habilitadas
        const consultaPayload = JSON.stringify({
          consultaNfe: true,
          consultaCte: true,
          consultaNfse: true,
          consultaNfce: true,
          consultaNoturna: true,
          baixarCancelados: true
        });

        // Ler arquivo PFX do disco
        const fs = await import('fs');
        if (!fs.default.existsSync(cert.file_path)) {
          throw new Error(`Arquivo não encontrado: ${cert.file_path}`);
        }
        const pfxBuffer = fs.default.readFileSync(cert.file_path);

        // Tentar senhas em ordem
        const passwordList = [
          process.env.CERT_PASSWORD_DEFAULT || 'Fraga@123',
          'abc123',
          'Abcd@1234',
          'Contabil1'
        ];
        let uploadResult = null;
        for (const pwd of passwordList) {
          try {
            uploadResult = await uploadCertificadoSieg(
              cert.cnpj,
              cert.company_name || cert.cnpj,
              pfxBuffer,
              pwd
            );
            if (uploadResult.success) break;
          } catch (e) {
            // Tentar próxima senha
          }
        }
        const result = uploadResult || { success: false, error: 'Nenhuma senha funcionou' };

        if (result.success) {
          stats.activated++;
          console.log(`[EnableFullFiscal] ✅ CNPJ ${cert.cnpj} - Consulta fiscal ativada`);
          
            stats.results.push({
              cnpj: cert.cnpj,
              nome: cert.company_name,
              success: true,
              message: 'Consulta fiscal completa ativada',
              timestamp: new Date().toISOString()
            });

          // Atualizar banco local com timestamp de sincronização
          await connection.execute(
            `UPDATE certificates 
             SET sieg_synced_at = NOW()
             WHERE id = ?`,
            [cert.id]
          );
        } else {
          // Verificar se já estava configurado
          if (result.error?.includes('já cadastrado') || result.error?.includes('configurado')) {
            stats.alreadyConfigured++;
            console.log(`[EnableFullFiscal] ⏳ CNPJ ${cert.cnpj} - Já configurado`);
            
            stats.results.push({
              cnpj: cert.cnpj,
              nome: cert.company_name,
              success: true,
              message: 'Já estava configurado',
              timestamp: new Date().toISOString()
            });
          } else {
            stats.errors++;
            console.error(`[EnableFullFiscal] ❌ CNPJ ${cert.cnpj} - Erro: ${result.error}`);
            
            stats.results.push({
              cnpj: cert.cnpj,
              nome: cert.company_name,
              success: false,
              message: result.error || 'Erro desconhecido',
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (err: any) {
        stats.errors++;
        const errorMsg = err?.message || String(err);
        console.error(`[EnableFullFiscal] ❌ CNPJ ${cert.cnpj} - Exceção: ${errorMsg}`);
        
        stats.results.push({
          cnpj: cert.cnpj,
          nome: cert.company_name,
          success: false,
          message: errorMsg,
          timestamp: new Date().toISOString()
        });
      }

      // Aguardar 200ms entre requisições para não sobrecarregar
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    await connection.end();

    console.log(`
[EnableFullFiscal] 📊 RESUMO FINAL
- Total processado: ${stats.total}
- Ativados: ${stats.activated}
- Já configurados: ${stats.alreadyConfigured}
- Erros: ${stats.errors}
    `);

    return stats;
  } catch (err: any) {
    console.error('[EnableFullFiscal] Erro fatal:', err);
    throw err;
  }
}
