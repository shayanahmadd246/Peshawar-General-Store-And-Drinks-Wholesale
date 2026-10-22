import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/env';
import type { AuthTokenPayload, AuthUser } from './types';

const TOKEN_EXPIRES_IN = '12h';

export function signAuthToken(user: AuthUser): string {
  const payload: AuthTokenPayload = {
    ...user,
    sub: user.id,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRES_IN });
}

export function verifyAuthToken(token: string): AuthUser {
  const decoded = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
  if (!decoded?.id || !decoded.role) {
    throw new Error('Invalid token payload');
  }
  return {
    id: decoded.id,
    role: decoded.role,
    tenantId: decoded.tenantId ?? null,
    name: decoded.name,
    email: decoded.email ?? null,
    phone: decoded.phone ?? null,
    storeName: decoded.storeName ?? null,
  };
}
