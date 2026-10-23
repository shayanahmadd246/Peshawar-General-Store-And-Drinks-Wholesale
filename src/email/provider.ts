import nodemailer from 'nodemailer';
import { getMailFrom, getMailMode, getSmtpConfig, isMailDryRun } from './config';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  provider: string;
  messageId?: string;
  preview?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const cfg = getSmtpConfig();
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  return transporter;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const mode = getMailMode();
  if (mode === 'disabled') {
    throw new Error('Mail provider disabled (MAIL_MODE=disabled).');
  }

  if (mode === 'console' || isMailDryRun()) {
    const preview = `[mail:${mode}${isMailDryRun() ? '+dry-run' : ''}] to=${input.to} subject=${input.subject}`;
    console.info(preview);
    console.info(input.text.slice(0, 400));
    return { provider: isMailDryRun() ? 'dry-run' : 'console', messageId: `console-${Date.now()}`, preview };
  }

  const cfg = getSmtpConfig();
  if (!cfg.host) {
    throw new Error('SMTP_HOST is required when MAIL_MODE=smtp.');
  }

  const info = await getTransporter().sendMail({
    from: getMailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  return { provider: 'smtp', messageId: String(info.messageId || '') };
}
