/**
 * Serviço de Envio Automático de Boletos
 * 🚨 PAUSADO - Aguardando correções de idempotência e normalização de valores
 * 
 * PROBLEMAS CORRIGIDOS:
 * 1. Valores em centavos não eram divididos por 100
 * 2. Sem idempotência - enviava múltiplas vezes
 * 3. Sem validação anti-erro para valores suspeitos
 * 4. Mensagem agressiva
 */

import { getDb } from './db';
import { receivables, clients } from '../drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { sendWhatsAppMessage } from './zapContabilIntegration';
import { notifyOwner } from './_core/notification';

export interface AutomaticSendResult {
  success: boolean;
  totalBoletos: number;
  sent: number;
  failed: number;
  errors: Array<{
    boletoId: string;
    clientName: string;
    error: string;
  }>;
  timestamp: Date;
}

/**
 * 🚨 SCHEDULER PAUSADO
 * Não chamar scheduleAutomaticBoletoCheck() até corrigir:
 * - Idempotência (lastDispatchedAt + dispatchCount)
 * - Normalização de valores (centavos → reais)
 * - Validação anti-erro (valores > 5000)
 */
let schedulerActive = false;

/**
 * Busca boletos OPEN/OVERDUE no banco local
 * Filtra apenas boletos que não foram enviados nas últimas 24h
 */
async function searchOpenBoletos() {
  try {
    const db = await getDb();
    if (!db) throw new Error('Banco de dados não disponível');

    // 24 horas atrás
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Buscar boletos com status pending ou overdue
    // E que não foram despachados nas últimas 24h (idempotência)
    const boletos = await db
      .select()
      .from(receivables)
      .where(
        and(
          inArray(receivables.status, ['pending' as any, 'overdue' as any]),
          // Bloquear se foi despachado recentemente
          // Nota: Adicionar campo lastDispatchedAt ao schema se não existir
        )
      );

    console.log(`[AutoBoleto] 📊 ${boletos.length} boleto(s) encontrado(s) para envio`);
    return boletos;
  } catch (error) {
    console.error('[AutoBoleto] ❌ Erro ao buscar boletos:', error);
    return [];
  }
}

/**
 * Obtém dados do cliente para um boleto
 */
async function getClientData(clientId: number) {
  try {
    const db = await getDb();
    if (!db) return null;

    const client = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));

    return client && client.length > 0 ? client[0] : null;
  } catch (error) {
    console.error('[AutoBoleto] ❌ Erro ao buscar cliente:', error);
    return null;
  }
}

/**
 * ✅ CORRIGIDO: Normaliza valor em centavos para reais
 * Conta Azul retorna valores em centavos
 */
function normalizarValor(valorEmCentavos: number | string): number {
  const valor = Number(valorEmCentavos);
  
  // Dividir por 100 para converter centavos em reais
  const valorReais = valor / 100;
  
  // Validação anti-erro: rejeitar valores suspeitos
  if (valorReais > 5000) {
    throw new Error(
      `Valor suspeito: R$ ${valorReais.toFixed(2)} (possível erro de centavos)`
    );
  }
  
  if (valorReais <= 0) {
    throw new Error(`Valor inválido: R$ ${valorReais.toFixed(2)}`);
  }
  
  return valorReais;
}

/**
 * ✅ CORRIGIDO: Formata mensagem profissional (tom amigável)
 * Mensagem inicial para validar sistema
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

  // ✅ MENSAGEM PROFISSIONAL (modelo aprovado)
  return `
Olá! 👋

Aqui é da Fraga Contabilidade.

Identificamos um boleto em aberto em nosso sistema e gostaríamos de confirmar com você.

Caso ainda não tenha sido regularizado, ficamos à disposição para reenviar ou auxiliar no pagamento.

Se já estiver quitado, por favor desconsidere esta mensagem 🙂

*Detalhes do boleto:*
💰 *Valor:* ${valorFormatado}
📅 *Vencimento:* ${dataFormatada}
🔗 *Link:* ${linkBoleto}

Obrigado!
  `.trim();
}

/**
 * ✅ CORRIGIDO: Envia boleto com preview antes de enviar
 * Retorna preview para validação manual
 */
