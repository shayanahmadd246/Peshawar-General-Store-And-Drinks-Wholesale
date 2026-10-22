export type Role = 'admin' | 'wholesaler' | 'client' | 'delivery';

export interface AuthUser {
  id: string;
  role: Role;
  tenantId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  storeName: string | null;
}

export interface AuthTokenPayload extends AuthUser {
  sub: string;
}
