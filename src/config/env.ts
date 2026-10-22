import dotenv from 'dotenv';

dotenv.config();

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and provide host, port, username, and database name (do not commit the password).'
    );
  }
  return url;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (isProduction()) {
    if (!secret || secret === 'super_secret_key_change_me') {
      throw new Error('JWT_SECRET must be set to a strong unique value in production.');
    }
    return secret;
  }
  return secret || 'dev-only-jwt-secret-not-for-production';
}

export interface SeedCredentials {
  adminEmail: string;
  adminPassword: string;
  wholesalerPassword: string;
  clientPassword: string;
  clientPhone: string;
  deliveryEmail: string;
  deliveryPassword: string;
}

export function getSeedCredentials(): SeedCredentials {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@market.pk';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const wholesalerPassword = process.env.SEED_WHOLESALER_PASSWORD;
  const clientPassword = process.env.SEED_CLIENT_PASSWORD;
  const clientPhone = process.env.SEED_CLIENT_PHONE?.trim() || '03009876543';
  const deliveryEmail = process.env.SEED_DELIVERY_EMAIL?.trim() || 'delivery@market.pk';
  const deliveryPassword = process.env.SEED_DELIVERY_PASSWORD;

  if (isProduction()) {
    throw new Error('Automatic seed accounts are disabled in production.');
  }

  return {
    adminEmail,
    adminPassword: adminPassword || 'admin123',
    wholesalerPassword: wholesalerPassword || 'password123',
    clientPassword: clientPassword || 'password123',
    clientPhone,
    deliveryEmail,
    deliveryPassword: deliveryPassword || 'delivery123',
  };
}

export function allowClientDemoPasswordFallback(): boolean {
  return !isProduction();
}