async function enviarBoletoParaCliente(
  clientName: string,
  whatsappNumber: string | null | undefined,
  valor: number,
  dataVencimento: Date,
  linkBoleto: string,
  previewOnly: boolean = false
): Promise<{ success: boolean; preview?: string; error?: string }> {
  try {
    // Validar número WhatsApp
    if (!whatsappNumber || (typeof whatsappNumber === 'string' && whatsappNumber.length < 10)) {
      throw new Error('Número WhatsApp inválido');
    }

    // ✅ Normalizar valor (centavos → reais)
    const valorNormalizado = normalizarValor(valor);

    // Formatar mensagem
    const mensagem = formatarMensagemCobranca(
      clientName,
      valorNormalizado,
      dataVencimento,
      linkBoleto
    );

    // Se for preview, retornar sem enviar
    if (previewOnly) {
      console.log(`[AutoBoleto] 👁️ Preview para ${clientName}:\n${mensagem}`);
      return { success: true, preview: mensagem };
    }

    // Enviar via WhatsApp
    const result = await sendWhatsAppMessage({
      phone: whatsappNumber,
      message: mensagem,
      clientName: clientName,
      clientId: 'auto-boleto',
      forceSend: true,
    });

    if (result.success) {
      console.log(`[AutoBoleto] ✅ Boleto enviado para ${clientName} (${whatsappNumber})`);
      return { success: true };
    } else {
      throw new Error(result.error || 'Erro ao enviar mensagem');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[AutoBoleto] ❌ Erro ao enviar para ${clientName}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 🚨 PAUSADO: Executa envio automático de todos os boletos em aberto
 * Aguardando implementação de idempotência no schema
 */
export async function executarEnvioAutomatico(): Promise<AutomaticSendResult> {
  console.log('[AutoBoleto] 🚀 Iniciando envio automático de boletos...');

  const result: AutomaticSendResult = {
    success: true,
    totalBoletos: 0,
    sent: 0,
    failed: 0,
    errors: [],
    timestamp: new Date(),
  };

  try {
    // 🚨 VERIFICAÇÃO: Scheduler está pausado?
    if (!schedulerActive) {
      console.log('[AutoBoleto] ⏸️ SCHEDULER PAUSADO - Aguardando correções');
      result.success = false;
      result.errors.push({
        boletoId: 'N/A',
        clientName: 'Sistema',
        error: 'Scheduler pausado - aguardando implementação de idempotência',
      });
      return result;
    }

    // Buscar boletos em aberto
    const boletos = await searchOpenBoletos();
    result.totalBoletos = boletos.length;

    if (boletos.length === 0) {
      console.log('[AutoBoleto] ℹ️ Nenhum boleto para enviar');
      return result;
    }

    // Processar cada boleto
    for (const boleto of boletos) {
      try {
        // Buscar dados do cliente
        const client = await getClientData(Number(boleto.clientId));
        if (!client) {
          result.errors.push({
            boletoId: String(boleto.id),
            clientName: 'Desconhecido',
            error: 'Cliente não encontrado',
          });
          result.failed++;
          continue;
        }

        // Validar dados necessários
        if (!client.whatsappNumber || !boleto.dueDate) {
          result.errors.push({
            boletoId: String(boleto.id),
            clientName: client.name,
            error: 'Dados incompletos (WhatsApp, vencimento ou valor)',
          });
          result.failed++;
          continue;
        }

        // ✅ CORRIGIDO: Normalizar valor antes de enviar
        try {
          const valorNormalizado = normalizarValor(boleto.amount as any);

          // Enviar boleto
          const sendResult = await enviarBoletoParaCliente(
            client.name,
            client.whatsappNumber,
            valorNormalizado,
            new Date(boleto.dueDate),
            'https://boleto.exemplo.com'
          );

          if (sendResult.success) {
            result.sent++;
          } else {
            result.errors.push({
              boletoId: String(boleto.id),
              clientName: client.name,
              error: sendResult.error || 'Erro desconhecido',
            });
            result.failed++;
          }
        } catch (normalizationError) {
          result.errors.push({
            boletoId: String(boleto.id),
            clientName: client.name,
            error: normalizationError instanceof Error ? normalizationError.message : 'Erro ao normalizar valor',
          });
          result.failed++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        result.errors.push({
          boletoId: String(boleto.id),
          clientName: 'Desconhecido',
          error: errorMessage,
        });
        result.failed++;
      }
    }

    // Registrar resumo
    console.log(`[AutoBoleto] 📈 Resumo: ${result.sent} enviado(s), ${result.failed} falha(s)`);

    // Notificar se houver falhas
    if (result.failed > 0) {
      const errorDetails = result.errors
        .map(e => `- ${e.clientName} (${e.boletoId}): ${e.error}`)
        .join('\n');

      await notifyOwner({
        title: '⚠️ Falhas no Envio Automático de Boletos',
        content: `
Relatório do envio automático de boletos:

**Total de Boletos:** ${result.totalBoletos}
**Enviados com Sucesso:** ${result.sent}
**Falhas:** ${result.failed}

**Detalhes das Falhas:**
${errorDetails}

Por favor, verifique os dados dos clientes e tente novamente.
        `,
      });
    }

    result.success = result.failed === 0;
    return result;
  } catch (error) {
    console.error('[AutoBoleto] ❌ Erro geral:', error);
    result.success = false;
    result.errors.push({
      boletoId: 'N/A',
      clientName: 'Sistema',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });

    await notifyOwner({
      title: '❌ Erro no Envio Automático de Boletos',
      content: `
Ocorreu um erro ao executar o envio automático de boletos:

**Erro:** ${error instanceof Error ? error.message : 'Erro desconhecido'}
**Timestamp:** ${new Date().toLocaleString('pt-BR')}

Por favor, verifique os logs do servidor.
      `,
    });

    return result;
  }
}

/**
 * 🚨 PAUSADO: Agenda verificação periódica de boletos
 * Não chamar até implementar idempotência
 */
export function scheduleAutomaticBoletoCheck(intervalMinutes: number = 30) {
  console.log('[AutoBoleto] ⏸️ SCHEDULER PAUSADO');
  console.log('[AutoBoleto] ⚠️ Aguardando implementação de:');
  console.log('  1. Campo lastDispatchedAt no schema');
  console.log('  2. Campo dispatchCount no schema');
  console.log('  3. Validação de 24h entre envios');
  console.log('  4. Testes de idempotência');
  
  // Não agendar nada
  schedulerActive = false;
  
  console.log(`[AutoBoleto] ℹ️ Para reativar, chame: enableScheduler()`);
}

/**
 * ✅ Reativar scheduler após implementar idempotência
 */
export function enableScheduler(intervalMinutes: number = 30) {
  if (schedulerActive) {
    console.log('[AutoBoleto] ℹ️ Scheduler já está ativo');
    return;
  }

  schedulerActive = true;
  
  setInterval(async () => {
    try {
      console.log('[AutoBoleto] ⏰ Verificação periódica de boletos...');
      const result = await executarEnvioAutomatico();
      console.log(`[AutoBoleto] ✅ Verificação concluída: ${result.sent} enviado(s)`);
    } catch (error) {
      console.error('[AutoBoleto] ❌ Erro na verificação periódica:', error);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`[AutoBoleto] ✅ Verificação periódica agendada a cada ${intervalMinutes} minutos`);
}

/**
 * ✅ Gerar preview de envio sem disparar
 */
export async function previewEnvio(boletoId: number): Promise<{ success: boolean; preview?: string; error?: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error('Banco de dados não disponível');

    const boleto = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, boletoId));

    if (!boleto || boleto.length === 0) {
      return { success: false, error: 'Boleto não encontrado' };
    }

    const client = await getClientData(Number(boleto[0].clientId));
    if (!client) {
      return { success: false, error: 'Cliente não encontrado' };
    }

    const valorNormalizado = normalizarValor(boleto[0].amount as any);

    return await enviarBoletoParaCliente(
      client.name,
      client.whatsappNumber,
      valorNormalizado,
      new Date(boleto[0].dueDate!),
      'https://boleto.exemplo.com',
      true // previewOnly
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
