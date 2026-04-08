/**
 * Gerenciador de Cobrança para R7 GERADORES
 * Responsável por:
 * 1. Buscar boletos em aberto/vencidos da R7
 * 2. Formatar mensagens de cobrança
 * 3. Enviar via WhatsApp (Zap Contábil)
 */

import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { obterTelefoneCobranca } from './clientCollectionRulesManager';
import { sendWhatsAppMessage } from './zapContabilIntegration';

// Dados da R7 GERADORES
const R7_CNPJ = '21.918.918/0001-94';
const R7_CNPJ_CLEAN = '21918918000194';
const R7_PHONE = process.env.R7_PHONE || '11999999999'; // Número do WhatsApp

interface Boleto {
  id: string;
  customer_id: string;
  due_date: string;
  amount: number;
  status: string;
  boleto_url?: string;
  document_number?: string;
  whatsappNumber?: string; // Telefone do cliente (do banco)
  clientName?: string; // Nome do cliente
}

interface Cliente {
  id: string;
  name: string;
  cnpj: string;
  email?: string;
}

/**
 * Buscar boletos em aberto/vencidos da R7 GERADORES
 * Sistema de COBRANÇA ATIVA - apenas boletos atuais
 */
export async function buscarBoletosR7(): Promise<Boleto[]> {
  try {
    console.log('[R7 Cobrança] Buscando boletos da R7 GERADORES...');

    const accessToken = await getValidAccessToken();

    // Buscar clientes para encontrar a R7
    const clientesResponse = await axios.get(
      'https://api-v2.contaazul.com/v1/customers',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const clientes = clientesResponse.data.data || [];
    console.log(`[R7 Cobrança] Total de clientes: ${clientes.length}`);

    // Encontrar R7 GERADORES
    const r7Cliente = clientes.find(
      (c: Cliente) =>
        c.cnpj === R7_CNPJ || c.cnpj === R7_CNPJ_CLEAN || c.name.includes('R7')
    );

    if (!r7Cliente) {
      console.warn('[R7 Cobrança] ❌ R7 GERADORES não encontrada no Conta Azul');
      return [];
    }

    console.log(`[R7 Cobrança] ✅ R7 GERADORES encontrada (ID: ${r7Cliente.id})`);

    // Buscar contas a receber
    const contasResponse = await axios.get(
      'https://api-v2.contaazul.com/v1/financial/receivable',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const contas = contasResponse.data.data || [];
    console.log(`[R7 Cobrança] Total de contas a receber: ${contas.length}`);

    // Filtrar boletos da R7 em aberto ou vencidos (COBRANÇA ATIVA)
    const boletosR7 = contas.filter(
      (conta: any) =>
        conta.customer_id === r7Cliente.id &&
        (conta.status === 'open' || conta.status === 'overdue')
    );

    console.log(`[R7 Cobrança] ✅ Boletos em aberto/vencidos: ${boletosR7.length}`);

    // Log de boletos para cobrança
    if (boletosR7.length > 0) {
      console.log('[R7 Cobrança] Boletos para cobrança:');
      boletosR7.forEach((boleto: any, idx: number) => {
        const dias = calcularDiasAtraso(boleto.due_date);
        console.log(
          `   ${idx + 1}. ${boleto.id} | ${formatarMoeda(boleto.amount)} | Venc: ${formatarData(boleto.due_date)} | Atraso: ${dias}d`
        );
      });
    }

    return boletosR7;
  } catch (error: any) {
    console.error('[R7 Cobrança] ❌ Erro ao buscar boletos:', error.message);
    return [];
  }
}

/**
 * Calcular dias de atraso
 */
function calcularDiasAtraso(dataVencimento: string): number {
  const hoje = new Date();
  const vencimento = new Date(dataVencimento);
  const diferenca = hoje.getTime() - vencimento.getTime();
  const dias = Math.ceil(diferenca / (1000 * 60 * 60 * 24));
  return dias;
}

/**
 * Formatar valor em moeda
 */
function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor / 100);
}

/**
 * Formatar data
 */
