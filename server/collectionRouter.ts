import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { generateOverdueClientsFromDashboard, calculateCollectionStats } from "./dashboardDataLoader";
import { sendWhatsAppMessage, getMessageStatus } from "./zapContabilIntegration";
import { syncAcessoriasData } from "./acessoriasIntegration";
import { syncWhatsAppNumbers, getClientWhatsAppNumber } from "./whatsappSync";
import { getClientWhatsAppNumberFromAcessorias, isValidWhatsAppNumber } from "./acessoriasClientPhone";
import { getAllTestClients, getTestClientById, getTestClientByName, getTestClientByCnpj, formatPhoneForWhatsApp } from "./testClientsData";
import { loadRealClients, getRealClientByCnpj, getRealClientByName, getAllRealClientsWithPhone, getRealClientsStats, formatPhoneForWhatsApp as formatPhoneReal, isValidWhatsAppNumber as isValidPhoneReal } from "./realClientsLoader";
import { getClientHistory, saveCollectionMessage } from "./db";
import axios from "axios";

// URL base para arquivos públicos
const getPublicUrl = () => {
  if (process.env.NODE_ENV === "production") {
    return process.env.CONTA_AZUL_REDIRECT_URI?.replace('/api/callback', '') || "https://dashboard.fragacontabilidade.com.br";
  }
  return "http://localhost:5173"; // Vite dev server
};

/**
 * Buscar cliente com fallback para dados reais e depois teste
 * Tenta buscar: Dados Reais → Acessórias → Dados de Teste
 */
async function getClientWithFallback(clientId: string, clientName: string) {
  try {
    // 1. Tentar buscar nos dados reais (Conta Azul + Acessórias unificados)
    let realClient = getRealClientByCnpj(clientId);
    if (!realClient) {
      realClient = getRealClientByName(clientName);
    }
    
    if (realClient && realClient.telefone) {
      console.log(`[Collection] Cliente encontrado nos dados reais: ${realClient.nome}`);
      return {
        clientId: realClient.cnpj,
        clientName: realClient.nome,
        whatsappNumber: formatPhoneReal(realClient.telefone),
        email: realClient.email,
        isRealData: true
      };
    }
  } catch (error) {
    console.log(`[Collection] Falha ao buscar em dados reais`);
  }

  try {
    // 2. Tentar buscar do Acessórias
    const clientInfo = await getClientWhatsAppNumberFromAcessorias(clientName, clientId);
    if (clientInfo?.whatsappNumber) {
      return clientInfo;
    }
  } catch (error) {
    console.log(`[Collection] Falha ao buscar em Acessórias`);
  }

  // 3. Fallback para dados de teste
  const testClient = getTestClientById(clientId) || getTestClientByName(clientName);
  if (testClient) {
    console.log(`[Collection] Usando cliente de teste: ${testClient.nome}`);
    return {
      clientId: testClient.id,
      clientName: testClient.nome,
      whatsappNumber: formatPhoneForWhatsApp(testClient.telefone),
      email: testClient.email,
      isTestData: true
    };
  }

  return null;
}

