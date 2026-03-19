/**
 * 🚀 REAL DISPATCH ROUTER - VERSÃO LOCAL ONLY
 * 
 * ⚠️ REGRA CRÍTICA: Buscar EXCLUSIVAMENTE do banco local (receivables)
 * A API do Conta Azul é usada APENAS para sincronização, não para cobrança
 * 
 * Fluxo obrigatório:
 * 1. Sincronizar: contaAzulSync.syncNow (popula receivables)
 * 2. Cobrar: realDispatch.executeFirstDispatch (consulta receivables local)
 */

import { protectedProcedure, publicProcedure } from './_core/trpc';
import { z } from 'zod';
import axios from 'axios';
import { getDb } from './db';
import { eq, and, desc } from 'drizzle-orm';
import { receivables, clients, contaAzulTokens } from '../drizzle/schema';
import { TRPCError } from '@trpc/server';

const ZAP_API_URL = 'https://api-fraga.zapcontabil.chat';

// ============================================================================
// FUNÇÕES DE NORMALIZAÇÃO E VALIDAÇÃO
// ============================================================================

/**
 * Normalizar valor para centavos
 * Detecta automaticamente se é centavos ou reais
 */
function toCents(value: any): number {
  if (typeof value === 'number') {
    // Heurística: >= 1000 provavelmente já está em centavos
    return value >= 1000 ? Math.round(value) : Math.round(value * 100);
  }
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/[R$\s]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const num = Number(cleaned);
    if (Number.isFinite(num)) return Math.round(num * 100);
  }
  return 0;
}

/**
 * Formatar centavos para BRL
 */
function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Middleware para validar TEST_DISPATCH_TOKEN
const withTestToken = publicProcedure.use(async ({ ctx, next }) => {
  const authHeader = ctx.req?.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const expectedToken = process.env.TEST_DISPATCH_TOKEN;

  if (!token || token !== expectedToken) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid or missing TEST_DISPATCH_TOKEN',
    });
  }

  return next({ ctx });
});

