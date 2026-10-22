import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import dotenv from 'dotenv';

dotenv.config();

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('database-backed authentication', { skip: !hasDatabase }, () => {
  it('migrates, seeds, and authenticates development accounts', async () => {
    const { runMigrations } = await import('../src/db/migrate');
    const { seedDevelopmentData } = await import('../src/db/seed');
    const { authenticateUser } = await import('../src/auth/service');
    const { closeDatabase } = await import('../src/db');

    await runMigrations();
    await seedDevelopmentData();

    const admin = await authenticateUser({
      email: process.env.SEED_ADMIN_EMAIL || 'admin@market.pk',
      password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
      expectedRole: 'admin',
    });
    assert.equal(admin.user.role, 'admin');
    assert.ok(admin.token);

    const wholesaler = await authenticateUser({
      email: 'wholesaler1@market.pk',
      password: process.env.SEED_WHOLESALER_PASSWORD || 'password123',
      expectedRole: 'wholesaler',
    });
    assert.equal(wholesaler.user.tenantId, 'W001');

    const client = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      expectedRole: 'client',
    });
    assert.equal(client.user.role, 'client');

    await closeDatabase();
  });
});