export const collectionRouter = router({
  syncFromContaAzul: publicProcedure.mutation(async () => {
    try {
      const url = `${getPublicUrl()}/dashboard-data.json`;
      const response = await axios.get(url);
      const dashboardData = response.data;

      const clients = generateOverdueClientsFromDashboard(dashboardData);
      const totalOverdue = clients.reduce((sum: number, c: any) => sum + c.totalOverdue, 0);

      return {
        success: true,
        message: `Sincronizacao concluida! ${clients.length} clientes em atraso encontrados.`,
        totalClients: clients.length,
        totalOverdue,
        clients,
      };
    } catch (error) {
      console.error("Error syncing from dashboard data:", error);
      throw new Error("Falha ao sincronizar dados");
    }
  }),

  getOverdueClients: publicProcedure.query(async () => {
    try {
      const url = `${getPublicUrl()}/dashboard-data.json`;
      const response = await axios.get(url);
      const dashboardData = response.data;

      const clients = generateOverdueClientsFromDashboard(dashboardData);

      return clients;
    } catch (error) {
      console.error("Error fetching overdue clients:", error);
      throw error;
    }
  }),

  getStats: publicProcedure.query(async () => {
    try {
      const url = `${getPublicUrl()}/dashboard-data.json`;
      const response = await axios.get(url);
      const dashboardData = response.data;

      const clients = generateOverdueClientsFromDashboard(dashboardData);

      return calculateCollectionStats(clients);
    } catch (error) {
      console.error("Error fetching stats:", error);
      throw error;
    }
  }),

  sendCollectionMessage: publicProcedure
    .input(
      z.object({
        clientId: z.string(),
        clientName: z.string(),
        clientPhone: z.string().optional(),
        amount: z.number(),
        daysOverdue: z.number(),
        messageType: z.enum(["friendly", "administrative", "formal"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        let phoneNumber = input.clientPhone;

        // Se não houver número de telefone válido, buscar com fallback para dados de teste
        if (!phoneNumber || !isValidWhatsAppNumber(phoneNumber)) {
          console.log(`[Collection] Buscando número de WhatsApp para ${input.clientName}...`);
          const clientInfo = await getClientWithFallback(input.clientId, input.clientName);

          if (clientInfo?.whatsappNumber) {
            phoneNumber = clientInfo.whatsappNumber;
            const isTestData = (clientInfo as any).isTestData ? ' (dados de teste)' : '';
            console.log(`[Collection] Número encontrado: ${phoneNumber}${isTestData}`);
          } else {
            console.error(`[Collection] Nenhum número de WhatsApp encontrado para ${input.clientName}`);
            return {
              success: false,
              message: "Nenhum número de WhatsApp encontrado para este cliente",
              clientId: input.clientId,
              timestamp: new Date(),
            };
          }
        }

        const templates: Record<string, string> = {
          friendly: `Olá, tudo bem?\nEstamos fazendo uma revisão interna e identificamos honorários em aberto referentes aos últimos meses.\nGostaria de confirmar se existe alguma pendência ou dificuldade para regularização, para que possamos alinhar da melhor forma e evitar impactos na continuidade dos serviços.\nFico no aguardo do seu retorno.`,
          administrative: `Olá, tudo bem?\nSeguindo nossa comunicação anterior, gostaria de confirmar se você recebeu nossa mensagem sobre os honorários em aberto.\nCaso tenha alguma dúvida ou dificuldade, estou à disposição para conversar e encontrar a melhor solução.\nQuando podemos contar com a regularização?\nObrigado!`,
          formal: `Olá, tudo bem?\nEstou preocupado pois ainda não conseguimos regularizar os honorários em aberto há mais de um mês.\nGostaria de entender se há algo que eu possa fazer para ajudar a resolver isso.\nPodemos agendar uma conversa para alinhamento?`,
        };

        const message = templates[input.messageType];

        // Enviar via ZapContábil
        const result = await sendWhatsAppMessage({
          phone: phoneNumber,
          message,
          clientName: input.clientName,
          clientId: input.clientId,
        });

        if (result.success) {
          console.log(`[Collection] Mensagem enviada com sucesso para ${input.clientName}`);
          
          // Salvar mensagem no banco de dados
          try {
            await saveCollectionMessage(
              input.clientId,
              input.messageType,
              message,
              message,
              result.messageId,
              input.clientId
            );
            console.log(`[Collection] Mensagem salva no banco de dados`);
          } catch (dbError) {
            console.error(`[Collection] Erro ao salvar mensagem no banco:`, dbError);
            // Continuar mesmo se falhar ao salvar
          }
          
          return {
            success: true,
            message: "Mensagem enviada com sucesso via WhatsApp!",
            clientId: input.clientId,
            messageId: result.messageId,
            timestamp: new Date(),
          };
        } else {
          console.error(`[Collection] Erro ao enviar: ${result.error}`);
          return {
            success: false,
            message: result.error || "Falha ao enviar mensagem",
            clientId: input.clientId,
            timestamp: new Date(),
          };
        }
      } catch (error) {
        console.error("Error sending WhatsApp message:", error);
        throw new Error("Falha ao enviar mensagem WhatsApp");
      }
    }),

  getMessageStatus: publicProcedure
    .input(z.object({ messageId: z.string() }))
    .query(async ({ input }) => {
      try {
        const status = await getMessageStatus(input.messageId);
        return status;
      } catch (error) {
        console.error("Error getting message status:", error);
        throw error;
      }
    }),

  recordResponse: publicProcedure
    .input(
      z.object({
        clientId: z.string(),
        responseType: z.enum(["agreed", "will_pay", "dispute", "no_response"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return {
          success: true,
          message: "Resposta registrada com sucesso!",
          clientId: input.clientId,
          responseType: input.responseType,
          timestamp: new Date(),
        };
      } catch (error) {
        console.error("Error recording response:", error);
        throw new Error("Falha ao registrar resposta");
      }
    }),

  recordPayment: publicProcedure
    .input(
      z.object({
        clientId: z.string(),
        amount: z.number(),
        paymentMethod: z.enum(["transfer", "pix", "check", "cash"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return {
          success: true,
          message: "Pagamento registrado com sucesso!",
          clientId: input.clientId,
          amount: input.amount,
          timestamp: new Date(),
        };
      } catch (error) {
        console.error("Error recording payment:", error);
        throw new Error("Falha ao registrar pagamento");
      }
    }),

  getClientHistory: publicProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      try {
        const { getClientHistory } = await import("./db");
        const history = await getClientHistory(input.clientId);
        return history;
      } catch (error) {
        console.error("Error getting client history:", error);
        throw new Error("Falha ao recuperar histórico");
      }
    }),

  saveMessageHistory: publicProcedure
    .input(
      z.object({
        clientId: z.number(),
        messageType: z.enum(["friendly", "administrative", "formal"]),
        messageTemplate: z.string(),
        messageSent: z.string(),
        whatsappMessageId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { saveCollectionMessage } = await import("./db");
        const result = await saveCollectionMessage(
          input.clientId,
          input.messageType,
          input.messageTemplate,
          input.messageSent,
          input.whatsappMessageId,
          String(input.clientId)
        );
        return {
          success: true,
          message: "Histórico salvo com sucesso!",
          result,
        };
      } catch (error) {
        console.error("Error saving message history:", error);
        throw new Error("Falha ao salvar histórico");
      }
    }),

  syncAcessoriasDatabase: publicProcedure.mutation(async () => {
    try {
      console.log("[Collection] Iniciando sincronizacao com banco de acessorias...");
      const result = await syncAcessoriasData();
      return {
        success: true,
        message: `Sincronizacao concluida! ${result.totalCompanies} empresas e ${result.totalContacts} contatos sincronizados.`,
        totalCompanies: result.totalCompanies,
        totalContacts: result.totalContacts,
        errors: result.errors,
      };
    } catch (error) {
      console.error("Error syncing Acessorias database:", error);
      throw new Error("Falha ao sincronizar banco de acessorias");
    }
  }),

  getTestClients: publicProcedure
    .input(
      z.object({
        range: z.enum(["friendly", "administrative", "formal"]).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const clients = input.range ? getAllTestClients().filter(c => c.faixa === input.range) : getAllTestClients();
        return {
          success: true,
          total: clients.length,
          clients: clients.map(c => ({
            id: c.id,
            nome: c.nome,
            cnpj: c.cnpj,
            dias_atraso: c.dias_atraso,
            valor_atraso: c.valor_atraso,
            faixa: c.faixa,
            num_parcelas: c.num_parcelas,
            vencimento_mais_antigo: c.vencimento_mais_antigo,
            telefone: c.telefone,
            email: c.email,
            isTestData: true
          }))
        };
      } catch (error) {
        console.error("Error fetching test clients:", error);
        throw new Error("Falha ao buscar clientes de teste");
      }
    }),

  getTestClientById: publicProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      try {
        const client = getTestClientById(input.clientId);
        if (!client) {
          throw new Error(`Cliente de teste nao encontrado: ${input.clientId}`);
        }
        return {
          success: true,
          client: {
            id: client.id,
            nome: client.nome,
            cnpj: client.cnpj,
            dias_atraso: client.dias_atraso,
            valor_atraso: client.valor_atraso,
            faixa: client.faixa,
            num_parcelas: client.num_parcelas,
            vencimento_mais_antigo: client.vencimento_mais_antigo,
            telefone: client.telefone,
            email: client.email,
            whatsappNumber: formatPhoneForWhatsApp(client.telefone),
            isTestData: true
          }
        };
      } catch (error) {
        console.error("Error fetching test client:", error);
        throw new Error("Falha ao buscar cliente de teste");
      }
    }),

  getRealClients: publicProcedure
    .input(
      z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const clients = getAllRealClientsWithPhone();
        const limit = input.limit || 50;
        const offset = input.offset || 0;
        const paginated = clients.slice(offset, offset + limit);

        return {
          success: true,
          total: clients.length,
          limit,
          offset,
          clients: paginated.map(c => ({
            cnpj: c.cnpj,
            nome: c.nome,
            telefone: c.telefone,
            email: c.email,
            whatsappNumber: formatPhoneReal(c.telefone),
            source: c.source,
            isRealData: true
          }))
        };
      } catch (error) {
        console.error("Error fetching real clients:", error);
        throw new Error("Falha ao buscar clientes reais");
      }
    }),

  getRealClientByCnpj: publicProcedure
    .input(z.object({ cnpj: z.string() }))
    .query(async ({ input }) => {
      try {
        const client = getRealClientByCnpj(input.cnpj);
        if (!client) {
          throw new Error(`Cliente nao encontrado: ${input.cnpj}`);
        }
        return {
          success: true,
          client: {
            cnpj: client.cnpj,
            nome: client.nome,
            telefone: client.telefone,
            email: client.email,
            whatsappNumber: formatPhoneReal(client.telefone),
            source: client.source,
            isRealData: true
          }
        };
      } catch (error) {
        console.error("Error fetching real client:", error);
        throw new Error("Falha ao buscar cliente real");
      }
    }),

  getRealClientsStats: publicProcedure
    .query(async () => {
      try {
        const stats = getRealClientsStats();
        return {
          success: true,
          stats,
        };
      } catch (error) {
        console.error("Error fetching real clients stats:", error);
        throw new Error("Falha ao buscar estatisticas");
      }
    }),

  startBulkSending: protectedProcedure
    .mutation(async () => {
      try {
        const { startBulkSendingJob } = await import('./backgroundJobs');
        const jobId = await startBulkSendingJob();
        return {
          success: true,
          jobId,
          message: 'Envio iniciado em background',
        };
      } catch (error) {
        console.error("Error starting bulk sending:", error);
        throw new Error("Falha ao iniciar envio em massa");
      }
    }),

  getBulkSendingStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      try {
        const { getJobStatus } = await import('./backgroundJobs');
        const status = getJobStatus(input.jobId);
        if (!status) {
          throw new Error(`Job nao encontrado: ${input.jobId}`);
        }
        return {
          success: true,
          status,
        };
      } catch (error) {
        console.error("Error fetching job status:", error);
        throw new Error("Falha ao buscar status do job");
      }
    }),
    
    getMessageHistory: protectedProcedure
      .input(z.object({
        clientId: z.number().optional(),
        clientName: z.string().optional(),
      }))
      .query(async ({ input }) => {
        try {
          if (!input.clientId && !input.clientName) {
            throw new Error("clientId ou clientName eh obrigatorio");
          }
          
          let clientId = input.clientId;
          if (!clientId && input.clientName) {
            const realClient = getRealClientByName(input.clientName);
            if (realClient) {
              clientId = parseInt(realClient.cnpj.replace(/[^0-9]/g, ''));
            }
          }
          
          if (!clientId) {
            return [];
          }
          
          const history = await getClientHistory(clientId);
          return history || [];
        } catch (error) {
          console.error("Error fetching message history:", error);
          return [];
        }
      }),
});

