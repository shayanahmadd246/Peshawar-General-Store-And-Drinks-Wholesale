/**
 * Verify SMTP connectivity (LOGIN + handshake) without sending mail.
 * Reads credentials from .env only. Never prints secrets.
 */
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config({ quiet: true });

function mask(value) {
  if (!value) return '(missing)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}…${value.slice(-2)} (len=${value.length})`;
}

const mode = (process.env.MAIL_MODE || '').trim().toLowerCase();
const host = (process.env.SMTP_HOST || '').trim();
const port = Number(process.env.SMTP_PORT || 0);
const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1' || port === 465;
const user = (process.env.SMTP_USER || '').trim();
const pass = process.env.SMTP_PASS || '';
const from = (process.env.MAIL_FROM || '').trim();

console.log('SMTP verify (no email will be sent)');
console.log('  MAIL_MODE =', mode || '(unset)');
console.log('  SMTP_HOST =', host || '(missing)');
console.log('  SMTP_PORT =', port || '(missing)');
console.log('  SMTP_SECURE =', secure);
console.log('  SMTP_USER =', user || '(missing)');
console.log('  SMTP_PASS =', pass ? mask(pass) : '(missing)');
console.log('  MAIL_FROM =', from || '(missing)');

const missing = [];
if (mode !== 'smtp') missing.push('MAIL_MODE must be smtp');
if (!host) missing.push('SMTP_HOST');
if (!port) missing.push('SMTP_PORT');
if (!user) missing.push('SMTP_USER');
if (!pass.trim()) missing.push('SMTP_PASS (Google App Password)');
if (!from) missing.push('MAIL_FROM');

if (missing.length) {
  console.error('Configuration incomplete:', missing.join(', '));
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log('Result: OK — Gmail SMTP accepted the connection and credentials.');
  console.log('No message was sent.');
  process.exit(0);
} catch (err) {
  const code = err?.code || err?.responseCode || '';
  const response = String(err?.response || err?.message || 'unknown error');
  // Strip anything that might echo the password back
  const safe = response.replace(pass, '[redacted]').slice(0, 300);
  console.error('Result: FAILED — SMTP verification error.');
  if (code) console.error('  code:', code);
  console.error('  detail:', safe);
  if (/Invalid login|Username and Password not accepted|EAUTH/i.test(safe)) {
    console.error('Hint: Use a Google App Password (16 characters), not your normal Gmail password.');
    console.error('      Google Account → Security → 2-Step Verification → App passwords.');
  }
  process.exit(1);
}