function formatarData(data: string): string {
  const d = new Date(data);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Formatar mensagem de cobrança
 */
export function formatarMensagemCobranca(boleto: Boleto): string {
  let mensagem = '';

  const valor = formatarMoeda(boleto.amount);
  const vencimento = formatarData(boleto.due_date);
  const diasAtraso = calcularDiasAtraso(boleto.due_date);

  if (diasAtraso === 0) {
    // Vencimento hoje
    mensagem = `📌 *Aviso de Cobrança*\n\n`;
    mensagem += `Olá! 👋\n\n`;
    mensagem += `Seu boleto vence *HOJE*!\n\n`;
    mensagem += `💰 *Valor:* ${valor}\n`;
    mensagem += `📅 *Vencimento:* ${vencimento}\n`;
    mensagem += `📄 *Documento:* ${boleto.document_number || boleto.id}\n\n`;
    mensagem += `🔗 *Link do Boleto:*\n${boleto.boleto_url || 'Consulte seu e-mail'}\n\n`;
    mensagem += `⏰ Por favor, efetue o pagamento com urgência!\n`;
  } else if (diasAtraso > 0) {
    // Em atraso
    mensagem = `⚠️ *BOLETO EM ATRASO*\n\n`;
    mensagem += `Olá! 👋\n\n`;
    mensagem += `Seu boleto está *${diasAtraso} dias em atraso*!\n\n`;
    mensagem += `💰 *Valor:* ${valor}\n`;
    mensagem += `📅 *Vencimento:* ${vencimento}\n`;
    mensagem += `📄 *Documento:* ${boleto.document_number || boleto.id}\n\n`;
    mensagem += `🔗 *Link do Boleto:*\n${boleto.boleto_url || 'Consulte seu e-mail'}\n\n`;
    mensagem += `⚡ *Ação imediata necessária!*\n`;
    mensagem += `Evite multas e juros. Pague agora mesmo! 💳\n`;
  } else {
    // Próximo a vencer
    mensagem = `📌 *Lembrete de Pagamento*\n\n`;
    mensagem += `Olá! 👋\n\n`;
    mensagem += `Você tem um boleto a vencer em breve!\n\n`;
    mensagem += `💰 *Valor:* ${valor}\n`;
    mensagem += `📅 *Vencimento:* ${vencimento}\n`;
    mensagem += `📄 *Documento:* ${boleto.document_number || boleto.id}\n\n`;
    mensagem += `🔗 *Link do Boleto:*\n${boleto.boleto_url || 'Consulte seu e-mail'}\n\n`;
    mensagem += `✅ Efetue o pagamento com antecedência!\n`;
  }

  return mensagem;
}

/**
 * Enviar cobrança via WhatsApp (Zap Contábil)
 * Fonte de verdade: Banco de dados local (whatsappNumber do boleto)
 */
export async function enviarCobrancaWhatsApp(
  boleto: Boleto,
  telefone?: string
): Promise<boolean> {
  try {
    // PRIORIDADE 1: Usar telefone fornecido
    if (!telefone) {
      // PRIORIDADE 2: Usar telefone do boleto (vem do banco de dados)
      if (boleto.whatsappNumber) {
        telefone = boleto.whatsappNumber;
        console.log(`[R7 Cobrança] ✅ Usando telefone do banco: ${telefone}`);
      } else {
        // PRIORIDADE 3: Buscar no Conta Azul (fallback)
        console.log(`[R7 Cobrança] ⚠️  Telefone não encontrado no boleto, buscando no Conta Azul...`);
        const telefoneBuscado = await obterTelefoneCobranca('R7 GERADORES');
        if (!telefoneBuscado) {
          console.error('[R7 Cobrança] ❌ Não foi possível obter telefone da R7');
          throw new Error('Telefone da R7 GERADORES não encontrado');
        }
        telefone = telefoneBuscado;
      }
    }

    console.log(`[R7 Cobrança] 📱 Enviando cobrança para ${telefone}...`);

    const mensagem = formatarMensagemCobranca(boleto);

    // Enviar via integração real do Zap Contábil
    const result = await sendWhatsAppMessage({
      phone: telefone,
      message: mensagem,
      clientName: boleto.clientName || 'R7 GERADORES',
      clientId: boleto.customer_id,
    });

    if (result.success) {
      console.log(`[R7 Cobrança] ✅ Cobrança enviada com sucesso!`);
      console.log(`[R7 Cobrança] Message ID: ${result.messageId}`);
      return true;
    } else {
      if (result.postponed) {
        console.warn(`[R7 Cobrança] ⏰ Cobrança agendada: ${result.nextSendTime}`);
        console.warn(`[R7 Cobrança] Motivo: ${result.error}`);
        return true; // Considerar como sucesso pois foi agendada
      } else {
        console.error('[R7 Cobrança] ❌ Erro ao enviar cobrança:', result.error);
        return false;
      }
    }
  } catch (error: any) {
    console.error('[R7 Cobrança] ❌ Erro:', error.message);
    return false;
  }
}

/**
 * Processar e enviar todas as cobranças da R7
 */
export async function processarCobrancasR7(): Promise<{
  total: number;
  enviados: number;
  erros: number;
}> {
  try {
    console.log('[R7 Cobrança] 🚀 Processando cobranças da R7...');

    const boletos = await buscarBoletosR7();

    let enviados = 0;
    let erros = 0;

    for (const boleto of boletos) {
      try {
        const sucesso = await enviarCobrancaWhatsApp(boleto);
        if (sucesso) {
          enviados++;
        } else {
          erros++;
        }
      } catch (error) {
        console.error('[R7 Cobrança] ❌ Erro ao processar boleto:', error);
        erros++;
      }
    }

    console.log(`[R7 Cobrança] ✅ Processamento concluído!`);
    console.log(`   Total: ${boletos.length}`);
    console.log(`   Enviados: ${enviados}`);
    console.log(`   Erros: ${erros}`);

    return {
      total: boletos.length,
      enviados,
      erros,
    };
  } catch (error: any) {
    console.error('[R7 Cobrança] ❌ Erro ao processar cobranças:', error.message);
    return {
      total: 0,
      enviados: 0,
      erros: 1,
    };
  }
}
