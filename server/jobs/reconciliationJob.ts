/**
 * Job de Reconciliação Automática Conta Azul × Banco Local
 * Executa diariamente às 06:40 (antes do sync de pagamentos às 06:50)
 * 
 * Fluxo:
 * 1. Busca receivables no CA (janela 365 dias)
 * 2. Compara totais CA vs DB
 * 3. Detecta órfãos e divergências
 * 4. Gera alerta se diff > 1%
 * 5. Registra auditoria completa
 */

import * as cron from 'node-cron';
import { runReconciliation } from '../services/reconciliationService';

const logger = {
  log: (msg: string) => console.log(`[ReconciliationJob] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ReconciliationJob] ❌ ${msg}`, err?.message || ''),
};

let reconciliationJobHandle: cron.ScheduledTask | null = null;

/**
 * Iniciar o job de reconciliação
 * Executa diariamente às 06:40 (seg-sex)
 */
export function startReconciliationJob() {
  if (reconciliationJobHandle) {
    logger.log('Job já está rodando');
    return;
  }

  // Cron: 40 06 * * 1-5 (06:40 seg-sex)
  // Minuto 40, hora 06, qualquer dia, qualquer mês, seg-sex (1-5)
  reconciliationJobHandle = cron.schedule('40 06 * * 1-5', async () => {
    logger.log('Iniciando reconciliação automática...');
    
    try {
      const result = await runReconciliation();

      // Log do resultado
      logger.log(`✅ Reconciliação concluída`);
      logger.log(`   CA: R$ ${result.caTotal.toFixed(2)} (${result.caCount} títulos)`);
      logger.log(`   DB: R$ ${result.dbTotal.toFixed(2)} (${result.dbCount} títulos)`);
      logger.log(`   Diff: R$ ${result.diffValue.toFixed(2)} (${result.diffPercent.toFixed(2)}%)`);
      logger.log(`   Órfãos: ${result.orphanCount}`);
      logger.log(`   Status divergentes: ${result.statusMismatchCount}`);
      logger.log(`   Valores divergentes: ${result.valueMismatchCount}`);

      if (result.isAlerted) {
        logger.log(`   ⚠️ ALERTA GERADO: ${result.alertMessage}`);
      }

      // TODO: Enviar alerta WhatsApp para gestor se isAlerted
    } catch (error) {
      logger.error('Erro na reconciliação', error);
    }
  });

  logger.log('✅ Job de reconciliação iniciado (06:40 seg-sex)');
}

/**
 * Parar o job de reconciliação
 */
export function stopReconciliationJob() {
  if (reconciliationJobHandle) {
    reconciliationJobHandle.stop();
    reconciliationJobHandle = null;
    logger.log('Job de reconciliação parado');
  }
}

/**
 * Executar reconciliação manualmente (para testes)
 */
export async function runReconciliationManually() {
  logger.log('Executando reconciliação manual...');
  
  try {
    const result = await runReconciliation();
    logger.log('✅ Reconciliação manual concluída');
    return result;
  } catch (error) {
    logger.error('Erro na reconciliação manual', error);
    throw error;
  }
}
