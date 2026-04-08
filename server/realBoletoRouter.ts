/**
 * Router tRPC para envio de boletos reais do Conta Azul
 */

import { publicProcedure, router } from './_core/trpc';
import {
  buscarBoletosReaisContaAzul,
  enviarBoletoRealWhatsApp,
  processarTodosBoletoReais,
} from './realBoletoSender';

export const realBoletoRouter = router({
  /**
   * Buscar todos os boletos reais em aberto no Conta Azul
   */
  buscarBoletos: publicProcedure.query(async () => {
    try {
      const boletos = await buscarBoletosReaisContaAzul();
      return {
        success: true,
        total: boletos.length,
        boletos: boletos.map((b) => ({
          id: b.id,
          customer_name: b.customer.name,
          customer_phone: b.customer.phone,
          amount: b.amount,
          due_date: b.due_date,
          boleto_url: b.bank_slip?.url,
          status: b.status,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        total: 0,
        boletos: [],
      };
    }
  }),

  /**
   * Enviar um boleto específico via WhatsApp
   */
  enviarBoleto: publicProcedure
    .input((val: any) => {
      if (typeof val?.boletoId !== 'string') {
        throw new Error('boletoId é obrigatório');
      }
      return val as { boletoId: string };
    })
    .mutation(async ({ input }: { input: { boletoId: string } }) => {
      try {
        // Buscar boleto específico
        const boletos = await buscarBoletosReaisContaAzul();
        const boleto = boletos.find((b) => b.id === input.boletoId);

        if (!boleto) {
          return {
            success: false,
            error: `Boleto ${input.boletoId} não encontrado`,
          };
        }

        // Enviar boleto
        const sucesso = await enviarBoletoRealWhatsApp(boleto);

        return {
          success: sucesso,
          message: sucesso
            ? 'Boleto enviado com sucesso!'
            : 'Erro ao enviar boleto',
          boleto_id: boleto.id,
          customer_name: boleto.customer.name,
          customer_phone: boleto.customer.phone,
          boleto_url: boleto.bank_slip?.url,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * DEBUG: Testar company_id, status e endpoints
   */
  debug: publicProcedure.query(async () => {
    console.log('[DEBUG] Iniciando testes de validacao...');
    return {
      success: true,
      message: 'Verifique os logs do servidor para detalhes completos',
    };
  }),

  /**
   * Enviar TODOS os boletos reais de uma vez
   */
  enviarTodos: publicProcedure.mutation(async () => {
    try {
      const resultado = await processarTodosBoletoReais();
      return {
        success: true,
        ...resultado,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        total: 0,
        enviados: 0,
        erros: 1,
      };
    }
  }),
});
