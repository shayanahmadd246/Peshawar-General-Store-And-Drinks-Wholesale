import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import {
  invoiceLines,
  invoices,
  orders,
  subOrderItems,
  subOrders,
  wholesalers,
} from '../db/schema';
import { HttpError } from '../auth/rbac';
import type { AuthUser } from '../auth/types';
import { addPaisa, fromPaisa, toPaisa } from './money';

export interface InvoiceLineView {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  unit: string;
  packSize: string;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  orderId: string;
  subOrderId: string | null;
  shipmentId: string | null;
  wholesalerId: string;
  wholesalerName?: string;
  clientId: string;
  clientName: string;
  amount: string;
  paidAmount: string;
  outstandingAmount: string;
  status: string;
  issuedAt: string;
  createdAt: string;
  lines: InvoiceLineView[];
}

type DbExecutor = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update' | 'execute'>;

function mapInvoice(
  row: typeof invoices.$inferSelect,
  lines: typeof invoiceLines.$inferSelect[],
  wholesalerName?: string
): InvoiceView {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    orderId: row.orderId,
    subOrderId: row.subOrderId,
    shipmentId: row.shipmentId,
    wholesalerId: row.wholesalerId,
    wholesalerName,
    clientId: row.clientId,
    clientName: row.clientName,
    amount: row.amount,
    paidAmount: row.paidAmount,
    outstandingAmount: row.outstandingAmount,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      unit: line.unit,
      packSize: line.packSize,
    })),
  };
}

export async function generateInvoiceForFulfilledSubOrder(
  tx: DbExecutor,
  input: {
    orderId: string;
    subOrderId: string;
    shipmentId: string;
    idempotencyKey?: string;
  }
): Promise<InvoiceView> {
  if (input.idempotencyKey) {
    const [byKey] = await tx.select().from(invoices).where(eq(invoices.idempotencyKey, input.idempotencyKey)).limit(1);
    if (byKey) {
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, byKey.id));
      return mapInvoice(byKey, lines);
    }
  }

  const [existing] = await tx.select().from(invoices).where(eq(invoices.subOrderId, input.subOrderId)).limit(1);
  if (existing) {
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, existing.id));
    return mapInvoice(existing, lines);
  }

  const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  const [sub] = await tx.select().from(subOrders).where(eq(subOrders.id, input.subOrderId)).limit(1);
  if (!order || !sub) throw new HttpError(404, 'Order or suborder not found for invoicing.');
  if (sub.status !== 'Approved' && sub.status !== 'Fulfilled') {
    throw new HttpError(409, 'Only approved/fulfilled suborders can be invoiced.');
  }

  const items = await tx.select().from(subOrderItems).where(eq(subOrderItems.subOrderId, input.subOrderId));
  if (items.length === 0) throw new HttpError(400, 'Suborder has no items to invoice.');

  let totalPaisa = 0;
  const lineRows = items.map((item, idx) => {
    const unitPaisa = toPaisa(item.unitPrice);
    const linePaisa = unitPaisa * item.quantity;
    totalPaisa = addPaisa(totalPaisa, linePaisa);
    return {
      id: `IL-${input.subOrderId}-${idx + 1}`,
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: fromPaisa(unitPaisa),
      lineTotal: fromPaisa(linePaisa),
      unit: item.unit,
      packSize: item.packSize,
    };
  });

  const snapshotPaisa = toPaisa(sub.subtotal);
  if (snapshotPaisa !== totalPaisa) {
    // Prefer line math; subtotal snapshot should match, but lines are source of truth at fulfillment.
    totalPaisa = snapshotPaisa === totalPaisa ? snapshotPaisa : totalPaisa;
  }

  const invoiceId = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const invoiceNumber = `INV-W-${sub.wholesalerId}-${Date.now()}`;
  const amount = fromPaisa(totalPaisa);

  const [created] = await tx
    .insert(invoices)
    .values({
      id: invoiceId,
      invoiceNumber,
      orderId: order.id,
      subOrderId: sub.id,
      shipmentId: input.shipmentId,
      wholesalerId: sub.wholesalerId,
      clientId: order.clientId,
      clientName: order.clientName,
      amount,
      paidAmount: '0.00',
      outstandingAmount: amount,
      status: 'Unpaid',
      idempotencyKey: input.idempotencyKey || `inv-${sub.id}`,
      issuedAt: new Date(),
    })
    .returning();

  await tx.insert(invoiceLines).values(
    lineRows.map((line) => ({
      ...line,
      invoiceId: created.id,
    }))
  );

  await tx.update(subOrders).set({ status: 'Fulfilled' }).where(eq(subOrders.id, sub.id));

  const siblings = await tx.select().from(subOrders).where(eq(subOrders.orderId, order.id));
  const statuses = siblings.map((s) => (s.id === sub.id ? 'Fulfilled' : s.status));
  let parentStatus = order.status;
  if (statuses.every((s) => s === 'Fulfilled' || s === 'Rejected')) {
    parentStatus = statuses.some((s) => s === 'Fulfilled') ? 'Fulfilled' : 'Rejected';
  } else if (statuses.some((s) => s === 'Fulfilled')) {
    parentStatus = 'Partially Fulfilled';
  }
  await tx.update(orders).set({ status: parentStatus }).where(eq(orders.id, order.id));

  return mapInvoice(created, lineRows.map((line) => ({ ...line, invoiceId: created.id })) as any);
}

