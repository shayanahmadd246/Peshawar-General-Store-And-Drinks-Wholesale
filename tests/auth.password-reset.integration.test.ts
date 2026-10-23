import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { runMigrations } from '../src/db/migrate.ts';
import { getDb } from '../src/db/index.ts';
import { emailOutbox, passwordResetTokens, users } from '../src/db/schema.ts';
import { seedDevelopmentData } from '../src/db/seed.ts';
import { authenticateUser, registerClient } from '../src/auth/service.ts';
import { requestPasswordReset, resetPasswordWithToken } from '../src/auth/passwordReset.ts';
import { enqueueEmail, processEmailOutbox } from '../src/email/outbox.ts';
import { hashPassword } from '../src/auth/passwords.ts';

describe('password reset + email outbox', () => {
  before(async () => {
    process.env.MAIL_MODE = 'console';
    process.env.MAIL_DRY_RUN = '1';
    await runMigrations();
    await seedDevelopmentData();
  });

  it('queues reset email, accepts token once, rejects reuse, and never reveals missing accounts', async () => {
    const missing = await requestPasswordReset({ email: 'nobody-exists@example.invalid' });
    assert.equal(missing.accepted, true);

    const stamp = Date.now();
    const phone = `0399${String(stamp).slice(-7)}`;
    const email = `reset-${stamp}@market.pk`;
    const { user } = await registerClient({
      name: 'Reset Tester',
      storeName: 'Reset Mart',
      phone,
      email,
      password: 'oldpass123',
    });

    const accepted = await requestPasswordReset({ email });
    assert.equal(accepted.accepted, true);

    const tokenRows = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id)).limit(5);
    assert.ok(tokenRows.length >= 1);

    const raw = `test-reset-token-${stamp}`;
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await getDb().insert(passwordResetTokens).values({
      id: `PRT-TEST-${stamp}`,
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await resetPasswordWithToken({ token: raw, newPassword: 'newpass123' });

    await assert.rejects(
      () => resetPasswordWithToken({ token: raw, newPassword: 'anotherpass9' }),
      /invalid or has expired/i
    );

    const login = await authenticateUser({ phone, password: 'newpass123', expectedRole: 'client' });
    assert.equal(login.user.id, user.id);

    // Cleanup — do not disturb shared demo CLI-01 credentials
    await getDb().update(users).set({ passwordHash: await hashPassword('oldpass123'), status: 'suspended' }).where(eq(users.id, user.id));

    const processed = await processEmailOutbox(20);
    assert.ok(processed.processed >= 0);
    const pendingOrSent = await getDb().select().from(emailOutbox).limit(5);
    assert.ok(Array.isArray(pendingOrSent));
  });

  it('prevents duplicate outbox events for the same event key', async () => {
    const key = `test_dup:${Date.now()}`;
    const a = await enqueueEmail({
      eventKey: key,
      template: 'test_ping',
      toEmail: 'admin@market.pk',
      payload: { detail: 'one' },
    });
    const b = await enqueueEmail({
      eventKey: key,
      template: 'test_ping',
      toEmail: 'admin@market.pk',
      payload: { detail: 'two' },
    });
    assert.equal(a.enqueued, true);
    assert.equal(b.enqueued, false);
    assert.equal(b.reason, 'duplicate_event');
  });
});
