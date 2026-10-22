import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { auditEvents, wholesalers } from '../db/schema';
import type { AuthUser } from '../auth/types';
import { listProductsForUser } from './products';
import { listOrdersForUser } from './orders';
import { getCart } from './cart';
import { listShipmentsForUser } from './dispatch';
import { listInvoicesForUser } from './invoices';
import { listPaymentsForUser } from './payments';

function mapWholesaler(row: typeof wholesalers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    city: row.city,
    status: row.status as 'active' | 'suspended',
    ownerEmail: row.ownerEmail,
    phone: row.phone,
    rating: Number(row.rating),
  };
}

export async function getMarketData(user?: AuthUser) {
  const productList = await listProductsForUser(user);
  const wholesalerRows = await getDb().select().from(wholesalers);

  if (!user) {
    return {
      wholesalers: wholesalerRows.filter((w) => w.status === 'active').map(mapWholesaler),
      products: productList,
      orders: [],
      shipments: [],
      invoices: [],
      payments: [],
      auditEvents: [],
      clients: [],
      cart: null,
    };
  }

  const shipments = await listShipmentsForUser(user);
  let invoices: Awaited<ReturnType<typeof listInvoicesForUser>> = [];
  let payments: Awaited<ReturnType<typeof listPaymentsForUser>> = [];
  try {
    if (user.role !== 'delivery') {
      invoices = await listInvoicesForUser(user);
      payments = await listPaymentsForUser(user);
    }
  } catch {
    invoices = [];
    payments = [];
  }

  const mappedInvoices = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    orderId: inv.orderId,
    subOrderId: inv.subOrderId,
    wholesalerId: inv.wholesalerId,
    wholesalerName: inv.wholesalerName,
    clientId: inv.clientId,
    clientName: inv.clientName,
    amount: Number(inv.amount),
    paidAmount: Number(inv.paidAmount),
    outstandingAmount: Number(inv.outstandingAmount),
    status: inv.status,
    createdAt: inv.createdAt,
    issuedAt: inv.issuedAt,
    lines: inv.lines,
  }));

  if (user.role === 'wholesaler') {
    const orders = await listOrdersForUser(user);
    const audits = await getDb().select().from(auditEvents).orderBy(desc(auditEvents.timestamp)).limit(100);
    return {
      wholesalers: wholesalerRows.filter((w) => w.id === user.tenantId).map(mapWholesaler),
      products: productList,
      orders,
      shipments,
      invoices: mappedInvoices,
      payments,
      auditEvents: audits
        .filter((a) => a.details.includes(user.tenantId || ''))
        .map((a) => ({
          id: a.id,
          timestamp: a.timestamp.toISOString(),
          actor: a.actor,
          role: a.role,
          action: a.action,
          details: a.details,
        })),
      clients: [],
      cart: null,
    };
  }

  if (user.role === 'client') {
    const orders = await listOrdersForUser(user);
    const cart = await getCart(user);
    return {
      wholesalers: wholesalerRows.filter((w) => w.status === 'active').map(mapWholesaler),
      products: productList,
      orders,
      shipments,
      invoices: mappedInvoices,
      payments,
      auditEvents: [],
      clients: [
        {
          id: user.id,
          name: user.name,
          storeName: user.storeName || '',
          phone: user.phone || '',
        },
      ],
      cart,
    };
  }

  if (user.role === 'delivery') {
    return {
      wholesalers: wholesalerRows.filter((w) => w.status === 'active').map(mapWholesaler),
      products: [],
      orders: [],
      shipments,
      invoices: [],
      payments: [],
      auditEvents: [],
      clients: [],
      cart: null,
      deliveryUser: { id: user.id, name: user.name, email: user.email },
    };
  }

  const orders = await listOrdersForUser(user);
  const audits = await getDb().select().from(auditEvents).orderBy(desc(auditEvents.timestamp)).limit(200);
  return {
    wholesalers: wholesalerRows.map(mapWholesaler),
    products: productList,
    orders,
    shipments,
    invoices: mappedInvoices,
    payments,
    auditEvents: audits.map((a) => ({
      id: a.id,
      timestamp: a.timestamp.toISOString(),
      actor: a.actor,
      role: a.role,
      action: a.action,
      details: a.details,
    })),
    clients: [],
    cart: null,
  };
}
