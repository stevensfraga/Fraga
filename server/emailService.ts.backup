/**
 * Serviço de envio de e-mails via SMTP
 * Integrado com a régua de cobrança automática
 * ⚠️ RESTRIÇÃO: Apenas envia mensagens entre 8h-18h, segunda a sexta
 */

import nodemailer from "nodemailer";
import { getDb } from "./db";
import { collectionSchedule, clients } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { isBusinessHours, formatNextSendTime } from "./businessHoursValidator";

// Configurar transporter SMTP
let transporter: nodemailer.Transporter | null = null;

function initializeTransporter() {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;
  const smtpFromName = process.env.SMTP_FROM_NAME || "Fraga Contabilidade";

  if (!smtpUser || !smtpPassword) {
    console.warn("[Email] SMTP não configurado. Emails não serão enviados.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true para 465, false para outros portos
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });

  console.log(`[Email] Transporter SMTP inicializado: ${smtpHost}:${smtpPort}`);
  return transporter;
}

/**
 * Enviar e-mail de cobrança
 * Verifica horário comercial antes de enviar
 */
export async function sendCollectionEmail(
  clientEmail: string,
  clientName: string,
  stage: string,
  amount: number,
  dueDate: string,
  boletoUrl?: string
): Promise<{ success: boolean; error?: string; postponed?: boolean; nextSendTime?: string }> {
  try {
    // Validar horário comercial
    const now = new Date();
    if (!isBusinessHours(now)) {
      const nextTime = formatNextSendTime(now);
      console.log(`[Email] ⏰ Fora do horário comercial. ${nextTime}`);
      return {
        success: false,
        error: `E-mail agendado. Será enviado no próximo horário comercial (8h-18h, seg-sex)`,
        postponed: true,
        nextSendTime: nextTime,
      };
    }

    const transport = initializeTransporter();
    if (!transport) {
      console.warn("[Email] SMTP não configurado. Email não enviado.");
      return { success: false, error: "SMTP não configurado" };
    }

    // Mapear estágio para assunto e corpo
    const emailTemplates: Record<string, { subject: string; body: string }> = {
      d_plus_3: {
        subject: "Aviso: Sua conta está vencida",
        body: `Olá ${clientName},\n\nDetectamos que sua conta com vencimento em ${dueDate} ainda não foi paga.\n\nValor: R$ ${amount.toFixed(2)}\n\nPor favor, regularize sua situação o quanto antes.\n\nAtenciosamente,\nFraga Contabilidade`,
      },
      d_plus_7: {
        subject: "Cobrança Administrativa - Ação Necessária",
        body: `Olá ${clientName},\n\nEsta é uma cobrança administrativa referente à sua conta em atraso.\n\nValor: R$ ${amount.toFixed(2)}\nVencimento Original: ${dueDate}\n\nSolicitamos que regularize sua situação imediatamente.\n\nAtenciosamente,\nFraga Contabilidade`,
      },
      d_plus_15: {
        subject: "Aviso Formal - Conta em Atraso",
        body: `Olá ${clientName},\n\nInformamos que sua conta continua em atraso há mais de 15 dias.\n\nValor: R$ ${amount.toFixed(2)}\nData de Vencimento: ${dueDate}\n\nSolicita-se o pagamento imediato para evitar medidas legais.\n\nAtenciosamente,\nFraga Contabilidade`,
      },
      d_plus_30: {
        subject: "Notificação Formal - Atraso de 30 Dias",
        body: `Olá ${clientName},\n\nSua conta encontra-se em atraso há 30 dias.\n\nValor: R$ ${amount.toFixed(2)}\nData de Vencimento: ${dueDate}\n\nEsta é uma notificação formal. O não pagamento resultará em ações legais.\n\nAtenciosamente,\nFraga Contabilidade`,
      },
      d_plus_45: {
        subject: "Última Notificação - Atraso de 45 Dias",
        body: `Olá ${clientName},\n\nSua conta está em atraso há 45 dias. Esta é nossa última notificação antes de ações legais.\n\nValor: R$ ${amount.toFixed(2)}\nData de Vencimento: ${dueDate}\n\nSolicita-se pagamento imediato.\n\nAtenciosamente,\nFraga Contabilidade`,
      },
      d_plus_60: {
        subject: "Suspensão Administrativa - Atraso Crítico",
        body: `Olá ${clientName},\n\nSua conta foi suspensa administrativamente devido ao atraso de 60 dias.\n\nValor: R$ ${amount.toFixed(2)}\nData de Vencimento: ${dueDate}\n\nProcure nosso departamento de cobrança imediatamente para regularizar sua situação.\n\nAtenciosamente,\nFraga Contabilidade`,
      },
    };

    const template = emailTemplates[stage] || {
      subject: "Cobrança - Fraga Contabilidade",
      body: `Olá ${clientName},\n\nValor: R$ ${amount.toFixed(2)}\nData de Vencimento: ${dueDate}\n\nAtenciosamente,\nFraga Contabilidade`,
    };

    let htmlBody = `<html><body><p>${template.body.replace(/\n/g, "<br>")}</p>`;

    if (boletoUrl) {
      htmlBody += `<p><a href="${boletoUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Clique aqui para visualizar o boleto</a></p>`;
    }

    htmlBody += `</body></html>`;

    const mailOptions = {
      from: `${process.env.SMTP_FROM_NAME || "Fraga Contabilidade"} <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: clientEmail,
      subject: template.subject,
      text: template.body,
      html: htmlBody,
    };

    const info = await transport.sendMail(mailOptions);

    console.log(`[Email] ✅ E-mail enviado para ${clientEmail}:`, info.messageId);

    return { success: true };
  } catch (error: any) {
    console.error(`[Email] ❌ Erro ao enviar e-mail:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Enviar e-mail de cancelamento da régua ao cliente
 * Verifica horário comercial antes de enviar
 */
export async function sendPaymentConfirmationEmail(
  clientEmail: string,
  clientName: string,
  amountPaid: number,
  paymentDate: string
): Promise<{ success: boolean; error?: string; postponed?: boolean; nextSendTime?: string }> {
  try {
    // Validar horário comercial
    const now = new Date();
    if (!isBusinessHours(now)) {
      const nextTime = formatNextSendTime(now);
      console.log(`[Email] ⏰ Fora do horário comercial. ${nextTime}`);
      return {
        success: false,
        error: `E-mail agendado. Será enviado no próximo horário comercial (8h-18h, seg-sex)`,
        postponed: true,
        nextSendTime: nextTime,
      };
    }

    const transport = initializeTransporter();
    if (!transport) {
      console.warn("[Email] SMTP não configurado. Email não enviado.");
      return { success: false, error: "SMTP não configurado" };
    }

    const subject = "Pagamento Confirmado - Obrigado!";
    const body = `Olá ${clientName},\n\nConfirmamos o recebimento do seu pagamento.\n\nValor Pago: R$ ${amountPaid.toFixed(2)}\nData: ${paymentDate}\n\nSua conta foi regularizada. Obrigado!\n\nAtenciosamente,\nFraga Contabilidade`;

    const htmlBody = `<html><body><p>${body.replace(/\n/g, "<br>")}</p></body></html>`;

    const mailOptions = {
      from: `${process.env.SMTP_FROM_NAME || "Fraga Contabilidade"} <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: clientEmail,
      subject: subject,
      text: body,
      html: htmlBody,
    };

    const info = await transport.sendMail(mailOptions);

    console.log(`[Email] ✅ E-mail de confirmação enviado para ${clientEmail}:`, info.messageId);

    return { success: true };
  } catch (error: any) {
    console.error(`[Email] ❌ Erro ao enviar e-mail de confirmação:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Testar conexão SMTP
 */
export async function testSMTPConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const transport = initializeTransporter();
    if (!transport) {
      return { success: false, error: "SMTP não configurado" };
    }

    await transport.verify();
    console.log("[Email] ✅ Conexão SMTP verificada com sucesso");
    return { success: true };
  } catch (error: any) {
    console.error("[Email] ❌ Erro ao verificar conexão SMTP:", error.message);
    return { success: false, error: error.message };
  }
}


/**
 * Enviar e-mail de reset para clientes > 60 dias
 */
export async function sendResetEmail(
  clientEmail: string,
  clientName: string,
  amountOverdue: number
): Promise<{ success: boolean; error?: string; postponed?: boolean; nextSendTime?: string }> {
  try {
    // Validar horário comercial
    const now = new Date();
    if (!isBusinessHours(now)) {
      const nextTime = formatNextSendTime(now);
      console.log(`[Email] ⏰ Fora do horário comercial. ${nextTime}`);
      return {
        success: false,
        error: `E-mail agendado. Será enviado no próximo horário comercial (8h-18h, seg-sex)`,
        postponed: true,
        nextSendTime: nextTime,
      };
    }

    const transport = initializeTransporter();
    if (!transport) {
      console.warn("[Email] SMTP não configurado. Email não enviado.");
      return { success: false, error: "SMTP não configurado" };
    }

    const subject = "Atenção: Sua Conta Requer Ação Imediata";
    const body = `Olá ${clientName},\n\nSua conta encontra-se em atraso crítico (superior a 60 dias).\n\nValor em Atraso: R$ ${amountOverdue.toFixed(2)}\n\nEsta situação requer ação imediata. Procure nosso departamento de cobrança para regularizar sua conta.\n\nAtenciosamente,\nFraga Contabilidade`;

    const htmlBody = `<html><body><p>${body.replace(/\n/g, "<br>")}</p></body></html>`;

    const mailOptions = {
      from: `${process.env.SMTP_FROM_NAME || "Fraga Contabilidade"} <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: clientEmail,
      subject: subject,
      text: body,
      html: htmlBody,
    };

    const info = await transport.sendMail(mailOptions);

    console.log(`[Email] ✅ E-mail de reset enviado para ${clientEmail}:`, info.messageId);

    return { success: true };
  } catch (error: any) {
    console.error(`[Email] ❌ Erro ao enviar e-mail de reset:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Enviar e-mail com PDF da NFS-e
 * Enviado automaticamente quando NF é emitida
 * ⚠️ SEM restrição de horário comercial (é para o cliente)
 */
export async function sendNfseEmail(
  clientEmail: string,
  clientName: string,
  numeroNfse: string,
  pdfBuffer: Buffer,
  empresaNome: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientEmail) {
      console.warn("[Email-NFSE] ⚠️ Email do cliente não fornecido");
      return { success: false, error: "Email do cliente não fornecido" };
    }

    const transport = initializeTransporter();
    if (!transport) {
      console.warn("[Email-NFSE] SMTP não configurado. Email NFS-e não enviado.");
      return { success: false, error: "SMTP não configurado" };
    }

    console.log(`[Email-NFSE] 📧 Preparando envio para ${clientEmail}...`);

    const smtpFromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "nao-responda@fragacontabilidade.com.br";
    const smtpFromName = process.env.SMTP_FROM_NAME || "Fraga Contabilidade";

    const mailOptions = {
      from: `${smtpFromName} <${smtpFromEmail}>`,
      to: clientEmail,
      subject: `✅ Sua Nota Fiscal de Serviço (NFS-e) ${numeroNfse} está pronta!`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #2ecc71;">✅ Nota Fiscal Emitida com Sucesso!</h2>
              
              <p>Olá <strong>${clientName}</strong>,</p>
              
              <p>Sua Nota Fiscal de Serviço (NFS-e) foi emitida com sucesso!</p>
              
              <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Número da NFS-e:</strong> ${numeroNfse}</p>
                <p><strong>Empresa Emissora:</strong> ${empresaNome}</p>
                <p><strong>Data de Emissão:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
              </div>
              
              <p>O PDF da sua nota fiscal está anexado neste email.</p>
              
              <p>Caso tenha dúvidas, não hesite em entrar em contato conosco pelo WhatsApp ou telefone.</p>
              
              <p style="margin-top: 30px; color: #666; font-size: 12px;">
                <strong>Fraga Contabilidade</strong><br/>
                Qualquer dúvida, estamos à disposição! 😊
              </p>
            </div>
          </body>
        </html>
      `,
      text: `Olá ${clientName},\n\nSua Nota Fiscal de Serviço (NFS-e) ${numeroNfse} foi emitida com sucesso pela ${empresaNome}.\n\nO PDF está anexado neste email.\n\nFraga Contabilidade`,
      attachments: [
        {
          filename: `NFS-e_${numeroNfse}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    const result = await transport.sendMail(mailOptions);
    
    console.log(`[Email-NFSE] ✅ Email enviado com sucesso para ${clientEmail} | messageId: ${result.messageId}`);
    return { success: true };

  } catch (error: any) {
    console.error(`[Email-NFSE] ❌ Erro ao enviar email: ${error.message}`);
    return { success: false, error: error.message };
  }
}
