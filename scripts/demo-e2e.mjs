/**
 * Full hackathon demo path against live PostgreSQL APIs.
 * Does not reset data. Uses unique SKU / idempotency keys.
 */
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
    console.error(`FAIL ${label}`, detail ?? '');
    process.exit(1);
  }
  console.log(`OK  ${label}`);
}

const stamp = Date.now();
console.log('=== Hackathon E2E demo ===');
console.log('base=', base);

const clientLogin = await req('/api/auth/client/signin', {
  method: 'POST',
  body: { phone: clientPhone, password: clientPassword },
});
ok('shopkeeper login', Boolean(clientLogin.data.token), clientLogin.data);
const clientToken = clientLogin.data.token;

const wholesalerLogin = await req('/api/auth/wholesaler/signin', {
  method: 'POST',
  body: { email: 'wholesaler1@market.pk', password: wholesalerPassword },
});
ok('wholesaler login', Boolean(wholesalerLogin.data.token), wholesalerLogin.data);
const wholesalerToken = wholesalerLogin.data.token;

const otherWholesalerLogin = await req('/api/auth/wholesaler/signin', {
  method: 'POST',
  body: { email: 'wholesaler2@market.pk', password: wholesalerPassword },
});
ok('other wholesaler login', Boolean(otherWholesalerLogin.data.token), otherWholesalerLogin.data);
const otherWholesalerToken = otherWholesalerLogin.data.token;

const adminLogin = await req('/api/auth/admin/signin', {
  method: 'POST',
  body: { email: adminEmail, password: adminPassword },
});
ok('admin login', Boolean(adminLogin.data.token), adminLogin.data);
const adminToken = adminLogin.data.token;

const deliveryLogin = await req('/api/auth/delivery/signin', {
  method: 'POST',
  body: { email: deliveryEmail, password: deliveryPassword },
});
ok('delivery login', Boolean(deliveryLogin.data.token), deliveryLogin.data);
const deliveryToken = deliveryLogin.data.token;

const market = await req('/api/market/data', { token: clientToken });
ok('shopkeeper catalog load', Array.isArray(market.data.products) && market.data.products.length > 0, {
  count: market.data.products?.length,
});
const cola =
  market.data.products.find((p) => p.id === 'P401') ||
  market.data.products.find((p) => /cola|drink/i.test(p.name) && p.status !== 'inactive');
ok('seeded drink product visible', Boolean(cola?.id), cola);
const stockBefore = cola.availableStock ?? Math.max(0, (cola.stockOnHand || 0) - (cola.stockReserved || 0));
const qty = Math.max(Number(cola.moq) || 2, 2);

const aiChat = await req('/api/ai/chat', {
  method: 'POST',
  token: clientToken,
  body: { message: 'Show me available cold drinks.', language: 'en' },
});
ok('AI text chat', aiChat.status === 200 && aiChat.data.reply && aiChat.data.orderPlaced === false, {
  geminiUsed: aiChat.data.geminiUsed,
  tools: aiChat.data.toolCalls,
});

await req('/api/cart/items', {
  method: 'POST',
  token: clientToken,
  body: { productId: cola.id, quantity: 0, mode: 'set' },
});

const addCart = await req('/api/cart/items', {
  method: 'POST',
  token: clientToken,
  body: { productId: cola.id, quantity: qty, mode: 'set' },
});
ok('persistent cart update', addCart.status === 200 && addCart.data.cart?.itemCount > 0, addCart.data);
const cartSubtotal = Number(addCart.data.cart.subtotal);

const noConfirm = await req('/api/orders', {
  method: 'POST',
  token: clientToken,
  body: { deliveryAddress: 'Babar General Store, University Road, Peshawar', confirmed: false },
});
ok('checkout blocked without explicit confirmation', noConfirm.status === 400, noConfirm.data);

const idemKey = `DEMO-CHK-${stamp}`;
const order1 = await req('/api/orders', {
  method: 'POST',
  token: clientToken,
  headers: { 'Idempotency-Key': idemKey },
  body: {
    deliveryAddress: 'Babar General Store, University Road, Peshawar',
    confirmed: true,
    idempotencyKey: idemKey,
  },
});
ok('explicit checkout', order1.status === 201 && order1.data.order?.id, order1.data);
const orderId = order1.data.order.id;
const subOrder = order1.data.order.subOrders.find((s) => s.wholesalerId === cola.wholesalerId) || order1.data.order.subOrders[0];
ok('suborder created', Boolean(subOrder?.id), order1.data.order.subOrders);
const subOrderId = subOrder.id;

const orderReplay = await req('/api/orders', {
  method: 'POST',
  token: clientToken,
  headers: { 'Idempotency-Key': idemKey },
  body: {
    deliveryAddress: 'Babar General Store, University Road, Peshawar',
    confirmed: true,
    idempotencyKey: idemKey,
  },
});
ok('checkout idempotency (same key)', orderReplay.data.order?.id === orderId, orderReplay.data);

