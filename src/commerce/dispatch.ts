import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { auditEvents, orders, shipments, subOrderItems, subOrders } from '../db/schema';
import { HttpError } from '../auth/rbac';
import type { AuthUser } from '../auth/types';
import { consumeReservedStock, releaseReservedStock } from './inventory';
import { generateInvoiceForFulfilledSubOrder } from './invoices';

export type ShipmentStatus =
  | 'Unassigned'
  | 'Assigned'
  | 'Dispatched'
  | 'InTransit'
  | 'Delivered'
  | 'Failed';

const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  Unassigned: ['Assigned'],
  Assigned: ['Dispatched'],
  Dispatched: ['InTransit'],
  InTransit: ['Delivered', 'Failed'],
  Delivered: [],
  Failed: ['Assigned'],
};

export interface ShipmentView {
  id: string;
  orderId: string;
  subOrderId: string | null;
  wholesalerId: string;
  assigneeId?: string;
  assigneeName?: string;
  status: string;
  expectedDate: string;
  proofNotes?: string;
  trackingRef?: string;
  deliveredAt?: string;
  failedAt?: string;
  failureReason?: string;
  clientName?: string;
  deliveryAddress?: string;
}

function mapShipment(
  row: typeof shipments.$inferSelect,
  extras?: { clientName?: string; deliveryAddress?: string }
): ShipmentView {
  return {
    id: row.id,
    orderId: row.orderId,
    subOrderId: row.subOrderId,
    wholesalerId: row.wholesalerId,
    assigneeId: row.assigneeId || undefined,
    assigneeName: row.assigneeName || undefined,
    status: row.status,
    expectedDate: row.expectedDate,
    proofNotes: row.proofNotes || undefined,
    trackingRef: row.trackingRef || undefined,
    deliveredAt: row.deliveredAt?.toISOString(),
    failedAt: row.failedAt?.toISOString(),
    failureReason: row.failureReason || undefined,
    clientName: extras?.clientName,
    deliveryAddress: extras?.deliveryAddress,
  };
}

function assertCanMutateShipment(user: AuthUser, shipment: typeof shipments.$inferSelect) {
  if (user.role === 'admin') return;
  if (user.role === 'delivery') {
    if (shipment.assigneeId !== user.id) {
      throw new HttpError(403, 'You can only update your assigned deliveries.');
    }
    return;
  }
  throw new HttpError(403, 'Only admin or assigned delivery personnel can update shipments.');
}

export async function listShipmentsForUser(user: AuthUser): Promise<ShipmentView[]> {
  let rows: (typeof shipments.$inferSelect)[] = [];
  if (user.role === 'admin') {
    rows = await getDb().select().from(shipments).orderBy(desc(shipments.updatedAt));
  } else if (user.role === 'delivery') {
    rows = await getDb()
      .select()
      .from(shipments)
      .where(eq(shipments.assigneeId, user.id))
      .orderBy(desc(shipments.updatedAt));
  } else if (user.role === 'wholesaler') {
    rows = await getDb()
      .select()
      .from(shipments)
      .where(eq(shipments.wholesalerId, user.tenantId || ''))
      .orderBy(desc(shipments.updatedAt));
  } else if (user.role === 'client') {
    const clientOrders = await getDb().select().from(orders).where(eq(orders.clientId, user.id));
    const orderIds = clientOrders.map((o) => o.id);
    if (orderIds.length === 0) return [];
    rows = await getDb().select().from(shipments).where(inArray(shipments.orderId, orderIds));
  } else {
    return [];
  }

  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const orderRows = orderIds.length
    ? await getDb().select().from(orders).where(inArray(orders.id, orderIds))
    : [];
  const orderMap = new Map(orderRows.map((o) => [o.id, o]));

  return rows.map((row) =>
    mapShipment(row, {
      clientName: orderMap.get(row.orderId)?.clientName,
      deliveryAddress: orderMap.get(row.orderId)?.deliveryAddress,
    })
  );
}

export async function listAssignableDeliveryUsers() {
  const { users } = await import('../db/schema');
  return getDb().select().from(users).where(and(eq(users.role, 'delivery'), eq(users.status, 'active')));
}

