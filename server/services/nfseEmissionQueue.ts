import { Queue, Worker } from 'bullmq';
import { emitNfse } from './nfseEmissionEngine';

// Create queue with simple Redis connection
export const nfseEmissionQueue = new Queue('nfse-emission', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  } as any,
});

// Process jobs
export const nfseEmissionWorker = new Worker('nfse-emission', async (job: any) => {
  const { emissaoId } = job.data;
  
  console.log(`[NfseEmissionQueue] Processando emissão ${emissaoId}...`);
  
  try {
    // Update job progress
    await job.updateProgress(10);
    
    // Call emission engine
    const result = await emitNfse(emissaoId);
    
    // Update job progress
    await job.updateProgress(100);
    
    console.log(`[NfseEmissionQueue] ✅ Emissão ${emissaoId} concluída`);
    
    return {
      success: result.success,
      numeroNfse: result.numeroNfse,
      error: result.error,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`[NfseEmissionQueue] ❌ Erro na emissão ${emissaoId}: ${error}`);
    throw err;
  }
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  } as any,
  concurrency: 1, // Process one emission at a time
});

// Event handlers
nfseEmissionWorker.on('completed', (job: any) => {
  console.log(`[NfseEmissionQueue] Job ${job.id} completed`);
});

nfseEmissionWorker.on('failed', (job: any, err: any) => {
  console.log(`[NfseEmissionQueue] Job ${job?.id} failed: ${err.message}`);
});

// Queue events
nfseEmissionQueue.on('waiting', (job: any) => {
  console.log(`[NfseEmissionQueue] Job ${job.id} waiting`);
});

export async function enqueueEmission(emissaoId: number) {
  try {
    const job = await nfseEmissionQueue.add(
      'emit',
      { emissaoId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    
    console.log(`[NfseEmissionQueue] Emissão ${emissaoId} enfileirada (Job ID: ${job.id})`);
    return job;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`[NfseEmissionQueue] ❌ Erro ao enfileirar emissão: ${error}`);
    throw err;
  }
}

export async function getEmissionStatus(jobId: string) {
  try {
    const job = await nfseEmissionQueue.getJob(jobId);
    if (!job) {
      return null;
    }
    
    const state = await job.getState();
    const progress = (job as any)._progress || 0;
    
    return {
      jobId: job.id,
      state,
      progress,
      data: job.data,
      result: job.returnvalue,
      error: job.failedReason,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`[NfseEmissionQueue] ❌ Erro ao buscar status: ${error}`);
    throw err;
  }
}