export const realDispatchRouter = {
  /**
   * ⚠️ VERSÃO LOCAL ONLY
   * 
   * Buscar cliente R7 Geradores e boleto vencido de outubro de 2025
   * EXCLUSIVAMENTE do banco local (receivables)
   * 
   * NÃO consulta API Conta Azul durante cobrança
   */
  executeFirstDispatch: withTestToken
    .input(
      z.object({
        clientName: z.string().optional().default('R7'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const ZAP_API_KEY = process.env.WHATSAPP_API_KEY;

      try {
        console.log('[Real Dispatch] 🚀 INICIANDO COBRANÇA LOCAL');
        console.log('[Real Dispatch] ⚠️ Consultando EXCLUSIVAMENTE banco local\n');

        if (!db) {
          throw new Error('Database não disponível');
        }

        // 1. Buscar cliente R7 no banco local
        console.log('[Real Dispatch] 1️⃣ Buscando cliente R7 no banco local...');
        
        const allClients = await db.select().from(clients);
        const r7ClientsList = allClients.filter(
          (c) => c.name.toUpperCase().includes('R7') || c.name.toUpperCase().includes('GERADORES')
        );

        if (!r7ClientsList || r7ClientsList.length === 0) {
          throw new Error('Cliente R7 Geradores nao encontrado no banco local');
        }

        const r7Client = r7ClientsList[0];
        console.log(`[Real Dispatch] ✅ Cliente encontrado: ${r7Client.name}\n`);

        // 2. Buscar boletos vencidos de outubro de 2025 EXCLUSIVAMENTE do banco local
        console.log('[Real Dispatch] 2️⃣ Buscando boletos de outubro/2025 no banco local...');
        
        const allReceivables = await db
          .select()
          .from(receivables)
          .where(
            and(
              eq(receivables.clientId, r7Client.id),
              eq(receivables.status, 'overdue')
            )
          )
          .orderBy(desc(receivables.dueDate));

        if (!allReceivables || allReceivables.length === 0) {
          throw new Error('Nenhum boleto vencido encontrado para cliente R7');
        }

        // Filtrar boletos de outubro de 2025
        const october2025 = allReceivables.filter((r) => {
          const dueDate = new Date(r.dueDate);
          return dueDate.getFullYear() === 2025 && dueDate.getMonth() === 9;
        });

        if (october2025.length === 0) {
          throw new Error('Nenhum boleto vencido de outubro de 2025 encontrado no banco local');
        }

        // Ordenar por data (mais antigo primeiro)
        october2025.sort((a, b) => {
          const dateA = new Date(a.dueDate);
          const dateB = new Date(b.dueDate);
          return dateA.getTime() - dateB.getTime();
        });

        const receivable = october2025[0];
        console.log(`[Real Dispatch] ✅ Boleto encontrado no banco local\n`);

        // 3. VALIDAÇÃO RIGOROSA
        console.log('[Real Dispatch] 3️⃣ Validando dados do boleto...');

        // Validar vencimento
        if (!receivable.dueDate) throw new Error('Vencimento do boleto não encontrado');
        const dueDate = new Date(receivable.dueDate);

        // Validar valor
        const amountDecimal = receivable.amount;
        if (!amountDecimal) throw new Error('Valor do boleto não encontrado');
        
        // Converter decimal para centavos
        const amountCents = Math.round(parseFloat(amountDecimal.toString()) * 100);
        if (!amountCents) throw new Error('Valor do boleto inválido');
        const amountFmt = formatBRL(amountCents);

        // Validar documento (usar contaAzulId ou description como fallback)
        const documento = receivable.contaAzulId || receivable.description || `Boleto ${receivable.id}`;
        if (!documento) throw new Error('Documento do boleto não encontrado');

        // Validar WhatsApp do cliente
        if (!r7Client.whatsappNumber) {
          throw new Error('WhatsApp do cliente não encontrado no banco local');
        }

        let whatsapp = r7Client.whatsappNumber;
        if (!whatsapp.startsWith('+')) {
          whatsapp = '+' + whatsapp;
        }

        console.log(`[Real Dispatch] ✅ Todos os dados validados\n`);

        // 4. Construir mensagem com dados reais do banco local
        console.log('[Real Dispatch] 4️⃣ Construindo mensagem...');

        const parts = [
          `⚠️ *Aviso de Boleto em Aberto*`,
          ``,
          `Olá! 👋`,
          ``,
          `Identificamos um boleto em aberto em seu cadastro:`,
          ``,
          `📄 Documento: ${documento}`,
          `💰 Valor: ${amountFmt}`,
          `📅 Vencimento: ${dueDate.toLocaleDateString('pt-BR')}`,
        ];

        // Adicionar descrição se existir
        if (receivable.description) {
          parts.push(`📝 Descrição: ${receivable.description}`);
        }

        parts.push(
          ``,
          `Se já houve pagamento, por favor desconsidere este aviso.`,
          `Em caso de dúvidas, estou à disposição 🙂`,
          ``,
          `Obrigado!`
        );

        const message = parts.join('\n');
        console.log(`[Real Dispatch] ✅ Mensagem construída\n`);

        // 5. Enviar via ZapContábil
        console.log('[Real Dispatch] 5️⃣ Enviando via WhatsApp (ZapContábil)...');

        if (!ZAP_API_KEY) {
          throw new Error('ZAP_API_KEY não configurada');
        }

        const zapResponse = await axios.post(
          `${ZAP_API_URL}/messages/send`,
          {
            phone: whatsapp,
            message,
            type: 'text',
          },
          {
            headers: {
              Authorization: `Bearer ${ZAP_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );

        const messageId = zapResponse.data.messageId || zapResponse.data.id;
        console.log(`[Real Dispatch] ✅ Mensagem enviada: ${messageId}\n`);

        // Retornar resultado completo
        const result = {
          success: true,
          cliente: {
            id: r7Client.id,
            nome: r7Client.name,
            email: r7Client.email,
            whatsapp,
          },
          selectedReceivable: {
            id: receivable.id,
            contaAzulId: receivable.contaAzulId,
            documento,
            valor: amountFmt,
            valorCents: amountCents,
            vencimento: dueDate.toLocaleDateString('pt-BR'),
            status: receivable.status,
            descricao: receivable.description,
          },
          envio: {
            status: 'sent',
            messageId,
            tentativas: 1,
            erro: null,
          },
          messagePreview: message,
          timestamp: new Date().toISOString(),
        };

        console.log('[Real Dispatch] ✅ COBRANÇA ENVIADA COM SUCESSO\n');
        return result;

      } catch (error: any) {
        console.error('[Real Dispatch] ❌ Erro:', error.message);

        return {
          success: false,
          error: error.message,
          status: 'blocked',
          timestamp: new Date().toISOString(),
        };
      }
    }),

  /**
   * Testar conexão com banco local
   */
  testLocalConnection: withTestToken.query(async ({ ctx }) => {
    const db = await getDb();

    try {
      if (!db) {
        return {
          connected: false,
          error: 'Database não disponível',
        };
      }

      // Testar leitura de clientes
      const testClients = await db
        .select()
        .from(clients)
        .limit(1);

      // Testar leitura de receivables
      const testReceivables = await db
        .select()
        .from(receivables)
        .limit(1);

      return {
        connected: true,
        status: 'OK',
        clientsCount: testClients.length,
        receivablesCount: testReceivables.length,
      };
    } catch (error: any) {
      return {
        connected: false,
        error: error.message,
      };
    }
  }),
};
