import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { auditEvents, users, wholesalers } from '../db/schema';
import { hashPassword, verifyPassword } from './passwords';
import { signAuthToken } from './tokens';
import { HttpError } from './rbac';
import { allowClientDemoPasswordFallback, getSeedCredentials } from '../config/env';
import type { AuthUser, Role } from './types';

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    role: row.role as Role,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    storeName: row.storeName,
  };
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    storeName: user.storeName,
    role: user.role,
    tenantId: user.tenantId,
  };
}

async function findUserByEmail(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return row;
}

async function findUserByPhone(phone: string) {
  const [row] = await getDb().select().from(users).where(eq(users.phone, phone)).limit(1);
  return row;
}

async function assertActiveAccount(row: typeof users.$inferSelect) {
  if (row.status !== 'active') {
    throw new HttpError(403, 'This account has been suspended by Admin.');
  }
  if (row.role === 'wholesaler' && row.tenantId) {
    const [tenant] = await getDb().select().from(wholesalers).where(eq(wholesalers.id, row.tenantId)).limit(1);
    if (tenant && tenant.status === 'suspended') {
      throw new HttpError(403, 'This wholesaler account has been suspended by Admin.');
    }
  }
}

export async function authenticateUser(input: {
  email?: string;
  phone?: string;
  password?: string;
  expectedRole: Role;
}): Promise<{ user: AuthUser; token: string }> {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  let password = input.password;

  if (!email && !phone) {
    throw new HttpError(400, 'Email or phone is required.');
  }

  const row = email ? await findUserByEmail(email) : await findUserByPhone(phone!);
  if (!row || row.role !== input.expectedRole) {
    throw new HttpError(401, 'Invalid credentials.');
  }

  await assertActiveAccount(row);

  if (!password && input.expectedRole === 'client' && allowClientDemoPasswordFallback()) {
    password = getSeedCredentials().clientPassword;
  }

  if (!password) {
    throw new HttpError(400, 'Password is required.');
  }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials.');
  }

  const user = toAuthUser(row);
  return { user, token: signAuthToken(user) };
}

export async function registerClient(input: {
  name: string;
  storeName: string;
  phone: string;
  password?: string;
}): Promise<{ user: AuthUser; token: string }> {
  const name = input.name.trim();
  const storeName = input.storeName.trim();
  const phone = input.phone.trim();
  if (!name || !storeName || !phone) {
    throw new HttpError(400, 'Name, store name and phone number are required.');
  }

  const existing = await findUserByPhone(phone);
  if (existing) {
    throw new HttpError(409, 'This phone number is already registered. Please sign in.');
  }

  const password = input.password || (allowClientDemoPasswordFallback() ? getSeedCredentials().clientPassword : '');
  if (!password) {
    throw new HttpError(400, 'Password is required.');
  }

  const id = `CLI-${Date.now()}`;
  const [created] = await getDb()
    .insert(users)
    .values({
      id,
      name,
      storeName,
      phone,
      email: null,
      passwordHash: await hashPassword(password),
      role: 'client',
      tenantId: null,
      status: 'active',
    })
    .returning();

  const user = toAuthUser(created);
  return { user, token: signAuthToken(user) };
}

export async function createWholesalerAccount(input: {
  name: string;
  category: string;
  city: string;
  ownerEmail: string;
  phone: string;
  password: string;
  id?: string;
}) {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!input.name || !input.category || !input.city || !ownerEmail || !input.phone || !input.password) {
    throw new HttpError(400, 'All wholesaler fields including password are required.');
  }

  const existingUser = await findUserByEmail(ownerEmail);
  if (existingUser) {
    throw new HttpError(409, 'A user with this email already exists.');
  }

  const existingCount = await getDb().select({ id: wholesalers.id }).from(wholesalers);
  const id = input.id || `W${String(existingCount.length + 1).padStart(3, '0')}`;

  const [wholesaler] = await getDb()
    .insert(wholesalers)
    .values({
      id,
      name: input.name,
      category: input.category,
      city: input.city,
      status: 'active',
      ownerEmail,
      phone: input.phone,
      rating: '5.00',
    })
    .returning();

  await getDb().insert(users).values({
    id: `USR-${id}`,
    name: input.name,
    email: ownerEmail,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    role: 'wholesaler',
    tenantId: id,
    status: 'active',
  });

  return {
    id: wholesaler.id,
    name: wholesaler.name,
    category: wholesaler.category,
    city: wholesaler.city,
    status: wholesaler.status as 'active' | 'suspended',
    ownerEmail: wholesaler.ownerEmail,
    phone: wholesaler.phone,
    rating: Number(wholesaler.rating),
  };
}

export async function setWholesalerStatus(id: string, status: 'active' | 'suspended') {
  const [wholesaler] = await getDb().update(wholesalers).set({ status }).where(eq(wholesalers.id, id)).returning();
  if (!wholesaler) {
    throw new HttpError(404, 'Wholesaler not found');
  }
  await getDb().update(users).set({ status }).where(eq(users.tenantId, id));
  return {
    id: wholesaler.id,
    name: wholesaler.name,
    category: wholesaler.category,
    city: wholesaler.city,
    status: wholesaler.status as 'active' | 'suspended',
    ownerEmail: wholesaler.ownerEmail,
    phone: wholesaler.phone,
    rating: Number(wholesaler.rating),
  };
}

export async function removeWholesaler(id: string) {
  const [existing] = await getDb().select().from(wholesalers).where(eq(wholesalers.id, id)).limit(1);
  if (!existing) {
    throw new HttpError(404, 'Wholesaler not found');
  }
  await getDb().delete(users).where(eq(users.tenantId, id));
  await getDb().delete(wholesalers).where(eq(wholesalers.id, id));
  return {
    id: existing.id,
    name: existing.name,
    category: existing.category,
    city: existing.city,
    status: existing.status as 'active' | 'suspended',
    ownerEmail: existing.ownerEmail,
    phone: existing.phone,
    rating: Number(existing.rating),
  };
}

export async function writeAudit(actor: string, role: string, action: string, details: string) {
  await getDb().insert(auditEvents).values({
    id: `ADT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    actor,
    role,
    action,
    details,
  });
}
