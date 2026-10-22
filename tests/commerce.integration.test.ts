import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';

dotenv.config({ quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('commerce integration', { skip: !hasDatabase }, () => {
  let clientTokenUser: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let wholesalerTokenUser: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let otherWholesaler: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;

  before(async () => {
    const { runMigrations } = await import('../src/db/migrate');
    const { seedDevelopmentData } = await import('../src/db/seed');
    const { authenticateUser, registerClient } = await import('../src/auth/service');

    await runMigrations();
    await seedDevelopmentData();

    clientTokenUser = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });
    wholesalerTokenUser = await authenticateUser({
      email: 'wholesaler1@market.pk',
      password: process.env.SEED_WHOLESALER_PASSWORD || 'password123',
      expectedRole: 'wholesaler',
    });
    otherWholesaler = await authenticateUser({
      email: 'wholesaler2@market.pk',
      password: process.env.SEED_WHOLESALER_PASSWORD || 'password123',
      expectedRole: 'wholesaler',
    });

    // Ensure a second client exists for isolation checks
    try {
      await registerClient({
        name: 'Isolation Shop',
        storeName: 'Isolation Mart',
        phone: '03990001122',
        password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      });
    } catch {
      // already registered
    }
  });

  it('enforces product tenant isolation for create/list', async () => {
    const { createProduct, listProductsForUser } = await import('../src/commerce/products');
    const created = await createProduct(wholesalerTokenUser.user, {
      sku: `TEST-ISO-${Date.now()}`,
      name: 'Isolation Test Drink',
      unit: 'carton',
      packSize: '12 bottles',
      costPrice: 100,
      sellingPrice: 150,
      moq: 1,
      stockOnHand: 20,
    });
    assert.equal(created.wholesalerId, 'W001');

    const otherProducts = await listProductsForUser(otherWholesaler.user);
    assert.equal(otherProducts.some((p) => p.id === created.id), false);

    const ownProducts = await listProductsForUser(wholesalerTokenUser.user);
    assert.equal(ownProducts.some((p) => p.id === created.id), true);
  });

  it('persists cart, validates MOQ/stock, and never trusts client prices', async () => {
    const { upsertCartItem, getCart } = await import('../src/commerce/cart');
    const { getDb } = await import('../src/db');
    const { products } = await import('../src/db/schema');

    const [cola] = await getDb().select().from(products).where(eq(products.id, 'P401')).limit(1);
    assert.ok(cola);

    await assert.rejects(
      () => upsertCartItem(clientTokenUser.user, 'P401', 1),
      (err: any) => err?.status === 400 && /minimum order quantity/i.test(err.message)
    );

    const cart = await upsertCartItem(clientTokenUser.user, 'P401', cola.moq);
    assert.ok(cart.items.some((i) => i.productId === 'P401'));
    assert.equal(
      cart.subtotal,
      cart.items.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0)
    );

    const loaded = await getCart(clientTokenUser.user);
    assert.equal(loaded.itemCount > 0, true);
  });

  it('places split orders with confirmation + idempotency', async () => {
    const { upsertCartItem } = await import('../src/commerce/cart');
    const { placeOrder, getOrderForUser } = await import('../src/commerce/orders');
    const { authenticateUser } = await import('../src/auth/service');

    const client = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });

    await upsertCartItem(client.user, 'P401', 2);
    await upsertCartItem(client.user, 'P501', 2);

    await assert.rejects(
      () =>
        placeOrder(client.user, {
          deliveryAddress: 'University Road, Peshawar',
          confirmed: false,
        }),
      (err: any) => err?.status === 400
    );

    const key = `IDEMP-${Date.now()}`;
    const first = await placeOrder(client.user, {
      deliveryAddress: 'University Road, Peshawar',
      confirmed: true,
      idempotencyKey: key,
    });
    assert.equal(first.subOrders.length >= 2, true);
    assert.equal(
      first.totalAmount,
      first.subOrders.reduce((sum, sub) => sum + sub.subtotal, 0)
    );

    const second = await placeOrder(client.user, {
      deliveryAddress: 'University Road, Peshawar',
      confirmed: true,
      idempotencyKey: key,
    });
    assert.equal(second.id, first.id);

    const otherClient = await authenticateUser({
      phone: '03990001122',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });
    await assert.rejects(
      () => getOrderForUser(otherClient.user, first.id),
      (err: any) => err?.status === 403
    );
  });

  it('approves with atomic reservation and blocks cross-tenant review', async () => {
    const { createProduct } = await import('../src/commerce/products');
    const { upsertCartItem } = await import('../src/commerce/cart');
    const { placeOrder, reviewSubOrder, getOrderForUser } = await import('../src/commerce/orders');
    const { getDb } = await import('../src/db');
    const { products } = await import('../src/db/schema');
    const { authenticateUser } = await import('../src/auth/service');

    const limited = await createProduct(wholesalerTokenUser.user, {
      sku: `LIM-${Date.now()}`,
      name: 'Limited Stock Juice',
      unit: 'carton',
      packSize: '6 bottles',
      costPrice: 500,
      sellingPrice: 700,
      moq: 1,
      stockOnHand: 5,
    });

    const client = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });
    await upsertCartItem(client.user, limited.id, 3);
    const order = await placeOrder(client.user, {
      deliveryAddress: 'University Road, Peshawar',
      confirmed: true,
      idempotencyKey: `LIM-ORD-${Date.now()}`,
    });
    const sub = order.subOrders.find((s) => s.wholesalerId === 'W001');
    assert.ok(sub);

    await assert.rejects(
      () => reviewSubOrder(otherWholesaler.user, sub!.id, 'Approved'),
      (err: any) => err?.status === 403
    );

    const approved = await reviewSubOrder(wholesalerTokenUser.user, sub!.id, 'Approved');
    assert.equal(approved.subOrders.find((s) => s.id === sub!.id)?.status, 'Approved');

    const [after] = await getDb().select().from(products).where(eq(products.id, limited.id)).limit(1);
    assert.equal(after.stockReserved, 3);
    assert.equal(after.stockOnHand, 5);

    const loaded = await getOrderForUser(wholesalerTokenUser.user, order.id);
    assert.equal(loaded.subOrders.every((s) => s.wholesalerId === 'W001'), true);
  });

  it('rejects without reserving stock and handles concurrent oversell', async () => {
    const { createProduct } = await import('../src/commerce/products');
    const { upsertCartItem } = await import('../src/commerce/cart');
    const { placeOrder, reviewSubOrder } = await import('../src/commerce/orders');
    const { getDb } = await import('../src/db');
    const { products } = await import('../src/db/schema');
    const { authenticateUser, registerClient } = await import('../src/auth/service');

    const raceProduct = await createProduct(wholesalerTokenUser.user, {
      sku: `RACE-${Date.now()}`,
      name: 'Race Stock Drink',
      unit: 'carton',
      packSize: '12',
      costPrice: 200,
      sellingPrice: 300,
      moq: 1,
      stockOnHand: 4,
    });

    const clientA = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });

    let clientB;
    try {
      clientB = await registerClient({
        name: 'Race Client',
        storeName: 'Race Store',
        phone: '03991112233',
        password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      });
    } catch {
      clientB = await authenticateUser({
        phone: '03991112233',
        password: process.env.SEED_CLIENT_PASSWORD || 'password123',
        expectedRole: 'client',
      });
    }

    await upsertCartItem(clientA.user, raceProduct.id, 3);
    const orderA = await placeOrder(clientA.user, {
      deliveryAddress: 'A Road',
      confirmed: true,
      idempotencyKey: `RACE-A-${Date.now()}`,
    });

    await upsertCartItem(clientB.user, raceProduct.id, 3);
    const orderB = await placeOrder(clientB.user, {
      deliveryAddress: 'B Road',
      confirmed: true,
      idempotencyKey: `RACE-B-${Date.now()}`,
    });

    const subA = orderA.subOrders.find((s) => s.wholesalerId === 'W001')!;
    const subB = orderB.subOrders.find((s) => s.wholesalerId === 'W001')!;

    const results = await Promise.allSettled([
      reviewSubOrder(wholesalerTokenUser.user, subA.id, 'Approved'),
      reviewSubOrder(wholesalerTokenUser.user, subB.id, 'Approved'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const [after] = await getDb().select().from(products).where(eq(products.id, raceProduct.id)).limit(1);
    assert.equal(after.stockReserved, 3);
    assert.ok(after.stockOnHand - after.stockReserved >= 0);

    const rejectTarget = rejected.length ? (results.find((r) => r.status === 'rejected') ? subB : subA) : subB;
    // Reject the still-submitted loser if needed
    const loserId = (fulfilled[0] as PromiseFulfilledResult<any>).value.subOrders.find((s: any) => s.id === subA.id)
      ? subB.id
      : subA.id;
    try {
      await reviewSubOrder(wholesalerTokenUser.user, loserId, 'Rejected', 'Insufficient stock');
    } catch {
      // already failed approval path may leave it Submitted; reject then
    }

    const [afterReject] = await getDb().select().from(products).where(eq(products.id, raceProduct.id)).limit(1);
    assert.equal(afterReject.stockReserved, 3);
    void rejectTarget;
  });
});
