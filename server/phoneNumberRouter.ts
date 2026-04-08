import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  findClientByPhoneNumber,
  findClientByExactPhoneNumber,
  findClientsByPhonePattern,
  formatPhoneForWhatsApp,
  normalizePhoneNumber,
} from "./phoneNumberLookup";

export const phoneNumberRouter = router({
  /**
   * Busca cliente por número de telefone (busca parcial)
   */
  findByPhone: publicProcedure
    .input(z.object({ phone: z.string().min(1) }))
    .query(async ({ input }) => {
      const client = await findClientByPhoneNumber(input.phone);
      return {
        success: !!client,
        client: client || null,
        message: client ? "Cliente encontrado" : "Cliente não encontrado",
      };
    }),

  /**
   * Busca cliente por número exato de telefone
   */
  findByExactPhone: publicProcedure
    .input(z.object({ phone: z.string().min(1) }))
    .query(async ({ input }) => {
      const client = await findClientByExactPhoneNumber(input.phone);
      return {
        success: !!client,
        client: client || null,
        message: client ? "Cliente encontrado" : "Cliente não encontrado",
      };
    }),

  /**
   * Busca múltiplos clientes por padrão de telefone
   */
  findByPattern: publicProcedure
    .input(z.object({ pattern: z.string().min(1) }))
    .query(async ({ input }) => {
      const clients = await findClientsByPhonePattern(input.pattern);
      return {
        success: clients.length > 0,
        clients: clients,
        count: clients.length,
        message: clients.length > 0 ? `${clients.length} cliente(s) encontrado(s)` : "Nenhum cliente encontrado",
      };
    }),

  /**
   * Formata número de telefone para WhatsApp
   */
  formatForWhatsApp: publicProcedure
    .input(z.object({ phone: z.string().min(1) }))
    .query(({ input }) => {
      const formatted = formatPhoneForWhatsApp(input.phone);
      const normalized = normalizePhoneNumber(input.phone);
      return {
        original: input.phone,
        normalized,
        formatted,
        isValid: formatted.startsWith("55") && formatted.length >= 12,
      };
    }),

  /**
   * Identifica cliente respondente por número de WhatsApp
   * Usado quando recebe mensagem via webhook
   */
  identifyRespondent: publicProcedure
    .input(z.object({ phoneNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      // Tentar busca exata primeiro
      let client = await findClientByExactPhoneNumber(input.phoneNumber);
      
      // Se não encontrar, tentar busca parcial
      if (!client) {
        client = await findClientByPhoneNumber(input.phoneNumber);
      }

      return {
        success: !!client,
        client: client || null,
        phoneNumber: input.phoneNumber,
        normalized: normalizePhoneNumber(input.phoneNumber),
        message: client 
          ? `Respondente identificado: ${client.name}` 
          : "Respondente não identificado no sistema",
      };
    }),
});