export async function assignShipment(
  user: AuthUser,
  shipmentId: string,
  input: { assigneeId: string; assigneeName?: string; trackingRef?: string; expectedDate?: string }
): Promise<ShipmentView> {
  if (user.role !== 'admin') throw new HttpError(403, 'Only admin can assign deliveries.');
  if (!input.assigneeId) throw new HttpError(400, 'assigneeId is required.');

  const { users } = await import('../db/schema');
  const [assignee] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.id, input.assigneeId), eq(users.role, 'delivery'), eq(users.status, 'active')))
    .limit(1);
  if (!assignee) throw new HttpError(400, 'Assignee must be an active delivery user.');

  return getDb().transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).limit(1);
    if (!shipment) throw new HttpError(404, 'Shipment not found.');
    if (shipment.status !== 'Unassigned' && shipment.status !== 'Failed') {
      throw new HttpError(409, `Cannot assign shipment in status ${shipment.status}.`);
    }
    let subOrderId = shipment.subOrderId;
    if (!subOrderId) {
      const [linked] = await tx
        .select()
        .from(subOrders)
        .where(and(eq(subOrders.orderId, shipment.orderId), eq(subOrders.wholesalerId, shipment.wholesalerId)))
        .limit(1);
      if (!linked) throw new HttpError(409, 'Shipment is missing suborder linkage.');
      subOrderId = linked.id;
      await tx.update(shipments).set({ subOrderId }).where(eq(shipments.id, shipmentId));
    }
    const [sub] = await tx.select().from(subOrders).where(eq(subOrders.id, subOrderId)).limit(1);
    if (!sub || sub.status !== 'Approved') {
      throw new HttpError(409, 'Only approved suborders can be dispatched.');
    }

    const [updated] = await tx
      .update(shipments)
      .set({
        assigneeId: assignee.id,
        assigneeName: input.assigneeName || assignee.name,
        trackingRef: input.trackingRef || shipment.trackingRef,
        expectedDate: input.expectedDate || shipment.expectedDate,
        status: 'Assigned',
        failureReason: null,
        failedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(shipments.id, shipmentId))
      .returning();

    await tx.insert(auditEvents).values({
      id: `ADT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      actor: user.name,
      role: 'Admin',
      action: 'ASSIGN_SHIPMENT',
      details: `Assigned shipment ${shipmentId} to ${updated.assigneeName}`,
    });

    return mapShipment(updated);
  });
}

export async function updateShipmentStatus(
  user: AuthUser,
  shipmentId: string,
  input: {
    status: ShipmentStatus;
    proofNotes?: string;
    failureReason?: string;
    idempotencyKey?: string;
  }
): Promise<ShipmentView> {
  const nextStatus = input.status;
  if (!Object.keys(TRANSITIONS).includes(nextStatus)) {
    throw new HttpError(400, 'Invalid shipment status.');
  }

  return getDb().transaction(async (tx) => {
    if (input.idempotencyKey) {
      const [byKey] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.statusIdempotencyKey, input.idempotencyKey))
        .limit(1);
      if (byKey) return mapShipment(byKey);
    }

    const locked = await tx.execute(sql`SELECT * FROM shipments WHERE id = ${shipmentId} FOR UPDATE`);
    const row = ((locked as any).rows || [])[0];
    if (!row) throw new HttpError(404, 'Shipment not found.');

    const shipment: typeof shipments.$inferSelect = {
      id: row.id,
      orderId: row.order_id,
      subOrderId: row.sub_order_id,
      wholesalerId: row.wholesaler_id,
      assigneeId: row.assignee_id,
      assigneeName: row.assignee_name,
      status: row.status,
      expectedDate: row.expected_date,
      proofNotes: row.proof_notes,
      trackingRef: row.tracking_ref,
      dispatchedAt: row.dispatched_at,
      inTransitAt: row.in_transit_at,
      deliveredAt: row.delivered_at,
      failedAt: row.failed_at,
      failureReason: row.failure_reason,
      stockConsumed: row.stock_consumed,
      reservationReleased: row.reservation_released,
      statusIdempotencyKey: row.status_idempotency_key,
      updatedAt: row.updated_at,
    };

    assertCanMutateShipment(user, shipment);

    if (shipment.status === nextStatus) {
      return mapShipment(shipment);
    }

    const allowed = TRANSITIONS[shipment.status as ShipmentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new HttpError(409, `Invalid transition from ${shipment.status} to ${nextStatus}.`);
    }

    if (user.role === 'delivery' && nextStatus === 'Assigned') {
      throw new HttpError(403, 'Only admin can reassign failed deliveries.');
    }

    if (nextStatus === 'Failed' && !input.failureReason?.trim()) {
      throw new HttpError(400, 'failureReason is required when marking delivery failed.');
    }
    if (nextStatus === 'Delivered' && !input.proofNotes?.trim()) {
      // proof notes optional per PRD "optional proof-of-delivery notes" - allow empty
    }

    const patch: Partial<typeof shipments.$inferInsert> = {
      status: nextStatus,
      updatedAt: new Date(),
      statusIdempotencyKey: input.idempotencyKey || shipment.statusIdempotencyKey,
      proofNotes: input.proofNotes ?? shipment.proofNotes,
    };

    if (nextStatus === 'Dispatched') patch.dispatchedAt = new Date();
    if (nextStatus === 'InTransit') patch.inTransitAt = new Date();
    if (nextStatus === 'Delivered') patch.deliveredAt = new Date();
    if (nextStatus === 'Failed') {
      patch.failedAt = new Date();
      patch.failureReason = input.failureReason!.trim();
    }

    // Fulfillment side effects
    if (nextStatus === 'Delivered') {
      if (!shipment.subOrderId) throw new HttpError(409, 'Shipment missing suborder.');
      if (!shipment.stockConsumed) {
        const items = await tx
          .select()
          .from(subOrderItems)
          .where(eq(subOrderItems.subOrderId, shipment.subOrderId));
        await consumeReservedStock(
          tx as any,
          items.map((i) => ({ productId: i.productId, quantity: i.quantity, name: i.name }))
        );
        patch.stockConsumed = true;
      }
      await generateInvoiceForFulfilledSubOrder(tx as any, {
        orderId: shipment.orderId,
        subOrderId: shipment.subOrderId,
        shipmentId: shipment.id,
        idempotencyKey: `inv-${shipment.subOrderId}`,
      });
    }

    if (nextStatus === 'Failed') {
      if (!shipment.subOrderId) throw new HttpError(409, 'Shipment missing suborder.');
      if (!shipment.reservationReleased && !shipment.stockConsumed) {
        const items = await tx
          .select()
          .from(subOrderItems)
          .where(eq(subOrderItems.subOrderId, shipment.subOrderId));
        await releaseReservedStock(
          tx as any,
          items.map((i) => ({ productId: i.productId, quantity: i.quantity, name: i.name }))
        );
        patch.reservationReleased = true;
      }
    }

    const [updated] = await tx.update(shipments).set(patch).where(eq(shipments.id, shipmentId)).returning();

    await tx.insert(auditEvents).values({
      id: `ADT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actor: user.name,
      role: user.role === 'admin' ? 'Admin' : 'Delivery',
      action: `SHIPMENT_${nextStatus.toUpperCase()}`,
      details: `Shipment ${shipmentId} moved to ${nextStatus}`,
    });

    return mapShipment(updated);
  });
}

export async function listDispatchQueue(user: AuthUser) {
  if (user.role !== 'admin') throw new HttpError(403, 'Only admin can view the dispatch queue.');
  const approved = await getDb().select().from(subOrders).where(eq(subOrders.status, 'Approved'));
  const shipmentRows = await getDb()
    .select()
    .from(shipments)
    .where(or(eq(shipments.status, 'Unassigned'), eq(shipments.status, 'Failed'), isNull(shipments.assigneeId)));
  return {
    approvedSubOrders: approved,
    unassignedShipments: shipmentRows.map((s) => mapShipment(s)),
  };
}
