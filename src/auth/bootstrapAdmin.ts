import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { hashPassword } from './passwords';
import { isProduction } from '../config/env';

/**
 * Creates the first admin only when none exists.
 * Requires BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD (min 12 chars).
 * Never uses demo passwords. Idempotent.
 */
export async function bootstrapProductionAdmin(): Promise<{ created: boolean; reason: string }> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!email || !password) {
    return { created: false, reason: 'bootstrap_env_unset' };
  }
  if (password.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
  }
  if (/^(admin123|password123|password)$/i.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is too weak for production.');
  }

  const existingAdmins = await getDb().select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (existingAdmins.length > 0) {
    return { created: false, reason: 'admin_exists' };
  }

  const [existingEmail] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL is already registered as a non-admin user.');
  }

  await getDb().insert(users).values({
    id: 'USR-ADMIN',
    name: 'Platform Admin',
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
    tenantId: null,
    status: 'active',
  });

  console.log(`[bootstrap] Created production admin ${email}`);
  return { created: true, reason: 'created' };
}

export async function ensureProductionBootstrap() {
  if (!isProduction()) return;
  await bootstrapProductionAdmin();
}
