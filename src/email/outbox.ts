import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { emailOutbox } from '../db/schema';
import { type EmailTemplateId, renderEmailTemplate } from './templates';
import { sendMail } from './provider';

const MAX_ATTEMPTS = 5;

export async function enqueueEmail(input: {
  eventKey: string;
  template: EmailTemplateId;
  toEmail: string;
  toUserId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ enqueued: boolean; id?: string; reason?: string }> {
  const toEmail = input.toEmail.trim().toLowerCase();
  if (!toEmail || !toEmail.includes('@')) {
    return { enqueued: false, reason: 'no_valid_email' };
  }

  const rendered = renderEmailTemplate(input.template, {
    ...(input.payload || {}),
  });

  const id = `MAIL-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  try {
    await getDb().insert(emailOutbox).values({
      id,
      eventKey: input.eventKey,
      template: input.template,
      toEmail,
      toUserId: input.toUserId || null,
      subject: rendered.subject,
      payload: input.payload || {},
      status: 'pending',
      attempts: 0,
      scheduledAt: new Date(),
    });
    return { enqueued: true, id };
  } catch (err: any) {
    // Unique event_key → duplicate prevention (pg / drizzle may nest the code)
    const code = String(err?.code || err?.cause?.code || '');
    const msg = String(err?.message || err?.cause?.message || '');
    if (code === '23505' || /unique|duplicate key/i.test(msg)) {
      return { enqueued: false, reason: 'duplicate_event' };
    }
    throw err;
  }
}

export async function processEmailOutbox(limit = 20): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date();
  const rows = await getDb()
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, 'pending'), lte(emailOutbox.scheduledAt, now)))
    .orderBy(asc(emailOutbox.scheduledAt))
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const rendered = renderEmailTemplate(row.template as EmailTemplateId, (row.payload || {}) as Record<string, unknown>);
    try {
      await sendMail({
        to: row.toEmail,
        subject: row.subject || rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await getDb()
        .update(emailOutbox)
        .set({
          status: 'sent',
          sentAt: new Date(),
          attempts: row.attempts + 1,
          lastError: null,
        })
        .where(eq(emailOutbox.id, row.id));
      sent += 1;
    } catch (err: any) {
      const attempts = row.attempts + 1;
      const message = String(err?.message || 'send_failed').slice(0, 500);
      const giveUp = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(60_000 * 2 ** Math.min(attempts, 5), 30 * 60_000);
      await getDb()
        .update(emailOutbox)
        .set({
          status: giveUp ? 'failed' : 'pending',
          attempts,
          lastError: message,
          scheduledAt: giveUp ? row.scheduledAt : new Date(Date.now() + backoffMs),
        })
        .where(eq(emailOutbox.id, row.id));
      failed += 1;
      console.warn(`[email-outbox] ${row.id} attempt ${attempts}: ${message}`);
    }
  }

  return { processed: rows.length, sent, failed };
}

export async function getOutboxStats() {
  const rows = await getDb()
    .select({
      status: emailOutbox.status,
      count: sql<number>`count(*)::int`,
    })
    .from(emailOutbox)
    .groupBy(emailOutbox.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startEmailOutboxWorker(intervalMs = 8000) {
  if (workerTimer || process.env.NODE_ENV === 'test') return;
  workerTimer = setInterval(() => {
    processEmailOutbox().catch((err) => console.warn('[email-outbox] worker error:', err?.message || err));
  }, intervalMs);
  // Unref so it does not keep Node alive in scripts unexpectedly when supported
  if (typeof (workerTimer as any).unref === 'function') (workerTimer as any).unref();
}
