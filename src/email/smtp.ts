import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export function createTransport(config: AppConfig) {
  if (!config.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPass || !config.smtpFrom) {
    throw new Error('SMTP não configurado. Preencha SMTP_HOST/PORT/USER/PASS/FROM no .env');
  }
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: Boolean(config.smtpSecure),
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    }
  });
  return transporter;
}

export async function sendOtpEmail(
  config: AppConfig,
  params: { to: string; code: string; cpf: string }
): Promise<void> {
  const transporter = createTransport(config);
  const subject = 'Seu código de verificação';
  const text = [
    `Olá,`,
    ``,
    `Seu código de verificação é: ${params.code}`,
    `CPF: ${params.cpf}`,
    ``,
    `Este código expira em ${config.otpExpiresMinutes} minutos.`,
  ].join('\n');

  await transporter.sendMail({
    from: config.smtpFrom!,
    to: params.to,
    subject,
    text
  });
}



