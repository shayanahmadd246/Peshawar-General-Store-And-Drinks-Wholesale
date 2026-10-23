import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { getDb } from '../db';
import { passwordResetTokens, users } from '../db/schema';
import { hashPassword } from './passwords';
import { HttpError } from './rbac';
import { notifyPasswordReset } from '../email/notify';

const RESET_TTL_MS = 30 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

/** Always returns the same shape — never reveals whether the account exists. */
export async function requestPasswordReset(input: { email?: string; phone?: string }) {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  if (!email && !phone) {
    throw new HttpError(400, 'Email or phone is required.');
  }

  const [row] = email
    ? await getDb().select().from(users).where(eq(users.email, email)).limit(1)
    : await getDb().select().from(users).where(eq(users.phone, phone!)).limit(1);

  // Generic success path even when user missing or has no email
  if (!row || row.status !== 'active') {
    return { accepted: true };
  }

  if (!row.email) {
    return { accepted: true };
  }

  const raw = randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const id = `PRT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  await getDb().insert(passwordResetTokens).values({
    id,
    userId: row.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  await notifyPasswordReset(row.id, raw);
  return { accepted: true };
}

export async function resetPasswordWithToken(input: { token: string; newPassword: string }) {
  const token = input.token?.trim();
  const newPassword = input.newPassword || '';
  if (!token || newPassword.length < 8) {
    throw new HttpError(400, 'A valid reset token and password (min 8 characters) are required.');
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const [row] = await getDb()
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
    .limit(1);

  if (!row) {
    throw new HttpError(400, 'This reset link is invalid or has expired.');
  }

  await getDb()
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, row.userId));

  await getDb()
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, row.id));

  // Invalidate other unused tokens for this user
  await getDb()
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));

  return { success: true };
}

/** Create a one-time password setup link for a newly approved wholesaler. Never emails a plaintext password. */
export async function issuePasswordSetupInvite(userId: string) {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row?.email) {
    return { link: '', token: '' };
  }

  const raw = randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const id = `PRT-INV-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  await getDb().insert(passwordResetTokens).values({
    id,
    userId: row.id,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  const { getAppBaseUrl } = await import('../email/config');
  const link = `${getAppBaseUrl()}/?resetToken=${encodeURIComponent(raw)}`;
  return { link, token: raw };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  if (!currentPassword || newPassword.length < 8) {
    throw new HttpError(400, 'Current password and a new password (min 8 characters) are required.');
  }
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new HttpError(401, 'Unauthorized');

  const { verifyPassword } = await import('./passwords');
  const ok = await verifyPassword(currentPassword, row.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid credentials.');

  await getDb()
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));

  return { success: true };
}
