import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface OverdueClient {
  id: string;
  nome: string;
  dias_atraso: number;
  valor_atraso: number;
  faixa: string;
  num_parcelas: number;
  vencimento_mais_antigo: string;
}

interface SendingLog {
  timestamp: Date;
  cliente: string;
  cnpj: string;
  telefone: string;
  status: 'success' | 'failed';
  messageId?: string;
  error?: string;
}

const sendingLogs: SendingLog[] = [];

/**
 * Envia mensagens para todos os clientes em atraso
 * Com intervalo de 1 minuto entre cada mensagem
 */
export async function sendBulkMessagesScheduled(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Iniciando envio de mensagens em massa...`);
  
  try {
    // Carregar clientes em atraso
    const overdueClientsPath = path.join(process.cwd(), 'client', 'public', 'clientes-atraso.json');
    const data = JSON.parse(fs.readFileSync(overdueClientsPath, 'utf-8'));
    const overdueClients: OverdueClient[] = data.clientes;
    
    // Carregar clientes reais para buscar telefone
    const realClientsPath = path.join(process.cwd(), 'server', 'realClientsData.json');
    const realClients: any[] = JSON.parse(fs.readFileSync(realClientsPath, 'utf-8'));
    
    // Criar mapa de clientes reais por CNPJ
    const clientMap = new Map();
    realClients.forEach(client => {
      const cnpjClean = client.cnpj.replace(/[^\d]/g, '');
      clientMap.set(cnpjClean, client);
    });
    
    console.log(`[${new Date().toISOString()}] Total de clientes a enviar: ${overdueClients.length}`);
    
    // Enviar mensagens com intervalo de 1 minuto
    for (let i = 0; i < overdueClients.length; i++) {
      const overdueClient = overdueClients[i];
      const cnpjClean = String(overdueClient.id).replace(/[^\d]/g, '');
      
      // Buscar cliente real para obter telefone
      const realClient = clientMap.get(cnpjClean);
      
      if (!realClient || !realClient.telefone) {
        console.log(`[${new Date().toISOString()}] ⚠️  Cliente ${overdueClient.nome} - Sem telefone`);
        sendingLogs.push({
          timestamp: new Date(),
          cliente: overdueClient.nome,
          cnpj: overdueClient.id,
          telefone: 'N/A',
          status: 'failed',
          error: 'Telefone não encontrado',
        });
        continue;
      }
      
      try {
        await sendMessageToClient(overdueClient, realClient);
        console.log(`[${new Date().toISOString()}] ✅ ${i + 1}/${overdueClients.length} - ${overdueClient.nome}`);
        
        sendingLogs.push({
          timestamp: new Date(),
          cliente: overdueClient.nome,
          cnpj: overdueClient.id,
          telefone: realClient.telefone,
          status: 'success',
        });
      } catch (err) {
        console.log(`[${new Date().toISOString()}] ❌ ${i + 1}/${overdueClients.length} - ${overdueClient.nome} - Erro: ${err}`);
        
        sendingLogs.push({
          timestamp: new Date(),
          cliente: overdueClient.nome,
          cnpj: overdueClient.id,
          telefone: realClient.telefone,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      
      // Aguardar 1 minuto antes da próxima mensagem (exceto na última)
      if (i < overdueClients.length - 1) {
        console.log(`[${new Date().toISOString()}] ⏳ Aguardando 1 minuto antes da próxima mensagem...`);
        await new Promise(resolve => setTimeout(resolve, 60000)); // 60 segundos
      }
    }
    
    // Salvar log de envios
    const logPath = path.join(process.cwd(), 'server', 'sendingLog.json');
    fs.writeFileSync(logPath, JSON.stringify(sendingLogs, null, 2));
    
    console.log(`[${new Date().toISOString()}] ✅ Envio concluído!`);
    console.log(`[${new Date().toISOString()}] Log salvo em: sendingLog.json`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Erro ao enviar mensagens:`, err);
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
  
  // Determinar template baseado na faixa
  let templateMessage = '';
  
  if (overdueClient.faixa === 'friendly') {
    templateMessage = `Olá ${overdueClient.nome}! 👋

Identificamos que sua empresa possui uma fatura em aberto no valor de R$ ${overdueClient.valor_atraso.toFixed(2)}.

Vencimento: ${overdueClient.vencimento_mais_antigo}

Gostaríamos de ajudá-lo a regularizar essa pendência. 

Poderia nos informar se há alguma dificuldade para o pagamento ou se já foi realizado?

Estamos à disposição! 💼

*Fraga Contabilidade*`;
  } else if (overdueClient.faixa === 'administrative') {
    templateMessage = `Prezado(a) ${overdueClient.nome},

Conforme comunicação anterior, sua empresa possui uma fatura em aberto há alguns dias no valor de R$ ${overdueClient.valor_atraso.toFixed(2)}.

Solicitamos que regularize esta pendência com urgência.

Caso já tenha realizado o pagamento, desconsidere esta mensagem.

Atenciosamente,
*Fraga Contabilidade*`;
  } else {
    // formal
    templateMessage = `NOTIFICAÇÃO FORMAL

Prezado(a) ${overdueClient.nome},

Informamos que sua empresa possui uma fatura em aberto há ${overdueClient.dias_atraso} dias no valor de R$ ${overdueClient.valor_atraso.toFixed(2)}.

Solicitamos que regularize esta pendência imediatamente.

Vencimento original: ${overdueClient.vencimento_mais_antigo}

Caso contrário, poderemos tomar medidas legais cabíveis.

*Fraga Contabilidade*`;
  }
  
  // Montar payload
  const payload = {
    body: templateMessage,
    connectionFrom: 0,
  };
  
  // Enviar via API
  const response = await axios.post(
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
  
  if (!response.data || !response.data.id) {
    throw new Error(`API retornou resposta inválida: ${JSON.stringify(response.data)}`);
  }
}
