import { Alert } from './alertSystem';
import axios from 'axios';

export interface NotificationConfig {
  email?: {
    enabled: boolean;
    recipient: string;
  };
  whatsapp?: {
    enabled: boolean;
    phoneNumber?: string; // Será buscado do cliente
  };
}

const defaultConfig: NotificationConfig = {
  email: {
    enabled: true,
    recipient: 'stevens@fragacontabilidade.com.br'
  },
  whatsapp: {
    enabled: true,
    phoneNumber: undefined // Será buscado do cliente
  }
};

export async function sendAlertNotification(
  alert: Alert,
  config: NotificationConfig = defaultConfig
): Promise<{ email?: boolean; whatsapp?: boolean }> {
  const results = { email: false, whatsapp: false };

  try {
    // Send email notification
    if (config.email?.enabled) {
      results.email = await sendEmailNotification(alert, config.email.recipient);
    }

    // Send WhatsApp notification
    if (config.whatsapp?.enabled && alert.severity === 'critical') {
      results.whatsapp = await sendWhatsAppNotification(alert, config.whatsapp.phoneNumber);
    }

    return results;
  } catch (error) {
    console.error('[Notification Service] Error sending notifications:', error);
    return results;
  }
}

async function sendEmailNotification(alert: Alert, recipient: string): Promise<boolean> {
  try {
    const emailContent = generateEmailContent(alert);

    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    console.log('[Email Notification]', {
      to: recipient,
      subject: emailContent.subject,
      body: emailContent.body
    });

    // Placeholder: Replace with actual email service
    // await sendEmail({
    //   to: recipient,
    //   subject: emailContent.subject,
    //   html: emailContent.html
    // });

    return true;
  } catch (error) {
    console.error('[Email Notification] Error:', error);
    return false;
  }
}

async function sendWhatsAppNotification(alert: Alert, phoneNumber?: string): Promise<boolean> {
  if (!phoneNumber) {
    console.warn('[WhatsApp Notification] No phone number provided');
    return false;
  }
  try {
    const message = generateWhatsAppMessage(alert);

    // Send via ZapContábil API
    const response = await axios.post(
      `${process.env.ZAPCONTABIL_API_URL}/messages/send`,
      {
        phone: phoneNumber,
        message: message,
        type: 'text'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.ZAPCONTABIL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[WhatsApp Notification] Sent successfully:', response.data);
    return true;
  } catch (error) {
    console.error('[WhatsApp Notification] Error:', error);
    return false;
  }
}

function generateEmailContent(alert: Alert) {
  const severityLabel = {
    info: 'Informação',
    warning: 'Aviso',
    critical: 'Crítico'
  }[alert.severity];

  const subject = `[${severityLabel}] ${alert.message}`;

  const body = `
    <h2>${alert.message}</h2>
    <p><strong>Severidade:</strong> ${severityLabel}</p>
    <p><strong>Etapa:</strong> ${alert.stage}</p>
    <p><strong>Valor Atual:</strong> ${alert.currentValue.toFixed(1)}%</p>
    <p><strong>Limite:</strong> ${alert.threshold}%</p>
    <p><strong>Data/Hora:</strong> ${new Date(alert.createdAt).toLocaleString('pt-BR')}</p>
    ${alert.actionTaken ? `<p><strong>Ação Recomendada:</strong> ${alert.actionTaken}</p>` : ''}
    <hr />
    <p><a href="http://localhost:3000/performance">Ver Dashboard de Desempenho</a></p>
  `;

  return {
    subject,
    body,
    html: body
  };
}

function generateWhatsAppMessage(alert: Alert): string {
  const emoji = {
    critical: '🚨',
    warning: '⚠️',
    info: 'ℹ️'
  }[alert.severity];

  const stageLabel = {
    friendly: 'Amigável',
    administrative: 'Administrativa',
    formal: 'Formal'
  }[alert.stage] || alert.stage;

  return `${emoji} *ALERTA DE COBRANÇA*

${alert.message}

📊 Etapa: ${stageLabel}
📈 Valor Atual: ${alert.currentValue.toFixed(1)}%
📉 Limite: ${alert.threshold}%

${alert.actionTaken ? `💡 Ação: ${alert.actionTaken}` : ''}

Acesse o dashboard para mais detalhes.`;
}

export async function sendBulkNotification(
  alerts: Alert[],
  config: NotificationConfig = defaultConfig
): Promise<void> {
  for (const alert of alerts) {
    await sendAlertNotification(alert, config);
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export async function testNotification(
  channel: 'email' | 'whatsapp',
  config: NotificationConfig = defaultConfig
): Promise<boolean> {
  const testAlert: Alert = {
    id: 'test-' + Date.now(),
    type: 'low_response_rate',
    severity: 'warning',
    stage: 'friendly',
    currentValue: 22,
    threshold: 25,
    message: '⚠️ Este é um teste de notificação de alerta',
    createdAt: new Date(),
    actionTaken: 'Revise a mensagem da etapa Amigável'
  };

  if (channel === 'email') {
    return sendEmailNotification(testAlert, config.email?.recipient || 'stevens@fragacontabilidade.com.br');
  } else if (channel === 'whatsapp') {
    return sendWhatsAppNotification(testAlert, config.whatsapp?.phoneNumber || undefined);
  }

  return false;
}
