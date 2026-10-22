import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/passwords';
import { signAuthToken, verifyAuthToken } from '../src/auth/tokens';
import { assertRole, assertTenantAccess, hasRole, HttpError } from '../src/auth/rbac';
import type { AuthUser } from '../src/auth/types';

const admin: AuthUser = {
  id: 'USR-ADMIN',
  role: 'admin',
  tenantId: null,
  name: 'Super Admin',
  email: 'admin@market.pk',
  phone: null,
  storeName: null,
};

const wholesalerA: AuthUser = {
  id: 'USR-W001',
  role: 'wholesaler',
  tenantId: 'W001',
  name: 'Khyber',
  email: 'wholesaler1@market.pk',
  phone: null,
  storeName: null,
};

const wholesalerB: AuthUser = {
  id: 'USR-W002',
  role: 'wholesaler',
  tenantId: 'W002',
  name: 'Electronics',
  email: 'wholesaler2@market.pk',
  phone: null,
  storeName: null,
};

describe('password hashing', () => {
  it('hashes and verifies a password without storing plaintext', async () => {
    const hash = await hashPassword('password123');
    assert.notEqual(hash, 'password123');
    assert.equal(await verifyPassword('password123', hash), true);
    assert.equal(await verifyPassword('wrong-password', hash), false);
  });
});

describe('JWT tokens', () => {
  it('signs and verifies role and tenant claims', () => {
    const token = signAuthToken(wholesalerA);
    const decoded = verifyAuthToken(token);
    assert.equal(decoded.id, 'USR-W001');
    assert.equal(decoded.role, 'wholesaler');
    assert.equal(decoded.tenantId, 'W001');
  });

  it('rejects a tampered token', () => {
    const token = signAuthToken(admin);
    assert.throws(() => verifyAuthToken(token + 'x'));
  });
});

describe('RBAC and tenant isolation', () => {
  it('allows admin and denies client for admin-only roles', () => {
    assert.equal(hasRole(admin, ['admin']), true);
    assert.throws(() => assertRole(wholesalerA, ['admin']), (err: unknown) => err instanceof HttpError && err.status === 403);
  });

  it('allows a wholesaler to access only their tenant', () => {
    assert.equal(assertTenantAccess(wholesalerA, 'W001').id, 'USR-W001');
    assert.throws(
      () => assertTenantAccess(wholesalerA, 'W002'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
    assert.throws(
      () => assertTenantAccess(wholesalerB, 'W001'),
      (err: unknown) => err instanceof HttpError && err.status === 403
    );
  });

  it('lets admin cross tenant boundaries', () => {
    assert.equal(assertTenantAccess(admin, 'W002').role, 'admin');
  });
});
