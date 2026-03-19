import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export interface WhatsappDispatchJob {
  receivableId: number;
  clientId: number;
  phone: string;
  message: string;
  boletoId?: number;
  kind?: 'boleto' | 'precharge';
}

export const whatsappDispatchQueue = new Queue<WhatsappDispatchJob>(
  'whatsapp-dispatch',
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5000, // 5 segundos inicial
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  }
);

console.log('[Queue] WhatsApp dispatch queue inicializada');

export default whatsappDispatchQueue;
