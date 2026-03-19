/**
 * tRPC Router para Comando Final de Disparo
 */

import { publicProcedure, router } from './_core/trpc';
import { runFinalDispatchCommand } from './finalDispatchCommand';

export const finalDispatchRouter = router({
  /**
   * Executa o comando final de disparo ponta-a-ponta
   * Valida todos os pré-requisitos e dispara o primeiro boleto real
   */
  execute: publicProcedure.query(async () => {
    console.log('[tRPC] 🚀 Executando comando final de disparo...');

    try {
      const result = await runFinalDispatchCommand();

      console.log('[tRPC] ✅ Comando executado');
      console.log('[tRPC] Resultado:', JSON.stringify(result, null, 2));

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('[tRPC] ❌ Erro:', errorMessage);

      return {
        success: false,
        prerequisites: [],
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }),
});
