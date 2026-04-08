/**
 * Job automático para envio de cobranças da R7 GERADORES
 * Executa diariamente às 09:00 (horário comercial)
 */

import * as cron from 'node-cron';
import { processarCobrancasR7 } from './r7GeradorasCollectionManager';

let job: cron.ScheduledTask | null = null;

/**
 * Inicializar job de cobrança da R7
 * Executa diariamente às 09:00 (segunda a sexta)
 */
export function initializeR7CollectionJob() {
  if (job) {
    console.log('[R7 Job] ⚠️  Job já está em execução');
    return;
  }

  // Cron: 0 9 * * 1-5 (09:00, segunda a sexta)
  job = cron.schedule('0 9 * * 1-5', async () => {
    console.log('[R7 Job] 🚀 Iniciando job de cobrança da R7 GERADORES...');

    try {
      const resultado = await processarCobrancasR7();

      console.log('[R7 Job] ✅ Job concluído com sucesso!');
      console.log(`[R7 Job] Total: ${resultado.total}`);
      console.log(`[R7 Job] Enviados: ${resultado.enviados}`);
      console.log(`[R7 Job] Erros: ${resultado.erros}`);
    } catch (error: any) {
      console.error('[R7 Job] ❌ Erro ao executar job:', error.message);
    }
  });

  console.log('[R7 Job] ✅ Job de cobrança da R7 GERADORES inicializado');
  console.log('[R7 Job] ⏰ Executa diariamente às 09:00 (segunda a sexta)');
}

/**
 * Parar job de cobrança da R7
 */
export function stopR7CollectionJob() {
  if (job) {
    job.stop();
    job = null;
    console.log('[R7 Job] ⏹️  Job de cobrança da R7 GERADORES parado');
  }
}

/**
 * Testar job manualmente (executa imediatamente)
 */
export async function testR7CollectionJob() {
  console.log('[R7 Job] 🧪 Testando job de cobrança da R7 GERADORES...');

  try {
    const resultado = await processarCobrancasR7();

    console.log('[R7 Job] ✅ Teste concluído com sucesso!');
    return resultado;
  } catch (error: any) {
    console.error('[R7 Job] ❌ Erro ao testar job:', error.message);
    throw error;
  }
}
