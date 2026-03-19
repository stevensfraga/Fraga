/**
 * Job agendado para executar a régua de cobrança
 * Roda a cada hora para verificar e enviar mensagens pendentes
 * ⚠️ Apenas envia mensagens entre 8h-18h, segunda a sexta
 */

import { getPendingSchedules, markScheduleAsSent, recordScheduleError } from "./collectionScheduleManager";
import { getCollectionTemplate, formatTemplate } from "./collectionRuleTemplates";
import { sendWhatsAppMessage } from "./zapContabilIntegration";
import { getClientsOver60DaysOverdue, sendResetMessageToClient } from "./collectionResetManager";
import { isBusinessHours, getNextBusinessHours, formatNextSendTime } from "./businessHoursValidator";

let jobRunning = false;
let lastRunTime = new Date();

/**
 * Executar job de cobrança
 */
export async function runCollectionScheduleJob() {
  // Evitar múltiplas execuções simultâneas
  if (jobRunning) {
    console.log("[Collection Job] Job já está em execução, pulando...");
    return;
  }

  jobRunning = true;
  const startTime = new Date();

  try {
    console.log("[Collection Job] 🚀 Iniciando job de cobrança automática...");

    // Verificar se está em horário comercial
    const now = new Date();
    if (!isBusinessHours(now)) {
      const nextTime = formatNextSendTime(now);
      console.log(`[Collection Job] ⏰ Fora do horário comercial (8h-18h, seg-sex). ${nextTime}`);
      jobRunning = false;
      lastRunTime = new Date();
      return;
    }

    // Buscar agendamentos pendentes
    const pending = await getPendingSchedules();

    if (pending.length === 0) {
      console.log("[Collection Job] ✅ Nenhum agendamento pendente");
      jobRunning = false;
      lastRunTime = new Date();
      return;
    }

    console.log(`[Collection Job] Processando ${pending.length} agendamentos...`);

    // Verificar clientes com atraso > 60 dias
    const clientsOver60 = await getClientsOver60DaysOverdue();
    if (clientsOver60.length > 0) {
      console.log(`[Collection Job] 🚨 ${clientsOver60.length} clientes com atraso > 60 dias`);
      for (const { client, receivable } of clientsOver60) {
        try {
          await sendResetMessageToClient(client.id, parseFloat(receivable.amount));
          console.log(`[Collection Job] ✅ Mensagem de reset enviada para ${client.name}`);
        } catch (error: any) {
          console.error(`[Collection Job] ❌ Erro ao enviar reset para ${client.name}:`, error.message);
        }
      }
    }

    let sent = 0;
    let failed = 0;

    // Processar cada agendamento
    for (const item of pending) {
      try {
        const { schedule, client, receivable } = item;

        console.log(
          `[Collection Job] Processando agendamento ${schedule.id} para cliente ${client.name}`
        );

        // Obter template
        const template = getCollectionTemplate(schedule.stage);
        if (!template) {
          console.error(`[Collection Job] Template não encontrado para estágio ${schedule.stage}`);
          failed++;
          continue;
        }

        // Calcular variáveis
        const daysOverdue = Math.floor(
          (new Date().getTime() - new Date(receivable.dueDate).getTime()) / (1000 * 60 * 60 * 24)
        );

        const variables = {
          clientName: client.name || "Cliente",
          dueDate: new Date(receivable.dueDate).toLocaleDateString("pt-BR"),
          paymentLink: `https://boleto.contaazul.com/...`, // TODO: Obter link real do Conta Azul
          companyName: "Fraga Contabilidade",
          amount: receivable.amount.toString(),
          daysOverdue,
        };

        let whatsappMessageId: string | undefined;
        let emailMessageId: string | undefined;

        // Enviar WhatsApp
        if (schedule.channels.includes("whatsapp") && client.whatsappNumber && template.whatsappTemplate) {
          try {
            const whatsappContent = formatTemplate(template.whatsappTemplate, variables);
            console.log(`[Collection Job] Enviando WhatsApp para ${client.whatsappNumber}...`);

            // Enviar via Zap Contábil
            const result = await sendWhatsAppMessage({
              phone: client.whatsappNumber,
              message: whatsappContent,
              clientName: client.name,
              clientId: client.id.toString(),
            });

            if (result.success && result.messageId) {
              whatsappMessageId = result.messageId;
              console.log(`[Collection Job] ✅ WhatsApp enviado para ${client.whatsappNumber}`);
            } else {
              console.error(
                `[Collection Job] ❌ Erro ao enviar WhatsApp: ${result.error}`
              );
              await recordScheduleError(schedule.id, result.error || "Erro desconhecido");
            }
          } catch (error: any) {
            console.error(
              `[Collection Job] ❌ Erro ao enviar WhatsApp para ${client.whatsappNumber}:`,
              error.message
            );
            await recordScheduleError(schedule.id, error.message);
          }
        }

        // Enviar E-mail
        if (schedule.channels.includes("email") && client.email && template.emailTemplate) {
          try {
            const emailContent = formatTemplate(template.emailTemplate, variables);
            console.log(`[Collection Job] Enviando e-mail para ${client.email}...`);

            // TODO: Implementar envio real via SMTP
            // emailMessageId = await sendEmailMessage(client.email, template.name, emailContent);

            console.log(`[Collection Job] ✅ E-mail enviado para ${client.email}`);
          } catch (error: any) {
            console.error(`[Collection Job] ❌ Erro ao enviar e-mail para ${client.email}:`, error.message);
            await recordScheduleError(schedule.id, error.message);
            failed++;
            continue;
          }
        }

        // Marcar como enviado
        await markScheduleAsSent(schedule.id, whatsappMessageId, emailMessageId);
        sent++;
      } catch (error: any) {
        console.error("[Collection Job] Erro ao processar agendamento:", error.message);
        failed++;
      }
    }

    const duration = new Date().getTime() - startTime.getTime();
    console.log(
      `[Collection Job] ✅ Job concluído: ${sent} enviados, ${failed} falhados em ${duration}ms`
    );

    lastRunTime = new Date();
  } catch (error: any) {
    console.error("[Collection Job] ❌ Erro fatal no job:", error.message);
  } finally {
    jobRunning = false;
  }
}

/**
 * Agendar job para rodar a cada hora
 */
export function scheduleCollectionJob() {
  console.log("[Collection Job] Agendando job de cobrança para rodar a cada hora...");
  console.log("[Collection Job] ⏰ Mensagens serão enviadas apenas entre 8h-18h, segunda a sexta");

  // Rodar imediatamente na primeira vez
  runCollectionScheduleJob().catch((error) => {
    console.error("[Collection Job] Erro ao executar job inicial:", error);
  });

  // Rodar a cada hora
  setInterval(() => {
    runCollectionScheduleJob().catch((error) => {
      console.error("[Collection Job] Erro ao executar job agendado:", error);
    });
  }, 60 * 60 * 1000); // 1 hora

  console.log("[Collection Job] ✅ Job agendado com sucesso");
}

/**
 * Obter informações do último job executado
 */
export function getLastJobInfo() {
  return {
    lastRunTime,
    isRunning: jobRunning,
  };
}