export async function listInvoicesForUser(user: AuthUser): Promise<InvoiceView[]> {
  let rows: (typeof invoices.$inferSelect)[] = [];
  if (user.role === 'admin') {
    rows = await getDb().select().from(invoices).orderBy(desc(invoices.createdAt));
  } else if (user.role === 'client') {
    rows = await getDb().select().from(invoices).where(eq(invoices.clientId, user.id)).orderBy(desc(invoices.createdAt));
  } else if (user.role === 'wholesaler') {
    if (!user.tenantId) throw new HttpError(403, 'Wholesaler tenant missing.');
    rows = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.wholesalerId, user.tenantId))
      .orderBy(desc(invoices.createdAt));
  } else {
    throw new HttpError(403, 'Delivery role cannot list financial invoices.');
  }

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lines = await getDb().select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids));
  const whRows = await getDb().select().from(wholesalers);
  const whMap = new Map(whRows.map((w) => [w.id, w.name]));

  return rows.map((row) =>
    mapInvoice(
      row,
      lines.filter((l) => l.invoiceId === row.id),
      whMap.get(row.wholesalerId)
    )
  );
}

export async function getInvoiceForUser(user: AuthUser, invoiceId: string): Promise<InvoiceView> {
  const [row] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!row) throw new HttpError(404, 'Invoice not found.');

  if (user.role === 'client' && row.clientId !== user.id) {
    throw new HttpError(403, 'Cross-client invoice access denied.');
  }
  if (user.role === 'wholesaler' && row.wholesalerId !== user.tenantId) {
    throw new HttpError(403, 'Cross-tenant invoice access denied.');
  }
  if (user.role === 'delivery') {
    throw new HttpError(403, 'Delivery role cannot access invoices.');
  }

  const lines = await getDb().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, row.id));
  const [wh] = await getDb().select().from(wholesalers).where(eq(wholesalers.id, row.wholesalerId)).limit(1);
  return mapInvoice(row, lines, wh?.name);
}

export async function lockInvoice(tx: DbExecutor, invoiceId: string) {
  const result = await tx.execute(
    // language=SQL
    (await import('drizzle-orm')).sql`SELECT * FROM invoices WHERE id = ${invoiceId} FOR UPDATE`
  );
  const rows = (result as any).rows || [];
  if (!rows[0]) throw new HttpError(404, 'Invoice not found.');
  return rows[0] as {
    id: string;
    amount: string;
    paid_amount: string;
    outstanding_amount: string;
    status: string;
    client_id: string;
    wholesaler_id: string;
  };
}
