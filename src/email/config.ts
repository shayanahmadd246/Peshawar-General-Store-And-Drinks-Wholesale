import { isProduction } from '../config/env';

export type MailMode = 'console' | 'smtp' | 'disabled';

export function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

export function getMailFrom(): string {
  return process.env.MAIL_FROM?.trim() || 'Peshawar Wholesale OS <noreply@wholesale.local>';
}

export function getMailMode(): MailMode {
  const explicit = process.env.MAIL_MODE?.trim().toLowerCase();
  if (explicit === 'console' || explicit === 'smtp' || explicit === 'disabled') return explicit;
  if (process.env.SMTP_HOST?.trim()) return 'smtp';
  if (isProduction()) return 'disabled';
  return 'console';
}

export function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST?.trim() || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER?.trim() || '',
    pass: process.env.SMTP_PASS || '',
  };
}

/** When true, outbox worker runs but never opens a network SMTP connection. */
export function isMailDryRun(): boolean {
  return (
    process.env.MAIL_DRY_RUN === '1' ||
    process.env.MAIL_DRY_RUN === 'true' ||
    process.env.NODE_ENV === 'test' ||
    process.env.npm_lifecycle_event === 'test' ||
    process.argv.some((a) => a.includes('test'))
  );
}
