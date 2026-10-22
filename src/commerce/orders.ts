import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  auditEvents,
  cartItems,
  carts,
  orders,
  products,
  shipments,
  subOrderItems,
  subOrders,
  wholesalers,
} from '../db/schema';
import { HttpError, assertTenantAccess } from '../auth/rbac';
import type { AuthUser } from '../auth/types';
import { clearOpenCart } from './cart';
import { refreshProductAvailabilityStatus } from './products';
import type { OrderView, SubOrderView } from './types';

function money(n: number): string {
  return n.toFixed(2);
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

type DbExecutor = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

async function loadOrderView(
  orderId: string,
  options?: { includeCost?: boolean; db?: DbExecutor }
): Promise<OrderView | null> {
  const db = options?.db || getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const subs = await db.select().from(subOrders).where(eq(subOrders.orderId, orderId));
  const subIds = subs.map((s) => s.id);
  const items = subIds.length
    ? await db.select().from(subOrderItems).where(inArray(subOrderItems.subOrderId, subIds))
    : [];

  return {
    id: order.id,
    clientId: order.clientId,
    clientName: order.clientName,
    deliveryAddress: order.deliveryAddress,
    status: order.status,
    totalAmount: toNumber(order.totalAmount),
    createdAt: order.createdAt.toISOString(),
    paymentStatus: order.paymentStatus,
    paidAmount: toNumber(order.paidAmount),
    subOrders: subs.map((sub) => ({
      id: sub.id,
      orderId: order.id,
      wholesalerId: sub.wholesalerId,
      subtotal: toNumber(sub.subtotal),
      status: sub.status,
      rejectReason: sub.rejectReason,
      items: items
        .filter((item) => item.subOrderId === sub.id)
        .map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: toNumber(item.unitPrice),
          costPrice: options?.includeCost ? toNumber(item.costPrice) : undefined,
          unit: item.unit,
          packSize: item.packSize,
        })),
    })),
  };
}