/**
 * Procedures para análise de sentimento e ajuste de tom
 */
export const sentimentRouter = router({
  /**
   * Analisar sentimento de resposta do cliente
   */
  analyzeResponse: protectedProcedure
    .input((input: any) => input)
    .mutation(async ({ input }) => {
      try {
        const { messageId, responseText, clientId, clientName, messageType, amountOverdue, daysOverdue } = input;

        if (!responseText) {
          throw new Error("responseText is required");
        }

        // Importar dinamicamente para evitar problemas de circular dependency
        const { analyzeSentiment, saveSentimentAnalysis } = await import("./sentimentAnalysis");

        // Análise de sentimento
        const analysis = await analyzeSentiment(responseText, {
          clientName: clientName || "Cliente",
          amountOverdue: amountOverdue || 0,
          daysOverdue: daysOverdue || 0,
          messageType: messageType || "friendly",
        });

        // Salvar análise no banco
        if (messageId) {
          await saveSentimentAnalysis(messageId, responseText, analysis);
        }

        return {
          success: true,
          analysis,
          message: "Análise de sentimento realizada com sucesso",
        };
      } catch (error) {
        console.error("Erro ao analisar sentimento:", error);
        throw new Error(`Erro ao analisar sentimento: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }),

  /**
   * Obter histórico de sentimentos de um cliente
   */
  getSentimentHistory: publicProcedure
    .input((input: any) => input)
    .query(async ({ input }) => {
      try {
        const { clientId } = input;

        if (!clientId) {
          throw new Error("clientId is required");
        }

        const { getClientSentimentHistory } = await import("./sentimentAnalysis");
        const history = await getClientSentimentHistory(clientId);

        return {
          success: true,
          history: history || [],
        };
      } catch (error) {
        console.error("Erro ao obter histórico de sentimento:", error);
        return {
          success: false,
          history: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Obter tendência de sentimento de um cliente
   */
  getSentimentTrend: publicProcedure
    .input((input: any) => input)
    .query(async ({ input }) => {
      try {
        const { clientId } = input;

        if (!clientId) {
          throw new Error("clientId is required");
        }

        const { getSentimentTrend } = await import("./sentimentAnalysis");
        const trend = await getSentimentTrend(clientId);

        return {
          success: true,
          trend,
        };
      } catch (error) {
        console.error("Erro ao obter tendência de sentimento:", error);
        return {
          success: false,
          trend: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Sugerir próxima mensagem baseado em sentimento
   */
  suggestNextMessage: protectedProcedure
    .input((input: any) => input)
    .query(async ({ input }) => {
      try {
        const { clientId, lastSentiment, lastMessageType, amountOverdue, daysOverdue } = input;

        if (!clientId || !lastSentiment) {
          throw new Error("clientId and lastSentiment are required");
        }

        // Lógica para sugerir próxima mensagem baseado no sentimento
        let suggestedTone = "friendly";
        let suggestedAction = "wait_and_retry";
        let reason = "";

        if (lastSentiment === "positive") {
          suggestedTone = "friendly";
          suggestedAction = "send_payment_link";
          reason = "Cliente mostrou disposição para pagar. Envie link de pagamento.";
        } else if (lastSentiment === "negative") {
          if (lastMessageType === "friendly") {
            suggestedTone = "administrative";
            suggestedAction = "schedule_call";
            reason = "Cliente recusou. Escale para tom administrativo e agende ligação.";
          } else if (lastMessageType === "administrative") {
            suggestedTone = "formal";
            suggestedAction = "escalate_to_manager";
            reason = "Cliente continua recusando. Escale para tom formal e gerente.";
          } else {
            suggestedTone = "escalate";
            suggestedAction = "escalate_to_manager";
            reason = "Situação crítica. Escale para gerente.";
          }
        } else if (lastSentiment === "neutral") {
          suggestedTone = "friendly";
          suggestedAction = "offer_discount";
          reason = "Cliente fez perguntas. Ofereça desconto para facilitar pagamento.";
        } else if (lastSentiment === "mixed") {
          suggestedTone = "administrative";
          suggestedAction = "wait_and_retry";
          reason = "Cliente mostrou sentimentos mistos. Aguarde e tente novamente.";
        }

        return {
          success: true,
          suggestedTone,
          suggestedAction,
          reason,
          daysUntilNextAttempt: lastSentiment === "positive" ? 1 : lastSentiment === "negative" ? 7 : 3,
        };
      } catch (error) {
        console.error("Erro ao sugerir próxima mensagem:", error);
        throw new Error(`Erro ao sugerir próxima mensagem: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }),
});
