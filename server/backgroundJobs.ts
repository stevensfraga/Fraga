import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface OverdueClient {
  cnpj: string;
  nome: string;
  valor_aberto: number; // Pode estar em centavos ou reais
  data_vencimento: string;
}

interface SendingJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalClients: number;
  sentCount: number;
  failedCount: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

// Armazenar jobs em memória (em produção, usar banco de dados)
const jobs: Map<string, SendingJob> = new Map();

/**
 * Inicia um job de envio de mensagens para clientes em atraso
 * Executa em background sem bloquear o sistema
 */
export async function startBulkSendingJob(): Promise<string> {
  const jobId = `job-${Date.now()}`;
  
  const job: SendingJob = {
    id: jobId,
    status: 'pending',
    totalClients: 0,
    sentCount: 0,
    failedCount: 0,
    startedAt: new Date(),
  };
  
  jobs.set(jobId, job);
  
  // Executar em background (não aguardar)
  processBulkSending(jobId).catch(err => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = new Date();
    }
  });
  
  return jobId;
}

/**
 * Processa o envio em background
 */
async function processBulkSending(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  
  job.status = 'running';
  
  try {
    // Carregar clientes em atraso
    const overdueClientsPath = path.join(process.cwd(), 'server', 'overdueClients.json');
    const overdueClients: OverdueClient[] = JSON.parse(
      fs.readFileSync(overdueClientsPath, 'utf-8')
    );
    
    // Carregar clientes reais (para buscar telefone)
    const realClientsPath = path.join(process.cwd(), 'server', 'realClientsData.json');
    const realClients: any[] = JSON.parse(
      fs.readFileSync(realClientsPath, 'utf-8')
    );
    
    // Criar mapa de clientes reais por CNPJ para busca rápida
    const clientMap = new Map();
    realClients.forEach(client => {
      const cnpjClean = client.cnpj.replace(/[^\d]/g, '');
      clientMap.set(cnpjClean, client);
    });
    
    job.totalClients = overdueClients.length;
    
    // Enviar mensagens com delay para não sobrecarregar
    for (let i = 0; i < overdueClients.length; i++) {
      const overdueClient = overdueClients[i];
      const cnpjClean = overdueClient.cnpj.replace(/[^\d]/g, '');
      
      // Buscar cliente real para obter telefone
      const realClient = clientMap.get(cnpjClean);
      
      if (!realClient || !realClient.telefone) {
        job.failedCount++;
        continue;
      }
      
      try {
        await sendMessageToClient(overdueClient, realClient);
        job.sentCount++;
      } catch (err) {
        job.failedCount++;
      }
      
      // Delay de 100ms entre requisições
      if (i < overdueClients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    job.status = 'completed';
    job.completedAt = new Date();
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = new Date();
  }
}

/**
 * Envia mensagem para um cliente específico
 */
async function sendMessageToClient(
  overdueClient: OverdueClient,
  realClient: any
): Promise<void> {
  const zapContabilApiKey = process.env.WHATSAPP_API_KEY;
  const zapContabilApiUrl = 'https://api-fraga.zapcontabil.chat';
  
  if (!zapContabilApiKey) {
    throw new Error('WHATSAPP_API_KEY não configurada');
  }
  
  // Formatar telefone
  let phone = realClient.telefone.replace(/[^\d]/g, '');
  if (phone.length === 10) {
    phone = '55' + phone;
  } else if (phone.length === 11) {
    phone = '55' + phone;
  }
  
  if (phone.length < 12) {
    throw new Error('Telefone inválido');
  }
  
  // Montar mensagem
  // ✅ CORRIGIDO: Normalizar valor em centavos se necessário
  const valorNormalizado = overdueClient.valor_aberto > 10000 
    ? overdueClient.valor_aberto / 100 
    : overdueClient.valor_aberto;
  
  const valorFormatado = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valorNormalizado);
  
  const message = `Olá ${overdueClient.nome}! 👋

Identificamos que sua empresa possui uma fatura em aberto no valor de ${valorFormatado}.

Vencimento: ${overdueClient.data_vencimento}

Gostaríamos de ajudá-lo a regularizar essa pendência. 

Poderia nos informar se há alguma dificuldade para o pagamento ou se já foi realizado?

Estamos à disposição! 💼

*Fraga Contabilidade*`;
  
  // Enviar via API
  const payload = {
    body: message,
    connectionFrom: 0,
  };
  
  await axios.post(
    `${zapContabilApiUrl}/api/send/${phone}`,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${zapContabilApiKey}`,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      timeout: 5000,
    }
  );
}

/**
 * Obter status de um job
 */
export function getJobStatus(jobId: string): SendingJob | null {
  return jobs.get(jobId) || null;
}

/**
 * Listar todos os jobs
 */
export function listJobs(): SendingJob[] {
  return Array.from(jobs.values());
}
