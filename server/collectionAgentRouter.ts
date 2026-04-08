import { router, protectedProcedure, publicProcedure } from './_core/trpc';
import { z } from 'zod';
import {
  initializeCollectionAgent,
  getGreetingMessage,
  getDebtConsultationMessage,
  getRegularizationOptionsMessage,
  getDecisionInvitationMessage,
  processClientMessage,
  logConversationResult
} from './collectionAIAgent';

/**
 * Router para o Agente de IA de Cobrança
 * Gerencia conversas inteligentes via WhatsApp
 */

export const collectionAgentRouter = router({
  /**
   * Inicia conversa com cliente
   */
  startConversation: protectedProcedure
    .input(z.object({
      clientName: z.string(),
      clientCnpj: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        const context = await initializeCollectionAgent(input.clientName, input.clientCnpj);
        
        // Gerar saudação
        const greeting = getGreetingMessage(input.clientName);
        
        return {
          success: true,
          message: greeting,
          conversationId: `${input.clientCnpj}-${Date.now()}`
        };
      } catch (error) {
        console.error('Erro ao iniciar conversa:', error);
        return {
          success: false,
          message: 'Erro ao iniciar conversa. Cliente não encontrado.'
        };
      }
    }),

  /**
   * Processa mensagem do cliente
   */
  processMessage: protectedProcedure
    .input(z.object({
      conversationId: z.string(),
      clientCnpj: z.string(),
      clientMessage: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        // Inicializar contexto
        const context = await initializeCollectionAgent('', input.clientCnpj);
        
        // Processar mensagem
        const { response } = await processClientMessage(context, input.clientMessage);
        
        return {
          success: true,
          response: response,
          conversationId: input.conversationId
        };
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
        return {
          success: false,
          response: 'Desculpe, houve um erro ao processar sua mensagem. Tente novamente.'
        };
      }
    }),

  /**
   * Registra resultado da conversa
   */
  logOutcome: protectedProcedure
    .input(z.object({
      conversationId: z.string(),
      clientCnpj: z.string(),
      outcome: z.enum(['agreed', 'paid', 'no_response', 'rejected'])
    }))
    .mutation(async ({ input }) => {
      try {
        const context = await initializeCollectionAgent('', input.clientCnpj);
        await logConversationResult(context, input.outcome);
        
        return {
          success: true,
          message: 'Resultado registrado com sucesso'
        };
      } catch (error) {
        console.error('Erro ao registrar resultado:', error);
        return {
          success: false,
          message: 'Erro ao registrar resultado'
        };
      }
    })
});
