import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@market.pk';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const wholesalerPassword = process.env.SEED_WHOLESALER_PASSWORD || 'password123';
const clientPhone = process.env.SEED_CLIENT_PHONE || '03009876543';
const clientPassword = process.env.SEED_CLIENT_PASSWORD || 'password123';

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assertOk(label, result, roleCheck) {
  if (result.status !== 200 || !result.data?.success || !result.data?.token) {
    console.error(`FAIL ${label}: status=${result.status}`, result.data?.error || result.data);
    process.exit(1);
  }
  if (roleCheck && !roleCheck(result.data)) {
    console.error(`FAIL ${label}: unexpected payload shape`);
    process.exit(1);
  }
  console.log(`OK ${label}`);
}

const health = await fetch(`${base}/api/health`);
const healthBody = await health.json();
if (!health.ok || healthBody.database !== 'connected') {
  console.error('FAIL health check', health.status, healthBody);
  process.exit(1);
}
console.log('OK health database=connected');

const admin = await post('/api/auth/admin/signin', { email: adminEmail, password: adminPassword });
assertOk('admin login', admin, (d) => d.admin?.email && d.user?.role === 'admin');

const wholesaler = await post('/api/auth/wholesaler/signin', {
  email: 'wholesaler1@market.pk',
  password: wholesalerPassword,
});
assertOk('wholesaler login', wholesaler, (d) => d.wholesaler?.id === 'W001' && d.user?.role === 'wholesaler');

const client = await post('/api/auth/client/signin', {
  phone: clientPhone,
  password: clientPassword,
});
assertOk('shopkeeper login', client, (d) => d.client?.phone === clientPhone && d.user?.role === 'client');

const bad = await post('/api/auth/admin/signin', { email: adminEmail, password: 'definitely-wrong-password' });
if (bad.status !== 401) {
  console.error('FAIL rejected bad admin password', bad.status, bad.data);
  process.exit(1);
}
console.log('OK rejects invalid admin password');

console.log('API auth smoke passed');
