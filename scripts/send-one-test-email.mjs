/**
 * Sends exactly one admin test email. Never prints JWTs or SMTP secrets.
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@market.pk';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const to = (process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();

if (!to || !to.includes('@')) {
  console.error('No MAIL_FROM/SMTP_USER configured.');
  process.exit(1);
}

const loginRes = await fetch(`${base}/api/auth/admin/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
const login = await loginRes.json();
if (!login.token) {
  console.error('Admin login failed:', loginRes.status, login.error || 'no token');
  process.exit(1);
}

const testRes = await fetch(`${base}/api/admin/email/test`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${login.token}`,
  },
  body: JSON.stringify({ to }),
});
const testBody = await testRes.json();

console.log('Recipient:', to);
console.log('Test HTTP status:', testRes.status);
console.log('success:', Boolean(testBody.success));
console.log('mode:', testBody.mode || null);
console.log('queued:', testBody.queued || null);
console.log('processed:', testBody.processed || null);
if (testBody.error) console.log('error:', testBody.error);

const outRes = await fetch(`${base}/api/admin/email/outbox`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
const outBody = await outRes.json();
console.log('Outbox HTTP status:', outRes.status);
console.log('outbox.mode:', outBody.mode || null);
console.log('outbox.stats:', outBody.stats || null);
if (outBody.error) console.log('outbox.error:', outBody.error);

if (!testRes.ok || !testBody.success) process.exit(1);
