import { router, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import { sendCollectionMessage, sendBulkCollectionMessages } from "./whatsappIntegration";

export const whatsappRouter = router({
  /**
   * Send a single collection message via WhatsApp
   */
  sendCollectionMessage: publicProcedure
    .input(
      z.object({
        phoneNumber: z.string(),
        customerName: z.string(),
        amount: z.number(),
        dueDate: z.string(),
        bankSlipUrl: z.string().optional(),
        invoiceNumber: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log(`[tRPC] Sending WhatsApp message to ${input.phoneNumber}`);

      const result = await sendCollectionMessage(input);

      if (!result.success) {
        throw new Error(`Failed to send WhatsApp message: ${result.error}`);
      }

      return {
        success: true,
        messageId: result.messageId,
      };
    }),

  /**
   * Send bulk collection messages via WhatsApp
   */
  sendBulkMessages: publicProcedure
    .input(
      z.array(
        z.object({
          phoneNumber: z.string(),
          customerName: z.string(),
          amount: z.number(),
          dueDate: z.string(),
          bankSlipUrl: z.string().optional(),
          invoiceNumber: z.string().optional(),
        })
      )
    )
    .mutation(async ({ input }) => {
      console.log(`[tRPC] Sending ${input.length} WhatsApp messages`);

      const results = await sendBulkCollectionMessages(input);

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return {
        total: results.length,
        successful,
        failed,
        results,
      };
    }),
});
