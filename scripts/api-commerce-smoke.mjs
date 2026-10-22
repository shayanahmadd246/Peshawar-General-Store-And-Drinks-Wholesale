import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@market.pk';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const wholesalerPassword = process.env.SEED_WHOLESALER_PASSWORD || 'password123';
const clientPhone = process.env.SEED_CLIENT_PHONE || '03009876543';
const clientPassword = process.env.SEED_CLIENT_PASSWORD || 'password123';

async function req(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function ok(label, cond, detail) {
  if (!cond) {
    console.error(`FAIL ${label}`, detail);
    process.exit(1);
  }
  console.log(`OK ${label}`);
}

const health = await req('/api/health');
ok('health', health.status === 200 && health.data.database === 'connected', health.data);

const clientLogin = await req('/api/auth/client/signin', {
  method: 'POST',
  body: { phone: clientPhone, password: clientPassword },
});
ok('client login', clientLogin.data.success && clientLogin.data.token, clientLogin.data);
const clientToken = clientLogin.data.token;

const wholesalerLogin = await req('/api/auth/wholesaler/signin', {
  method: 'POST',
  body: { email: 'wholesaler1@market.pk', password: wholesalerPassword },
});
ok('wholesaler login', wholesalerLogin.data.success && wholesalerLogin.data.token, wholesalerLogin.data);
const wholesalerToken = wholesalerLogin.data.token;

const adminLogin = await req('/api/auth/admin/signin', {
  method: 'POST',
  body: { email: adminEmail, password: adminPassword },
});
ok('admin login still works', adminLogin.data.success, adminLogin.data);

const addCart = await req('/api/cart/items', {
  method: 'POST',
  token: clientToken,
  body: { productId: 'P402', quantity: 5, mode: 'set' },
});
ok('cart upsert', addCart.status === 200 && addCart.data.cart?.itemCount >= 5, addCart.data);

const idem = `SMOKE-${Date.now()}`;
const order1 = await req('/api/orders', {
  method: 'POST',
  token: clientToken,
  headers: { 'Idempotency-Key': idem },
  body: { deliveryAddress: 'University Road, Peshawar', confirmed: true, idempotencyKey: idem },
});
ok('order place', order1.status === 201 && order1.data.order?.id, order1.data);

const order2 = await req('/api/orders', {
  method: 'POST',
  token: clientToken,
  headers: { 'Idempotency-Key': idem },
  body: { deliveryAddress: 'University Road, Peshawar', confirmed: true, idempotencyKey: idem },
});
ok('order idempotent', order2.data.order?.id === order1.data.order.id, order2.data);

const sub = order1.data.order.subOrders.find((s) => s.wholesalerId === 'W001');
ok('has W001 suborder', Boolean(sub), order1.data.order.subOrders);

const cross = await req(`/api/suborders/${sub.id}/review`, {
  method: 'PATCH',
  token: (
    await req('/api/auth/wholesaler/signin', {
      method: 'POST',
      body: { email: 'wholesaler2@market.pk', password: wholesalerPassword },
    })
  ).data.token,
  body: { action: 'Approved' },
});
ok('cross-tenant blocked', cross.status === 403, cross.data);

const approve = await req(`/api/suborders/${sub.id}/review`, {
  method: 'PATCH',
  token: wholesalerToken,
  body: { action: 'Approved' },
});
ok('approve reserves', approve.status === 200 && approve.data.order, approve.data);

const created = await req('/api/products', {
  method: 'POST',
  token: wholesalerToken,
  body: {
    sku: `SMOKE-${Date.now()}`,
    name: 'Smoke Test Beverage',
    unit: 'carton',
    packSize: '24',
    costPrice: 1000,
    sellingPrice: 1200,
    moq: 1,
    stockOnHand: 10,
  },
});
ok('product create', created.status === 201 && created.data.product?.id, created.data);

console.log('API commerce smoke passed');
