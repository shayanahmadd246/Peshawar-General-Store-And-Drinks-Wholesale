import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const clientPhone = process.env.SEED_CLIENT_PHONE || '03009876543';
const clientPassword = process.env.SEED_CLIENT_PASSWORD || 'password123';
const wholesalerPassword = process.env.SEED_WHOLESALER_PASSWORD || 'password123';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@market.pk';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const deliveryEmail = process.env.SEED_DELIVERY_EMAIL || 'delivery@market.pk';
const deliveryPassword = process.env.SEED_DELIVERY_PASSWORD || 'delivery123';

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

const clientLogin = await req('/api/auth/client/signin', {
  method: 'POST',
  body: { phone: clientPhone, password: clientPassword },
});
ok('client login', clientLogin.data.token, clientLogin.data);
const clientToken = clientLogin.data.token;

const wholesalerLogin = await req('/api/auth/wholesaler/signin', {
  method: 'POST',
  body: { email: 'wholesaler1@market.pk', password: wholesalerPassword },
});
ok('wholesaler login', wholesalerLogin.data.token, wholesalerLogin.data);
const wholesalerToken = wholesalerLogin.data.token;

const adminLogin = await req('/api/auth/admin/signin', {
  method: 'POST',
  body: { email: adminEmail, password: adminPassword },
});
ok('admin login', adminLogin.data.token, adminLogin.data);
const adminToken = adminLogin.data.token;

const deliveryLogin = await req('/api/auth/delivery/signin', {
  method: 'POST',
  body: { email: deliveryEmail, password: deliveryPassword },
});
ok('delivery login', deliveryLogin.data.token, deliveryLogin.data);
const deliveryToken = deliveryLogin.data.token;

const product = await req('/api/products', {
  method: 'POST',
  token: wholesalerToken,
  body: {
    sku: `P3-${Date.now()}`,
    name: 'Phase3 Smoke Beverage',
    unit: 'carton',
    packSize: '24',
    costPrice: 800,
    sellingPrice: 1000,
    moq: 1,
    stockOnHand: 30,
  },
});
ok('create product', product.status === 201 && product.data.product?.id, product.data);
const productId = product.data.product.id;

await req('/api/cart/items', {
  method: 'POST',
  token: clientToken,
  body: { productId, quantity: 2, mode: 'set' },
});

const idem = `P3-ORD-${Date.now()}`;
const order = await req('/api/orders', {
  method: 'POST',
  token: clientToken,
  headers: { 'Idempotency-Key': idem },
  body: { deliveryAddress: 'University Road, Peshawar', confirmed: true, idempotencyKey: idem },
});
ok('checkout', order.status === 201 && order.data.order?.id, order.data);
const sub = order.data.order.subOrders.find((s) => s.wholesalerId === 'W001');
ok('suborder', Boolean(sub), order.data.order.subOrders);

const approve = await req(`/api/suborders/${sub.id}/review`, {
  method: 'PATCH',
  token: wholesalerToken,
  body: { action: 'Approved' },
});
ok('approve', approve.status === 200, approve.data);

const market = await req('/api/market/data', { token: adminToken });
const shipment = (market.data.shipments || []).find((s) => s.subOrderId === sub.id || (s.orderId === order.data.order.id && s.wholesalerId === 'W001'));
ok('shipment created', Boolean(shipment), market.data.shipments);

const assign = await req(`/api/shipments/${shipment.id}/assign`, {
  method: 'PATCH',
  token: adminToken,
  body: { assigneeId: 'DRV-01' },
});
ok('assign', assign.status === 200 && assign.data.shipment.status === 'Assigned', assign.data);

for (const status of ['Dispatched', 'InTransit']) {
  const step = await req(`/api/shipments/${shipment.id}/status`, {
    method: 'PATCH',
    token: deliveryToken,
    headers: { 'Idempotency-Key': `P3-${shipment.id}-${status}` },
    body: { status, idempotencyKey: `P3-${shipment.id}-${status}` },
  });
  ok(`status ${status}`, step.status === 200 && step.data.shipment.status === status, step.data);
}

const deliverKey = `P3-${shipment.id}-Delivered`;
const deliver = await req(`/api/shipments/${shipment.id}/status`, {
  method: 'PATCH',
  token: deliveryToken,
  headers: { 'Idempotency-Key': deliverKey },
  body: { status: 'Delivered', proofNotes: 'Delivered to shop', idempotencyKey: deliverKey },
});
ok('delivered', deliver.status === 200 && deliver.data.shipment.status === 'Delivered', deliver.data);

const deliver2 = await req(`/api/shipments/${shipment.id}/status`, {
  method: 'PATCH',
  token: deliveryToken,
  headers: { 'Idempotency-Key': deliverKey },
  body: { status: 'Delivered', proofNotes: 'Delivered to shop', idempotencyKey: deliverKey },
});
ok('delivery idempotent', deliver2.status === 200, deliver2.data);

const invoices = await req('/api/invoices', { token: clientToken });
const invoice = (invoices.data.invoices || []).find((i) => i.subOrderId === sub.id || i.orderId === order.data.order.id);
ok('invoice generated', Boolean(invoice) && Number(invoice.amount) === 2000, invoices.data);

const payKey = `P3-PAY-${invoice.id}`;
const pay = await req('/api/payments', {
  method: 'POST',
  token: adminToken,
  headers: { 'Idempotency-Key': payKey },
  body: { invoiceId: invoice.id, amount: '750.00', method: 'cash', reference: 'SMOKE-750', idempotencyKey: payKey },
});
ok('partial payment', pay.status === 201 && pay.data.invoice.status === 'Partially Paid', pay.data);

const over = await req('/api/payments', {
  method: 'POST',
  token: adminToken,
  body: { invoiceId: invoice.id, amount: '99999', method: 'cash' },
});
ok('overpayment rejected', over.status === 400, over.data);

console.log('Phase 3 API smoke passed');
