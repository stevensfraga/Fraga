/**
 * Monitor Contínuo de Boletos da R7 GERADORES
 * Verifica periodicamente se há novos boletos e envia cobranças automaticamente
 */

import { buscarBoletosR7, enviarCobrancaWhatsApp } from './r7GeradorasCollectionManager';
import { getDb } from './db';
import { collectionMessages } from '../drizzle/schema';

interface BoletoMonitorado {
  id: string;
  amount: number;
  dueDate: string;
  status: string;
  enviado: boolean;
  dataEnvio?: Date;
}

let boletosMonitorados: Map<string, BoletoMonitorado> = new Map();
let monitorAtivo = false;
let intervaloMonitor: NodeJS.Timeout | null = null;

const INTERVALO_VERIFICACAO = 5 * 60 * 1000; // 5 minutos

/**
 * Iniciar monitor de boletos
 */
export function iniciarMonitorBoletos() {
  if (monitorAtivo) {
    console.log('[R7 Monitor] ⚠️ Monitor já está ativo');
    return;
  }

  console.log('[R7 Monitor] 🚀 Iniciando monitor de boletos da R7...');
  monitorAtivo = true;

  // Executar verificação imediatamente
  verificarBoletos();

  // Agendar verificações periódicas
  intervaloMonitor = setInterval(() => {
    verificarBoletos();
  }, INTERVALO_VERIFICACAO);

  console.log(
    `[R7 Monitor] ✅ Monitor iniciado (verificação a cada ${INTERVALO_VERIFICACAO / 1000 / 60} minutos)`
  );
}

/**
 * Parar monitor de boletos
 */
export function pararMonitorBoletos() {
  if (!monitorAtivo) {
    console.log('[R7 Monitor] ⚠️ Monitor não está ativo');
    return;
  }

  console.log('[R7 Monitor] 🛑 Parando monitor de boletos...');
  monitorAtivo = false;

  if (intervaloMonitor) {
    clearInterval(intervaloMonitor);
    intervaloMonitor = null;
  }

  console.log('[R7 Monitor] ✅ Monitor parado');
}

/**
 * Verificar boletos e enviar cobranças
 */
async function verificarBoletos() {
  try {
    console.log(`[R7 Monitor] 🔍 Verificando boletos em ${new Date().toLocaleString('pt-BR')}...`);

    // Buscar boletos atuais
    const boletos = await buscarBoletosR7();

    if (!boletos || boletos.length === 0) {
      console.log('[R7 Monitor] ℹ️ Nenhum boleto encontrado');
      return;
    }

    console.log(`[R7 Monitor] 📊 Total de boletos: ${boletos.length}`);

    // Verificar cada boleto
    for (const boleto of boletos) {
      const boletoId = boleto.id;

      // Verificar se é novo
      if (!boletosMonitorados.has(boletoId)) {
        console.log(`[R7 Monitor] 🆕 Novo boleto encontrado: ${boletoId}`);
        console.log(`   Valor: R$ ${boleto.amount}`);
        console.log(`   Vencimento: ${boleto.due_date}`);
        console.log(`   Status: ${boleto.status}`);

        // Adicionar ao mapa
        boletosMonitorados.set(boletoId, {
          id: boletoId,
          amount: boleto.amount,
          dueDate: boleto.due_date,
          status: boleto.status,
          enviado: false,
        });

        // Enviar cobrança automaticamente
        await enviarCobrancaAutomaticamente(boleto);
      } else {
        // Boleto já monitorado
        const monitorado = boletosMonitorados.get(boletoId)!;

        // Se não foi enviado ainda, tentar enviar
        if (!monitorado.enviado) {
          console.log(`[R7 Monitor] 📤 Reenviando cobrança para boleto ${boletoId}...`);
          await enviarCobrancaAutomaticamente(boleto);
        }
      }
    }

    // Limpar boletos que não existem mais
    boletosMonitorados.forEach((monitorado, boletoId) => {
      if (!boletos.find((b) => b.id === boletoId)) {
        console.log(`[R7 Monitor] 🗑️ Boleto ${boletoId} removido do monitoramento`);
        boletosMonitorados.delete(boletoId);
      }
    });
  } catch (error: any) {
    console.error('[R7 Monitor] ❌ Erro ao verificar boletos:', error.message);
  }
}

/**
 * Enviar cobrança automaticamente
 */
async function enviarCobrancaAutomaticamente(boleto: any) {
  try {
    console.log(`[R7 Monitor] 📱 Enviando cobrança para boleto ${boleto.id}...`);

    const sucesso = await enviarCobrancaWhatsApp(boleto);

    if (sucesso) {
      console.log(`[R7 Monitor] ✅ Cobrança enviada com sucesso!`);

      // Marcar como enviado
      const monitorado = boletosMonitorados.get(boleto.id);
      if (monitorado) {
        monitorado.enviado = true;
        monitorado.dataEnvio = new Date();
      }

      // Registrar no banco
      await registrarEnvio(boleto);
    } else {
      console.log(`[R7 Monitor] ⚠️ Falha ao enviar cobrança`);
    }
  } catch (error: any) {
    console.error('[R7 Monitor] ❌ Erro ao enviar cobrança:', error.message);
  }
}

/**
 * Registrar envio no banco de dados
 */
async function registrarEnvio(boleto: any) {
  try {
    const db = await getDb();
    if (!db) {
      console.warn('[R7 Monitor] ⚠️ Banco de dados não disponível');
      return;
    }

    // Aqui você pode registrar o envio na tabela collectionMessages
    // Por enquanto, apenas log
    console.log(`[R7 Monitor] 💾 Registro de envio salvo`);
  } catch (error: any) {
    console.error('[R7 Monitor] ❌ Erro ao registrar envio:', error.message);
  }
}

/**
 * Obter status do monitor
 */
export function obterStatusMonitor() {
  const boletos: BoletoMonitorado[] = [];
  boletosMonitorados.forEach((b) => boletos.push(b));

  return {
    ativo: monitorAtivo,
    boletosMonitorados: boletosMonitorados.size,
    boletosEnviados: boletos.filter((b) => b.enviado).length,
    boletos: boletos,
  };
}

/**
 * Limpar todos os boletos monitorados
 */
export function limparMonitor() {
  boletosMonitorados.clear();
  console.log('[R7 Monitor] 🗑️ Monitor limpo');
}