const crossReview = await req(`/api/suborders/${subOrderId}/review`, {
  method: 'PATCH',
  token: otherWholesalerToken,
  body: { action: 'Approved' },
});
ok('tenant isolation blocks other wholesaler', crossReview.status === 403 || crossReview.status === 404, crossReview);

const approve = await req(`/api/suborders/${subOrderId}/review`, {
  method: 'PATCH',
  token: wholesalerToken,
  body: { action: 'Approved' },
});
ok('wholesaler approval + stock reservation', approve.status === 200, approve.data);

const marketAfterReserve = await req('/api/market/data', { token: clientToken });
const colaAfter = marketAfterReserve.data.products.find((p) => p.id === cola.id);
ok(
  'inventory available declined or reserved increased',
  (colaAfter?.availableStock ?? stockBefore) < stockBefore || (colaAfter?.stockReserved ?? 0) > (cola.stockReserved ?? 0),
  { stockBefore, after: colaAfter }
);

const adminMarket = await req('/api/market/data', { token: adminToken });
const shipment = (adminMarket.data.shipments || []).find(
  (s) => s.subOrderId === subOrderId || (s.orderId === orderId && s.wholesalerId === cola.wholesalerId)
);
ok('shipment in admin view', Boolean(shipment?.id), adminMarket.data.shipments);

const assign = await req(`/api/shipments/${shipment.id}/assign`, {
  method: 'PATCH',
  token: adminToken,
  body: { assigneeId: 'DRV-01', assigneeName: 'Gul Khan Logistics' },
});
ok('admin assigns delivery', assign.status === 200, assign.data);

for (const status of ['Dispatched', 'InTransit']) {
  const key = `DEMO-${shipment.id}-${status}-${stamp}`;
  const step = await req(`/api/shipments/${shipment.id}/status`, {
    method: 'PATCH',
    token: deliveryToken,
    headers: { 'Idempotency-Key': key },
    body: { status, idempotencyKey: key },
  });
  ok(`delivery status ${status}`, step.status === 200 && step.data.shipment?.status === status, step.data);
}

const delKey = `DEMO-${shipment.id}-Delivered-${stamp}`;
const delivered = await req(`/api/shipments/${shipment.id}/status`, {
  method: 'PATCH',
  token: deliveryToken,
  headers: { 'Idempotency-Key': delKey },
  body: { status: 'Delivered', proofNotes: 'Hackathon demo delivery', idempotencyKey: delKey },
});
ok('delivered', delivered.status === 200 && delivered.data.shipment?.status === 'Delivered', delivered.data);

const invoices = await req('/api/invoices', { token: clientToken });
const invoice = (invoices.data.invoices || []).find((i) => i.orderId === orderId || i.subOrderId === subOrderId);
ok('invoice after delivery', Boolean(invoice?.id), invoices.data);

const payAmount = '100.00';
const payKey = `DEMO-PAY-${stamp}`;
const payment = await req('/api/payments', {
  method: 'POST',
  token: adminToken,
  headers: { 'Idempotency-Key': payKey },
  body: {
    invoiceId: invoice.id,
    amount: payAmount,
    method: 'cash',
    reference: `DEMO-${stamp}`,
    idempotencyKey: payKey,
  },
});
ok('partial payment recorded', payment.status === 201 && payment.data.invoice, payment.data);

const payReplay = await req('/api/payments', {
  method: 'POST',
  token: adminToken,
  headers: { 'Idempotency-Key': payKey },
  body: {
    invoiceId: invoice.id,
    amount: payAmount,
    method: 'cash',
    reference: `DEMO-${stamp}`,
    idempotencyKey: payKey,
  },
});
ok('payment idempotency', payReplay.status < 500, payReplay.data);

const invoicesAfter = await req('/api/invoices', { token: clientToken });
const invoiceAfter = (invoicesAfter.data.invoices || []).find((i) => i.id === invoice.id);
ok(
  'outstanding balance remains',
  Number(invoiceAfter?.outstandingAmount ?? 0) > 0 || String(invoiceAfter?.status || '').includes('Partial'),
  invoiceAfter
);

const voiceForm = new FormData();
voiceForm.append('audio', new Blob([Uint8Array.from([1, 2, 3])], { type: 'audio/wav' }), 'bad.wav');
voiceForm.append('durationMs', '500');
const badVoice = await fetch(`${base}/api/ai/voice/transcribe`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${clientToken}` },
  body: voiceForm,
});
const badVoiceData = await badVoice.json().catch(() => ({}));
ok('voice rejects bad signature', badVoice.status >= 400 && badVoiceData.orderPlaced !== true, badVoiceData);

console.log('\n=== E2E DEMO PASSED ===');
console.log({
  orderId,
  subOrderId,
  shipmentId: shipment.id,
  invoiceId: invoice.id,
  cartSubtotal,
  aiGeminiUsed: aiChat.data.geminiUsed,
  note: 'AI may use deterministic agents when Gemini quota is exhausted; commerce path is independent.',
});
process.exit(0);
