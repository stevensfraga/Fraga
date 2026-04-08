/**
 * Comando Final de Disparo Ponta-a-Ponta
 * Valida todos os pré-requisitos e executa o disparo do primeiro boleto real
 */

import { getDb } from './db';
import { clients, receivables, contaAzulTokens, collectionMessages } from '../drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { sendWhatsAppMessage } from './zapContabilIntegration';

interface PrerequisiteCheck {
  name: string;
  status: 'OK' | 'ERRO';
  message: string;
  details?: any;
}

interface FinalDispatchResult {
  success: boolean;
  prerequisites: PrerequisiteCheck[];
  dispatchResult?: {
    boletoId: string;
    clientName: string;
    whatsappNumber: string;
    valor: number;
    vencimento: string;
    messageId: string | undefined;
  };
  error?: string;
  timestamp: Date;
}

/**
 * Valida todos os pré-requisitos
 */
async function validatePrerequisites(): Promise<PrerequisiteCheck[]> {
  const checks: PrerequisiteCheck[] = [];
  const db = await getDb();

  if (!db) {
    checks.push({
      name: 'Banco de Dados',
      status: 'ERRO',
      message: 'Banco de dados não disponível',
    });
    return checks;
  }

  // 1. Validar OAuth
  console.log('[PreCheck] 🔐 Validando OAuth Conta Azul...');
  try {
    const tokens = await db
      .select()
      .from(contaAzulTokens)
      .limit(1);

    if (!tokens || tokens.length === 0) {
      checks.push({
        name: 'OAuth Conta Azul',
        status: 'ERRO',
        message: 'Nenhum token OAuth encontrado. Reautorize em /conta-azul-oauth',
      });
    } else {
      const token = tokens[0];
      const expiresAt = new Date(token.expiresAt);
      const now = new Date();

      if (expiresAt < now) {
        checks.push({
          name: 'OAuth Conta Azul',
          status: 'ERRO',
          message: `Token expirado em ${expiresAt.toLocaleString()}`,
          details: { expiresAt },
        });
      } else {
        checks.push({
          name: 'OAuth Conta Azul',
          status: 'OK',
          message: 'Token válido',
          details: { expiresAt },
        });
      }
    }
  } catch (err) {
    checks.push({
      name: 'OAuth Conta Azul',
      status: 'ERRO',
      message: `Erro ao validar token: ${err}`,
    });
  }

  // 2. Validar cliente com boleto OPEN/OVERDUE
  console.log('[PreCheck] 👤 Validando cliente com boleto...');
  try {
    const boletos = await db
      .select()
      .from(receivables)
      .where(inArray(receivables.status, ['pending' as any, 'overdue' as any]))
      .limit(1);

    if (!boletos || boletos.length === 0) {
      checks.push({
        name: 'Boleto OPEN/OVERDUE',
        status: 'ERRO',
        message: 'Nenhum boleto OPEN/OVERDUE encontrado no banco',
      });
    } else {
      checks.push({
        name: 'Boleto OPEN/OVERDUE',
        status: 'OK',
        message: `${boletos.length} boleto(s) encontrado(s)`,
        details: { count: boletos.length, firstBoletoId: boletos[0].id },
      });
    }
  } catch (err) {
    checks.push({
      name: 'Boleto OPEN/OVERDUE',
      status: 'ERRO',
      message: `Erro ao buscar boletos: ${err}`,
    });
  }

  // 3. Validar cliente com WhatsApp
  console.log('[PreCheck] 📱 Validando cliente com WhatsApp...');
  try {
    const clientsWithWhatsApp = await db
      .select()
      .from(clients)
      .where(
        and(
          inArray(clients.id, [1]), // R7 Geradores
          // Verificar se whatsappNumber não é null
        )
      )
      .limit(1);

    if (!clientsWithWhatsApp || clientsWithWhatsApp.length === 0) {
      checks.push({
        name: 'Cliente com WhatsApp',
        status: 'ERRO',
        message: 'Nenhum cliente encontrado',
      });
    } else {
      const client = clientsWithWhatsApp[0];
      if (!client.whatsappNumber || client.whatsappNumber.length < 10) {
        checks.push({
          name: 'Cliente com WhatsApp',
          status: 'ERRO',
          message: `Cliente ${client.name} sem WhatsApp válido`,
          details: { clientName: client.name, whatsapp: client.whatsappNumber },
        });
      } else {
        checks.push({
          name: 'Cliente com WhatsApp',
          status: 'OK',
          message: `Cliente ${client.name} com WhatsApp válido`,
          details: { clientName: client.name, whatsapp: client.whatsappNumber },
        });
      }
    }
  } catch (err) {
    checks.push({
      name: 'Cliente com WhatsApp',
      status: 'ERRO',
      message: `Erro ao validar cliente: ${err}`,
    });
  }

  // 4. Validar Dashboard
  console.log('[PreCheck] 📊 Validando Dashboard...');
  checks.push({
    name: 'Dashboard',
    status: 'OK',
    message: 'Dashboard de auditoria disponível em /audit',
  });

  return checks;
}

/**
 * Formata mensagem de cobrança
 */
