import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { runMigrations } from '../src/db/migrate.ts';
import { getDb } from '../src/db/index.ts';
import { emailOutbox, users, wholesalerApplications, wholesalers } from '../src/db/schema.ts';
import { seedDevelopmentData } from '../src/db/seed.ts';
import { authenticateUser } from '../src/auth/service.ts';
import {
  approveWholesalerApplication,
  rejectWholesalerApplication,
  submitWholesalerApplication,
} from '../src/auth/wholesalerApplications.ts';
import { resetPasswordWithToken } from '../src/auth/passwordReset.ts';
import { passwordResetTokens } from '../src/db/schema.ts';

describe('wholesaler applications', () => {
  before(async () => {
    process.env.MAIL_MODE = 'console';
    process.env.MAIL_DRY_RUN = '1';
    await runMigrations();
    await seedDevelopmentData();
  });

  it('submits pending application, blocks duplicates, approves with invite (no plaintext password), and rejects others', async () => {
    const stamp = Date.now();
    const email = `apply-${stamp}@market.pk`;
    const phone = `0388${String(stamp).slice(-7)}`;

    const submitted = await submitWholesalerApplication({
      businessName: `Test Wholesale ${stamp}`,
      applicantName: 'Applicant One',
      email,
      phone,
      location: 'Peshawar',
      description: 'We supply drinks and general store goods across University Road with weekly deliveries.',
      category: 'Beverages',
    });
    assert.equal(submitted.status, 'pending');
    assert.ok(submitted.id.startsWith('WAPP-'));

    await assert.rejects(
      () =>
        submitWholesalerApplication({
          businessName: `Dup ${stamp}`,
          applicantName: 'Applicant One',
          email,
          phone: `0377${String(stamp).slice(-7)}`,
          location: 'Peshawar',
          description: 'Duplicate pending application should be rejected by the server.',
          category: 'Beverages',
        }),
      /already pending/i
    );

    const admin = await authenticateUser({ email: 'admin@market.pk', password: 'admin123', expectedRole: 'admin' });

    const approved = await approveWholesalerApplication(submitted.id, { id: admin.user.id, name: admin.user.name });
    assert.equal(approved.alreadyApproved, false);
    assert.ok(approved.wholesaler?.id || (approved as { wholesalerId?: string }).wholesalerId);

    const tenantId = approved.wholesaler?.id || (approved as { wholesalerId?: string }).wholesalerId!;
    const [tenant] = await getDb().select().from(wholesalers).where(eq(wholesalers.id, tenantId)).limit(1);
    assert.equal(tenant.ownerEmail, email);

    const [owner] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    assert.equal(owner.role, 'wholesaler');
    assert.equal(owner.tenantId, tenantId);

    const tokens = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, owner.id));
    assert.ok(tokens.length >= 1);

    // Simulate applicant setting password via invite token stored in DB hash — insert known token for assertion
    const { createHash, randomBytes } = await import('crypto');
    const raw = randomBytes(16).toString('hex');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await getDb().insert(passwordResetTokens).values({
      id: `PRT-APP-TEST-${stamp}`,
      userId: owner.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await resetPasswordWithToken({ token: raw, newPassword: 'WholesalerPass9' });
    const login = await authenticateUser({ email, password: 'WholesalerPass9', expectedRole: 'wholesaler' });
    assert.equal(login.user.tenantId, tenantId);

    const outbox = await getDb()
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.eventKey, `wholesaler_application_approved:${submitted.id}`));
    assert.equal(outbox.length, 1);
    assert.ok(!JSON.stringify(outbox[0].payload).toLowerCase().includes('wholesalerpass'));

    // Reject path on a separate application
    const email2 = `reject-${stamp}@market.pk`;
    const phone2 = `0366${String(stamp).slice(-7)}`;
    const rejectedApp = await submitWholesalerApplication({
      businessName: `Reject Me ${stamp}`,
      applicantName: 'Applicant Two',
      email: email2,
      phone: phone2,
      location: 'Charsadda',
      description: 'Application that should be rejected cleanly with optional reason email.',
      category: 'Grains',
    });
    const rejected = await rejectWholesalerApplication(rejectedApp.id, { id: admin.user.id, name: admin.user.name }, 'Incomplete documents');
    assert.equal(rejected.alreadyRejected, false);
    assert.equal(rejected.application.status, 'rejected');

    const [noUser] = await getDb().select().from(users).where(eq(users.email, email2)).limit(1);
    assert.equal(noUser, undefined);

    const [appRow] = await getDb()
      .select()
      .from(wholesalerApplications)
      .where(and(eq(wholesalerApplications.id, rejectedApp.id), eq(wholesalerApplications.status, 'rejected')))
      .limit(1);
    assert.equal(appRow.rejectReason, 'Incomplete documents');
  });
});
