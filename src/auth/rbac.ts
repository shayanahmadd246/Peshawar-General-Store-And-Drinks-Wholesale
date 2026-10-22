import type { AuthUser, Role } from './types';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function hasRole(user: AuthUser | undefined, roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}

export function assertRole(user: AuthUser | undefined, roles: Role[]): AuthUser {
  if (!user) {
    throw new HttpError(401, 'Unauthorized');
  }
  if (!roles.includes(user.role)) {
    throw new HttpError(403, 'Forbidden');
  }
  return user;
}

export function assertTenantAccess(user: AuthUser | undefined, tenantId: string | undefined | null): AuthUser {
  const actor = assertRole(user, ['admin', 'wholesaler', 'client']);
  if (actor.role === 'admin') return actor;
  if (!tenantId) {
    throw new HttpError(403, 'Tenant scope is required.');
  }
  if (actor.role === 'wholesaler' && actor.tenantId !== tenantId) {
    throw new HttpError(403, 'Cross-tenant access denied.');
  }
  return actor;
}

export function publicWholesalerView<T extends { ownerEmail?: string }>(row: T, user?: AuthUser): T {
  if (user?.role === 'admin') return row;
  if (user?.role === 'wholesaler') return row;
  const { ownerEmail: _email, ...rest } = row as T & { ownerEmail?: string };
  return rest as T;
}