export async function listOrdersForUser(user: AuthUser): Promise<OrderView[]> {
  if (user.role === 'client') {
    const rows = await getDb().select().from(orders).where(eq(orders.clientId, user.id));
    const views = await Promise.all(rows.map((row) => loadOrderView(row.id, { includeCost: false })));
    return views.filter(Boolean).sort((a, b) => (a!.createdAt < b!.createdAt ? 1 : -1)) as OrderView[];
  }

  if (user.role === 'wholesaler') {
    if (!user.tenantId) throw new HttpError(403, 'Wholesaler tenant missing.');
    const subs = await getDb().select().from(subOrders).where(eq(subOrders.wholesalerId, user.tenantId));
    const orderIds = [...new Set(subs.map((s) => s.orderId))];
    const views = await Promise.all(orderIds.map((id) => loadOrderView(id, { includeCost: true })));
    return views
      .filter(Boolean)
      .map((order) => ({
        ...order!,
        subOrders: order!.subOrders.filter((sub) => sub.wholesalerId === user.tenantId),
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  if (user.role === 'admin') {
    const rows = await getDb().select().from(orders);
    const views = await Promise.all(rows.map((row) => loadOrderView(row.id, { includeCost: true })));
    return views.filter(Boolean).sort((a, b) => (a!.createdAt < b!.createdAt ? 1 : -1)) as OrderView[];
  }

  throw new HttpError(403, 'Forbidden');
}

export async function getOrderForUser(user: AuthUser, orderId: string): Promise<OrderView> {
  const includeCost = user.role === 'admin' || user.role === 'wholesaler';
  const order = await loadOrderView(orderId, { includeCost });
  if (!order) throw new HttpError(404, 'Order not found.');

  if (user.role === 'client' && order.clientId !== user.id) {
    throw new HttpError(403, 'Cross-client order access denied.');
  }
  if (user.role === 'wholesaler') {
    order.subOrders = order.subOrders.filter((sub) => sub.wholesalerId === user.tenantId);
    if (order.subOrders.length === 0) throw new HttpError(403, 'Cross-tenant order access denied.');
  }
  return order;
}

export async function placeOrder(
  user: AuthUser,
  input: {
    deliveryAddress?: string;
    confirmed?: boolean;
    idempotencyKey?: string;
  }
): Promise<OrderView> {
  if (user.role !== 'client') throw new HttpError(403, 'Only shopkeepers can place orders.');
  if (!input.confirmed) {
    throw new HttpError(400, 'Explicit confirmation is required before creating an order.');
  }

  const deliveryAddress = input.deliveryAddress?.trim();
  if (!deliveryAddress) {
    throw new HttpError(400, 'Delivery address is required.');
  }

  const idempotencyKey = input.idempotencyKey?.trim();
  if (idempotencyKey) {
    const [existing] = await getDb().select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) {
      if (existing.clientId !== user.id) {
        throw new HttpError(409, 'Idempotency key already used by another client.');
      }
      const view = await loadOrderView(existing.id);
      if (!view) throw new HttpError(500, 'Existing order could not be loaded.');
      return view;
    }
  }

  return getDb().transaction(async (tx) => {
    if (idempotencyKey) {
      const [race] = await tx.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
      if (race) {
        const view = await loadOrderView(race.id);
        if (!view) throw new HttpError(500, 'Existing order could not be loaded.');
        return view;
      }
    }

    const [cart] = await tx
      .select()
      .from(carts)
      .where(and(eq(carts.clientId, user.id), eq(carts.status, 'open')))
      .limit(1);
    if (!cart) throw new HttpError(400, 'Cart is empty.');

    const lines = await tx
      .select({ item: cartItems, product: products, wholesaler: wholesalers })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .innerJoin(wholesalers, eq(products.wholesalerId, wholesalers.id))
      .where(eq(cartItems.cartId, cart.id));

    if (lines.length === 0) throw new HttpError(400, 'Cart is empty.');

    type GroupLine = {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      unit: string;
      packSize: string;
    };
    const groups = new Map<string, GroupLine[]>();
    let totalAmount = 0;

    for (const line of lines) {
      if (line.wholesaler.status !== 'active') {
        throw new HttpError(400, `${line.wholesaler.name} is suspended and cannot accept orders.`);
      }
      if (line.product.status === 'inactive') {
        throw new HttpError(400, `${line.product.name} is inactive.`);
      }
      if (line.item.quantity < line.product.moq) {
        throw new HttpError(400, `${line.product.name} requires MOQ ${line.product.moq}.`);
      }
      const available = line.product.stockOnHand - line.product.stockReserved;
      if (line.item.quantity > available) {
        throw new HttpError(400, `Insufficient stock for ${line.product.name}. Available: ${available}.`);
      }

      const unitPrice = toNumber(line.product.sellingPrice);
      const costPrice = toNumber(line.product.costPrice);
      totalAmount += unitPrice * line.item.quantity;
      const bucket = groups.get(line.product.wholesalerId) || [];
      bucket.push({
        productId: line.product.id,
        name: line.product.name,
        quantity: line.item.quantity,
        unitPrice,
        costPrice,
        unit: line.product.unit,
        packSize: line.product.packSize,
      });
      groups.set(line.product.wholesalerId, bucket);
    }

    const orderId = `ORD-${Date.now()}`;
    await tx.insert(orders).values({
      id: orderId,
      clientId: user.id,
      clientName: user.storeName || user.name,
      deliveryAddress,
      status: 'Submitted',
      totalAmount: money(totalAmount),
      paymentStatus: 'Unpaid',
      paidAmount: '0.00',
      idempotencyKey: idempotencyKey || null,
      confirmedAt: new Date(),
    });

    let subIdx = 0;
    for (const [wholesalerId, groupLines] of groups.entries()) {
      subIdx += 1;
      const subId = `SUB-${orderId}-${subIdx}`;
      const subtotal = groupLines.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      await tx.insert(subOrders).values({
        id: subId,
        orderId,
        wholesalerId,
        subtotal: money(subtotal),
        status: 'Submitted',
      });
      for (const [itemIdx, item] of groupLines.entries()) {
        await tx.insert(subOrderItems).values({
          id: `SOI-${subId}-${itemIdx + 1}`,
          subOrderId: subId,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: money(item.unitPrice),
          costPrice: money(item.costPrice),
          unit: item.unit,
          packSize: item.packSize,
        });
      }
    }

    await clearOpenCart(user.id, tx as any);

    await tx.insert(auditEvents).values({
      id: `ADT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      actor: user.name,
      role: 'Shopkeeper',
      action: 'ORDER_SUBMITTED',
      details: `Order ${orderId} submitted with ${groups.size} suborders totaling PKR ${totalAmount}`,
    });

    const view = await loadOrderView(orderId, { db: tx as any });
    if (!view) throw new HttpError(500, 'Order created but could not be loaded.');
    return view;
  });
}

function recomputeParentStatus(statuses: string[]): string {
  if (statuses.every((s) => s === 'Approved')) return 'Approved';
  if (statuses.every((s) => s === 'Rejected')) return 'Rejected';
  if (statuses.some((s) => s === 'Approved') && statuses.some((s) => s === 'Rejected' || s === 'Submitted')) {
    return 'Partially Approved';
  }
  if (statuses.some((s) => s === 'Approved')) return 'Partially Approved';
  return 'Submitted';
}

export async function reviewSubOrder(
  user: AuthUser,
  subOrderId: string,
  action: 'Approved' | 'Rejected',
  rejectReason?: string
): Promise<OrderView> {
  if (action !== 'Approved' && action !== 'Rejected') {
    throw new HttpError(400, 'Action must be Approved or Rejected.');
  }
  if (action === 'Rejected' && !rejectReason?.trim()) {
    throw new HttpError(400, 'Reject reason is required.');
  }

  return getDb().transaction(async (tx) => {
    const [sub] = await tx.select().from(subOrders).where(eq(subOrders.id, subOrderId)).limit(1);
    if (!sub) throw new HttpError(404, 'Suborder not found.');

    assertTenantAccess(user, sub.wholesalerId);

    if (sub.status !== 'Submitted') {
      throw new HttpError(409, `Suborder already ${sub.status}.`);
    }

    const [wholesaler] = await tx.select().from(wholesalers).where(eq(wholesalers.id, sub.wholesalerId)).limit(1);
    if (!wholesaler) throw new HttpError(404, 'Wholesaler not found.');
    if (action === 'Approved' && wholesaler.status === 'suspended') {
      throw new HttpError(403, 'Suspended wholesalers cannot approve new suborders.');
    }

    const items = await tx.select().from(subOrderItems).where(eq(subOrderItems.subOrderId, subOrderId));
    if (items.length === 0) throw new HttpError(400, 'Suborder has no items.');

    if (action === 'Approved') {
      for (const item of items) {
        const result = await tx.execute(sql`
          UPDATE products
          SET stock_reserved = stock_reserved + ${item.quantity},
              updated_at = NOW()
          WHERE id = ${item.productId}
            AND wholesaler_id = ${sub.wholesalerId}
            AND status <> 'inactive'
            AND (stock_on_hand - stock_reserved) >= ${item.quantity}
        `);
        const rowCount = Number((result as any).rowCount ?? 0);
        if (rowCount !== 1) {
          throw new HttpError(409, `Insufficient available stock to approve ${item.name}.`);
        }
        await refreshProductAvailabilityStatus(item.productId, tx);
      }

      await tx.insert(shipments).values({
        id: `SHP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        orderId: sub.orderId,
        subOrderId: sub.id,
        wholesalerId: sub.wholesalerId,
        status: 'Unassigned',
        expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        stockConsumed: false,
        reservationReleased: false,
      });
    }

    await tx
      .update(subOrders)
      .set({
        status: action,
        rejectReason: action === 'Rejected' ? rejectReason!.trim() : null,
        reviewedAt: new Date(),
      })
      .where(eq(subOrders.id, subOrderId));

    const siblings = await tx.select().from(subOrders).where(eq(subOrders.orderId, sub.orderId));
    const parentStatus = recomputeParentStatus(
      siblings.map((s) => (s.id === subOrderId ? action : s.status))
    );
    await tx.update(orders).set({ status: parentStatus }).where(eq(orders.id, sub.orderId));

    await tx.insert(auditEvents).values({
      id: `ADT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actor: user.name,
      role: user.role === 'admin' ? 'Admin' : 'Wholesaler',
      action: `SUBORDER_${action.toUpperCase()}`,
      details: `Suborder ${subOrderId} was ${action.toLowerCase()}`,
    });

    const view = await loadOrderView(sub.orderId, { includeCost: true, db: tx as any });
    if (!view) throw new HttpError(500, 'Order could not be loaded after review.');
    if (user.role === 'wholesaler') {
      view.subOrders = view.subOrders.filter((s) => s.wholesalerId === user.tenantId);
    }
    return view;
  });
}

export async function listSubOrdersForWholesaler(user: AuthUser): Promise<SubOrderView[]> {
  if (user.role !== 'wholesaler' || !user.tenantId) {
    throw new HttpError(403, 'Only wholesalers can list tenant suborders.');
  }
  const ordersForTenant = await listOrdersForUser(user);
  return ordersForTenant.flatMap((order) =>
    order.subOrders.map((sub) => ({
      ...sub,
      orderId: order.id,
      clientName: order.clientName,
    }))
  );
}
