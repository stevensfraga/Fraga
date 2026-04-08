/**
 * Router tRPC para gerenciar cobranças da R7 GERADORES
 * Endpoints: /api/trpc/r7Geradores.*
 * Fonte de verdade: Banco de dados local (tabela receivables)
 */

import { publicProcedure, router } from './_core/trpc';
import {
  formatarMensagemCobranca,
  enviarCobrancaWhatsApp,
} from './r7GeradorasCollectionManager';
import { z } from 'zod';
import { getDb } from './db';
import { receivables, clients } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

export const r7GeradorasRouter = router({
  /**
   * Buscar boletos em aberto da R7 GERADORES (do banco de dados local)
   * GET /api/trpc/r7Geradores.buscarBoletos
   */
  buscarBoletos: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) {
        throw new Error('Banco de dados não disponível');
      }

      // Buscar boletos em aberto/vencidos da R7 no banco local
      const boletos = await db
        .select()
        .from(receivables)
        .innerJoin(clients, eq(receivables.clientId, clients.id));

      // Filtrar apenas R7 e boletos em aberto/vencidos
      const r7Boletos = boletos
        .filter(
          (b) =>
            b.clients.name.includes('R7') &&
            (b.receivables.status === 'pending' || b.receivables.status === 'overdue')
        )
        .map((b) => ({
          id: String(b.receivables.id),
          customer_id: String(b.receivables.clientId),
          contaAzulId: b.receivables.contaAzulId,
          amount: Number(b.receivables.amount),
          due_date: b.receivables.dueDate.toISOString().split('T')[0],
          status: b.receivables.status,
          clientName: b.clients.name,
          whatsappNumber: b.clients.whatsappNumber || undefined,
        }));

      console.log(`[R7 Router] ✅ Boletos em aberto encontrados: ${r7Boletos.length}`);

      return {
        success: true,
        total: r7Boletos.length,
        boletos: r7Boletos,
      };
    } catch (error: any) {
      console.error('[R7 Router] Erro ao buscar boletos:', error.message);
      return {
        success: false,
        error: error.message,
        total: 0,
        boletos: [],
      };
    }
  }),

  /**
   * Enviar cobrança via WhatsApp para um boleto específico (do banco local)
   * POST /api/trpc/r7Geradores.enviarCobranca
   */
  enviarCobranca: publicProcedure
    .input(
      z.object({
        boletoId: z.string(),
        telefone: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) {
          throw new Error('Banco de dados não disponível');
        }

        // Buscar boleto específico no banco
        const boletoId = parseInt(input.boletoId);
        const boletos = await db
          .select()
          .from(receivables)
          .innerJoin(clients, eq(receivables.clientId, clients.id))
          .where(eq(receivables.id, boletoId));

        if (boletos.length === 0) {
          return {
            success: false,
            error: 'Boleto não encontrado no banco de dados',
          };
        }

        const boletoData = boletos[0];
        const boleto = {
          id: String(boletoData.receivables.id),
          customer_id: String(boletoData.receivables.clientId),
          amount: Number(boletoData.receivables.amount),
          due_date: boletoData.receivables.dueDate.toISOString().split('T')[0],
          status: boletoData.receivables.status,
          clientName: boletoData.clients.name,
          whatsappNumber: input.telefone || boletoData.clients.whatsappNumber || undefined,
        };

        // Enviar cobrança
        const sucesso = await enviarCobrancaWhatsApp(boleto, input.telefone);

        return {
          success: sucesso,
          message: sucesso
            ? 'Cobrança enviada com sucesso!'
            : 'Erro ao enviar cobrança',
          telefone: boleto.whatsappNumber,
          boleto,
        };
      } catch (error: any) {
        console.error('[R7 Router] Erro ao enviar cobrança:', error.message);
        return {
          success: false,
          error: error.message,
        };
      }
    }),

  /**
   * Processar e enviar todas as cobranças da R7 (do banco local)
   * POST /api/trpc/r7Geradores.processarTodas
   */
  processarTodas: publicProcedure.mutation(async () => {
    try {
      const db = await getDb();
      if (!db) {
        throw new Error('Banco de dados não disponível');
      }

      // Buscar todos os boletos em aberto da R7
      const boletos = await db
        .select()
        .from(receivables)
        .innerJoin(clients, eq(receivables.clientId, clients.id));

      // Filtrar apenas R7 e boletos em aberto/vencidos
      const r7Boletos = boletos.filter(
        (b) =>
          b.clients.name.includes('R7') &&
          (b.receivables.status === 'pending' || b.receivables.status === 'overdue')
      );

      let enviados = 0;
      let erros = 0;

      // Enviar cobrança para cada boleto
      for (const boletoData of r7Boletos) {
        try {
          const boleto = {
            id: String(boletoData.receivables.id),
            customer_id: String(boletoData.receivables.clientId),
            amount: Number(boletoData.receivables.amount),
            due_date: boletoData.receivables.dueDate.toISOString().split('T')[0],
            status: boletoData.receivables.status,
            clientName: boletoData.clients.name,
            whatsappNumber: boletoData.clients.whatsappNumber || undefined,
          };

          const sucesso = await enviarCobrancaWhatsApp(boleto);
          if (sucesso) {
            enviados++;
          } else {
            erros++;
          }
        } catch (error) {
          erros++;
        }
      }

      return {
        success: true,
        total: r7Boletos.length,
        enviados,
        erros,
      };
    } catch (error: any) {
      console.error('[R7 Router] Erro ao processar cobranças:', error.message);
      return {
        success: false,
        error: error.message,
        total: 0,
        enviados: 0,
        erros: 0,
      };
    }
  }),

  /**
   * Executar cobrança automática agora (com auditoria)
   * POST /api/trpc/r7Geradores.executeCollectionNow
   */
  executeCollectionNow: publicProcedure.mutation(async () => {
    try {
      const { runR7CobrancaAutomatica } = await import('./r7CobrancaAutomatica');
      const resultado = await runR7CobrancaAutomatica();
      return resultado;
    } catch (error: any) {
      console.error('[R7 Router] Erro ao executar cobrança:', error.message);
      return {
        success: false,
        totalBoletos: 0,
        enviados: 0,
        falhas: 0,
        detalhes: [],
      };
    }
  }),

  /**
   * Obter prévia da mensagem de cobrança (do banco local)
   * POST /api/trpc/r7Geradores.previewMensagem
   */
  previewMensagem: publicProcedure
    .input(
      z.object({
        boletoId: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) {
          throw new Error('Banco de dados não disponível');
        }

        // Buscar boleto no banco
        const boletoId = parseInt(input.boletoId);
        const boletos = await db
          .select()
          .from(receivables)
          .innerJoin(clients, eq(receivables.clientId, clients.id))
          .where(eq(receivables.id, boletoId));

        if (boletos.length === 0) {
          return {
            success: false,
            error: 'Boleto não encontrado',
            mensagem: '',
          };
        }

        const boletoData = boletos[0];
        const boleto = {
          id: String(boletoData.receivables.id),
          customer_id: String(boletoData.receivables.clientId),
          amount: Number(boletoData.receivables.amount),
          due_date: boletoData.receivables.dueDate.toISOString().split('T')[0],
          status: boletoData.receivables.status,
          clientName: boletoData.clients.name,
        };

        const mensagem = formatarMensagemCobranca(boleto);

        return {
          success: true,
          mensagem,
          boleto,
        };
      } catch (error: any) {
        console.error('[R7 Router] Erro ao gerar prévia:', error.message);
        return {
          success: false,
          error: error.message,
          mensagem: '',
        };
      }
    }),
});

export type R7GeradorasRouter = typeof r7GeradorasRouter;