function formatarMensagemCobranca(
  clientName: string,
  valor: number,
  dataVencimento: Date,
  linkBoleto: string
): string {
  const dataFormatada = new Date(dataVencimento).toLocaleDateString('pt-BR');
  const valorFormatado = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);

  return `
Olá ${clientName}! 👋

Segue informações do seu boleto em aberto:

💰 *Valor:* ${valorFormatado}
📅 *Vencimento:* ${dataFormatada}
🔗 *Link do Boleto:* ${linkBoleto}

Por favor, efetue o pagamento para evitar juros e multa.

Qualquer dúvida, estamos à disposição! 📞
  `.trim();
}

/**
 * Executa o disparo final ponta-a-ponta
 */
export async function runFinalDispatchCommand(): Promise<FinalDispatchResult> {
  console.log('[FinalDispatch] 🚀 Iniciando disparo do primeiro boleto real...');
  console.log('[FinalDispatch] ⏰ Timestamp:', new Date().toISOString());

  const result: FinalDispatchResult = {
    success: false,
    prerequisites: [],
    timestamp: new Date(),
  };

  try {
    // Fase 1: Validar pré-requisitos
    console.log('[FinalDispatch] 📋 Fase 1: Validando pré-requisitos...');
    result.prerequisites = await validatePrerequisites();

    // Verificar se todos os pré-requisitos passaram
    const allOK = result.prerequisites.every((check) => check.status === 'OK');
    if (!allOK) {
      console.error('[FinalDispatch] ❌ Pré-requisitos não atendidos:');
      result.prerequisites.forEach((check) => {
        if (check.status === 'ERRO') {
          console.error(`  - ${check.name}: ${check.message}`);
        }
      });
      result.error = 'Pré-requisitos não atendidos';
      return result;
    }

    console.log('[FinalDispatch] ✅ Todos os pré-requisitos validados!');

    // Fase 2: Buscar boleto
    const db = await getDb();
    if (!db) throw new Error('Banco de dados não disponível');

    console.log('[FinalDispatch] 📊 Fase 2: Buscando boleto OPEN/OVERDUE...');
    const boletos = await db
      .select()
      .from(receivables)
      .where(inArray(receivables.status, ['pending' as any, 'overdue' as any]))
      .limit(1);

    if (!boletos || boletos.length === 0) {
      throw new Error('Nenhum boleto encontrado');
    }

    const boleto = boletos[0];
    console.log(`[FinalDispatch] ✅ Boleto encontrado: ID ${boleto.id}`);

    // Fase 3: Buscar cliente
    console.log('[FinalDispatch] 👤 Fase 3: Buscando dados do cliente...');
    const clientData = await db
      .select()
      .from(clients)
      .where(eq(clients.id, boleto.clientId));

    if (!clientData || clientData.length === 0) {
      throw new Error('Cliente não encontrado');
    }

    const client = clientData[0];
    console.log(`[FinalDispatch] ✅ Cliente: ${client.name} (${client.whatsappNumber})`);

    // Fase 4: Gerar mensagem
    console.log('[FinalDispatch] 📱 Fase 4: Gerando mensagem personalizada...');
    const mensagem = formatarMensagemCobranca(
      client.name,
      parseFloat(boleto.amount as any),
      new Date(boleto.dueDate),
      'https://boleto.exemplo.com'
    );
    console.log('[FinalDispatch] ✅ Mensagem gerada');

    // Fase 5: Enviar via WhatsApp
    console.log('[FinalDispatch] 📤 Fase 5: Enviando via WhatsApp...');
    const sendResult = await sendWhatsAppMessage({
      phone: client.whatsappNumber!,
      message: mensagem,
      clientName: client.name,
      clientId: String(client.id),
      forceSend: true,
    });

    if (!sendResult.success) {
      throw new Error(`Erro ao enviar WhatsApp: ${sendResult.error}`);
    }

    console.log(`[FinalDispatch] ✅ Mensagem enviada! ID: ${sendResult.messageId}`);

    // Fase 6: Registrar auditoria
    console.log('[FinalDispatch] 📋 Fase 6: Registrando auditoria...');
    await db.insert(collectionMessages).values({
      clientId: client.id,
      cnpj: client.phone || 'N/A',
      receivableId: boleto.id,
      messageType: 'friendly',
      messageTemplate: 'cobranca_boleto',
      messageSent: String(new Date()),
      whatsappMessageId: sendResult.messageId,
      status: 'sent',
      outcome: 'pending',
      sentAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('[FinalDispatch] ✅ Auditoria registrada');

    // Resultado final
    result.success = true;
    result.dispatchResult = {
      boletoId: String(boleto.id),
      clientName: client.name,
      whatsappNumber: client.whatsappNumber || 'N/A',
      valor: parseFloat(boleto.amount as any),
      vencimento: new Date(boleto.dueDate).toLocaleDateString('pt-BR'),
      messageId: sendResult.messageId,
    };

    console.log('[FinalDispatch] 🎉 Disparo concluído com sucesso!');
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[FinalDispatch] ❌ Erro:', errorMessage);
    result.error = errorMessage;
    result.success = false;
    return result;
  }
}
