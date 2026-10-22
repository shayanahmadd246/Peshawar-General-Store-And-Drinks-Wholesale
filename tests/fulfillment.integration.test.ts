import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';

dotenv.config({ quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('fulfillment, invoices, and payments', { skip: !hasDatabase }, () => {
  let client: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let wholesaler: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let otherWholesaler: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let admin: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let delivery: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;

  before(async () => {
    const { runMigrations } = await import('../src/db/migrate');
    const { seedDevelopmentData } = await import('../src/db/seed');
    const { authenticateUser } = await import('../src/auth/service');
    await runMigrations();
    await seedDevelopmentData();

    client = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });
    wholesaler = await authenticateUser({
      email: 'wholesaler1@market.pk',
      password: process.env.SEED_WHOLESALER_PASSWORD || 'password123',
      expectedRole: 'wholesaler',
    });
    otherWholesaler = await authenticateUser({
      email: 'wholesaler2@market.pk',
      password: process.env.SEED_WHOLESALER_PASSWORD || 'password123',
      expectedRole: 'wholesaler',
    });
    admin = await authenticateUser({
      email: process.env.SEED_ADMIN_EMAIL || 'admin@market.pk',
      password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
      expectedRole: 'admin',
    });
    delivery = await authenticateUser({
      email: process.env.SEED_DELIVERY_EMAIL || 'delivery@market.pk',
      password: process.env.SEED_DELIVERY_PASSWORD || 'delivery123',
      expectedRole: 'delivery',
    });
  });

  async function placeApprovedShipment() {
    const { createProduct } = await import('../src/commerce/products');
    const { upsertCartItem } = await import('../src/commerce/cart');
    const { placeOrder, reviewSubOrder } = await import('../src/commerce/orders');
    const { registerClient, authenticateUser } = await import('../src/auth/service');
    const { getDb } = await import('../src/db');
    const { shipments } = await import('../src/db/schema');

    const phone = `0399${String(Date.now()).slice(-7)}`;
    let shopper;
    try {
      shopper = await registerClient({
        name: 'Fulfillment Shopper',
        storeName: `Shop ${phone}`,
        phone,
        password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      });
    } catch {
      shopper = await authenticateUser({
        phone,
        password: process.env.SEED_CLIENT_PASSWORD || 'password123',
        expectedRole: 'client',
      });
    }

    const product = await createProduct(wholesaler.user, {
      sku: `FUL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: 'Fulfillment Test Drink',
      unit: 'carton',
      packSize: '12',
      costPrice: 400,
      sellingPrice: 500,
      moq: 1,
      stockOnHand: 20,
    });

    await upsertCartItem(shopper.user, product.id, 2);
    const order = await placeOrder(shopper.user, {
      deliveryAddress: 'University Road, Peshawar',
      confirmed: true,
      idempotencyKey: `FUL-ORD-${Date.now()}-${Math.random()}`,
    });
    const sub = order.subOrders.find((s) => s.wholesalerId === 'W001')!;
    await reviewSubOrder(wholesaler.user, sub.id, 'Approved');

    const [shipment] = await getDb().select().from(shipments).where(eq(shipments.subOrderId, sub.id)).limit(1);
    assert.ok(shipment);
    return { product, order, sub, shipment, shopper };
  }

  it('runs checkout → approve → assign → deliver → invoice → partial payment', async () => {
    const { assignShipment, updateShipmentStatus } = await import('../src/commerce/dispatch');
    const { recordPayment, listPaymentsForUser } = await import('../src/commerce/payments');
    const { listInvoicesForUser, getInvoiceForUser } = await import('../src/commerce/invoices');
    const { getDb } = await import('../src/db');
    const { products } = await import('../src/db/schema');
    const { toPaisa } = await import('../src/commerce/money');

    const { product, shipment, shopper } = await placeApprovedShipment();

    const assigned = await assignShipment(admin.user, shipment.id, { assigneeId: 'DRV-01' });
    assert.equal(assigned.status, 'Assigned');
    assert.equal(assigned.assigneeId, 'DRV-01');

    await updateShipmentStatus(delivery.user, shipment.id, { status: 'Dispatched' });
    await updateShipmentStatus(delivery.user, shipment.id, { status: 'InTransit' });

    const delivered = await updateShipmentStatus(delivery.user, shipment.id, {
      status: 'Delivered',
      proofNotes: 'Left at counter',
      idempotencyKey: `DEL-${shipment.id}`,
    });
    assert.equal(delivered.status, 'Delivered');

    // Duplicate delivery callback is idempotent
    const again = await updateShipmentStatus(delivery.user, shipment.id, {
      status: 'Delivered',
      proofNotes: 'Left at counter',
      idempotencyKey: `DEL-${shipment.id}`,
    });
    assert.equal(again.id, delivered.id);

    const [after] = await getDb().select().from(products).where(eq(products.id, product.id)).limit(1);
    assert.equal(after.stockOnHand, 18);
    assert.equal(after.stockReserved, 0);

    const invoices = await listInvoicesForUser(shopper.user);
    const invoice = invoices.find((i) => i.shipmentId === shipment.id || i.subOrderId === shipment.subOrderId);
    assert.ok(invoice);
    assert.equal(toPaisa(invoice!.amount), 100000); // 2 * 500 PKR
    assert.equal(invoice!.lines.every((l) => !('costPrice' in l && (l as any).costPrice)), true);

    await assert.rejects(
      () => getInvoiceForUser(otherWholesaler.user, invoice!.id),
      (err: any) => err?.status === 403
    );

    const payKey = `PAY-${invoice!.id}-partial`;
    const partial = await recordPayment(admin.user, {
      invoiceId: invoice!.id,
      amount: '300.00',
      method: 'cash',
      reference: 'RCPT-1',
      idempotencyKey: payKey,
    });
    assert.equal(partial.invoice.status, 'Partially Paid');
    assert.equal(partial.invoice.outstandingAmount, '700.00');

    const idempotent = await recordPayment(admin.user, {
      invoiceId: invoice!.id,
      amount: '300.00',
      method: 'cash',
      idempotencyKey: payKey,
    });
    assert.equal(idempotent.payment.id, partial.payment.id);

    await assert.rejects(
      () =>
        recordPayment(admin.user, {
          invoiceId: invoice!.id,
          amount: '9999.00',
          method: 'bank_transfer',
        }),
      (err: any) => err?.status === 400 && /overpayment/i.test(err.message)
    );

    const payments = await listPaymentsForUser(shopper.user);
    assert.ok(payments.some((p) => p.id === partial.payment.id));
  });

  it('releases reservation exactly once on failed delivery', async () => {
    const { assignShipment, updateShipmentStatus } = await import('../src/commerce/dispatch');
    const { getDb } = await import('../src/db');
    const { products } = await import('../src/db/schema');

    const { product, shipment } = await placeApprovedShipment();
    const [reserved] = await getDb().select().from(products).where(eq(products.id, product.id)).limit(1);
    assert.equal(reserved.stockReserved, 2);

    await assignShipment(admin.user, shipment.id, { assigneeId: 'DRV-01' });
    await updateShipmentStatus(delivery.user, shipment.id, { status: 'Dispatched' });
    await updateShipmentStatus(delivery.user, shipment.id, { status: 'InTransit' });
    await updateShipmentStatus(delivery.user, shipment.id, {
      status: 'Failed',
      failureReason: 'Shop closed',
      idempotencyKey: `FAIL-${shipment.id}`,
    });

    // Duplicate failed callback
    await updateShipmentStatus(delivery.user, shipment.id, {
      status: 'Failed',
      failureReason: 'Shop closed',
      idempotencyKey: `FAIL-${shipment.id}`,
    });

    const [after] = await getDb().select().from(products).where(eq(products.id, product.id)).limit(1);
    assert.equal(after.stockOnHand, 20);
    assert.equal(after.stockReserved, 0);
  });

  it('blocks cross-tenant shipment updates and invalid transitions', async () => {
    const { assignShipment, updateShipmentStatus } = await import('../src/commerce/dispatch');
    const { shipment } = await placeApprovedShipment();
    await assignShipment(admin.user, shipment.id, { assigneeId: 'DRV-01' });

    await assert.rejects(
      () => updateShipmentStatus(wholesaler.user, shipment.id, { status: 'Dispatched' }),
      (err: any) => err?.status === 403
    );

    await assert.rejects(
      () => updateShipmentStatus(delivery.user, shipment.id, { status: 'Delivered' }),
      (err: any) => err?.status === 409
    );
  });

  it('handles concurrent payment attempts without overpaying', async () => {
    const { assignShipment, updateShipmentStatus } = await import('../src/commerce/dispatch');
    const { listInvoicesForUser } = await import('../src/commerce/invoices');
    const { recordPayment } = await import('../src/commerce/payments');

    const { shipment } = await placeApprovedShipment();
    await assignShipment(admin.user, shipment.id, { assigneeId: 'DRV-01' });
    await updateShipmentStatus(delivery.user, shipment.id, { status: 'Dispatched' });
    await updateShipmentStatus(delivery.user, shipment.id, { status: 'InTransit' });
    await updateShipmentStatus(delivery.user, shipment.id, {
      status: 'Delivered',
      proofNotes: 'ok',
      idempotencyKey: `CONC-DEL-${shipment.id}`,
    });

    const invoices = await listInvoicesForUser(admin.user);
    const invoice = invoices.find((i) => i.shipmentId === shipment.id || i.subOrderId === shipment.subOrderId)!;
    assert.ok(invoice);

    const results = await Promise.allSettled([
      recordPayment(admin.user, {
        invoiceId: invoice.id,
        amount: invoice.amount,
        method: 'cash',
        idempotencyKey: `CONC-A-${invoice.id}`,
      }),
      recordPayment(admin.user, {
        invoiceId: invoice.id,
        amount: invoice.amount,
        method: 'cash',
        idempotencyKey: `CONC-B-${invoice.id}`,
      }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(bad.length, 1);

    const settled = await listInvoicesForUser(admin.user);
    const finalInv = settled.find((i) => i.id === invoice.id)!;
    assert.equal(finalInv.status, 'Paid');
    assert.equal(finalInv.outstandingAmount, '0.00');
  });
});

describe('money helpers', () => {
  it('converts PKR to paisa without float drift', async () => {
    const { toPaisa, fromPaisa, addPaisa } = await import('../src/commerce/money');
    assert.equal(toPaisa('10.10'), 1010);
    assert.equal(toPaisa('0.01'), 1);
    assert.equal(fromPaisa(addPaisa(1010, 20)), '10.30');
  });
});
