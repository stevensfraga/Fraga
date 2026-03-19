import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import axios from 'axios';
import { getDb } from '../db';
import { collectionMessages, receivables } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { WhatsappDispatchJob } from '../queues/whatsappDispatchQueue';

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const whatsappDispatchWorker = new Worker<WhatsappDispatchJob>(
  'whatsapp-dispatch',
  async (job: Job<WhatsappDispatchJob>) => {
    const { receivableId, clientId, phone, message, boletoId, kind } = job.data;
    const db = await getDb();

    if (!db) throw new Error('Database not available');

    try {
      const jobType = kind === 'precharge' ? 'precharge' : 'boleto';
      console.log(`[Worker] Processando job ${job.id}: ${jobType} ${receivableId}`);

      // Normalizar número
      const toDigits = phone.replace(/\D/g, '');

      // Enviar via ZapContábil
      const zapApiUrl = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
      const zapApiKey = process.env.ZAP_CONTABIL_API_KEY;

      if (!zapApiKey) throw new Error('ZAP_CONTABIL_API_KEY not configured');

      const response = await axios.post(
        `${zapApiUrl}/api/send/${toDigits}`,
        {
          body: message,
          connectionFrom: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${zapApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const messageId = response.data?.message?.id;

      // Persistir sucesso
      const existingMsg = await db
        .select()
        .from(collectionMessages)
        .where(eq(collectionMessages.receivableId, receivableId))
        .limit(1);

      if (existingMsg.length > 0) {
        await db
          .update(collectionMessages)
          .set({
            status: 'sent',
            whatsappMessageId: messageId,
            sentAt: new Date(),
            attemptCount: (existingMsg[0].attemptCount || 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(collectionMessages.id, existingMsg[0].id));
      } else {
        const messageTemplate = kind === 'precharge' ? 'precharge_dispatch' : 'boleto_dispatch';
        await db.insert(collectionMessages).values({
          clientId,
          cnpj: 'N/A',
          receivableId,
          messageType: 'friendly',
          messageTemplate,
          messageSent: message,
          whatsappMessageId: messageId,
          status: 'sent',
          sentAt: new Date(),
          attemptCount: 1,
          outcome: 'pending',
        });
      }

      console.log(`[Worker] Job ${job.id} (${jobType}) enviado com sucesso. MessageId: ${messageId}`);

      return {
        success: true,
        messageId,
        receivableId,
        kind,
      };
    } catch (err: any) {
      const errorMsg = err?.message || 'UNKNOWN_ERROR';
      const status = err?.response?.status || 500;

      console.error(`[Worker] Job ${job.id} falhou (tentativa ${job.attemptsMade + 1}/${job.opts.attempts}):`, errorMsg);

      // Persistir falha
      try {
        const existingMsg = await db
          .select()
          .from(collectionMessages)
          .where(eq(collectionMessages.receivableId, receivableId))
          .limit(1);

        if (existingMsg.length > 0) {
          await db
            .update(collectionMessages)
            .set({
              status: 'failed',
              lastError: errorMsg,
              attemptCount: (existingMsg[0].attemptCount || 0) + 1,
              updatedAt: new Date(),
            })
            .where(eq(collectionMessages.id, existingMsg[0].id));
        } else {
          await db.insert(collectionMessages).values({
            clientId,
            cnpj: 'N/A',
            receivableId,
            messageType: 'friendly',
            messageTemplate: 'boleto_dispatch',
            messageSent: message,
            status: 'failed',
            lastError: errorMsg,
            attemptCount: 1,
            outcome: 'pending',
          });
        }
      } catch (dbErr: any) {
        console.error(`[Worker] Erro ao persistir falha do job ${job.id}:`, dbErr?.message);
      }

      // Re-throw para BullMQ tentar novamente
      throw new Error(`${status}: ${errorMsg}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Processar 5 jobs em paralelo
  }
);

whatsappDispatchWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completado`);
});

whatsappDispatchWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} falhou permanentemente:`, err?.message);
});

console.log('[Worker] WhatsApp dispatch worker inicializado');

export function startWhatsappDispatchWorker() {
  console.log('[Worker] WhatsApp dispatch worker iniciado');
}

export function stopWhatsappDispatchWorker() {
  console.log('[Worker] Parando WhatsApp dispatch worker...');
  whatsappDispatchWorker.close();
}

export default whatsappDispatchWorker;
