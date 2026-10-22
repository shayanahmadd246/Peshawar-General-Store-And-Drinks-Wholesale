import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { products, wholesalers } from '../db/schema';
import type { AuthUser } from '../auth/types';
import { HttpError } from '../auth/rbac';
import { addToCart, getCart, upsertCartItem } from '../commerce/cart';
import { listOrdersForUser } from '../commerce/orders';
import { listInvoicesForUser } from '../commerce/invoices';
import { listShipmentsForUser } from '../commerce/dispatch';
import { mapProduct } from '../commerce/products';
import { aiToolCalls } from '../db/schema';

const ALLOWED_TOOLS = new Set([
  'search_catalog',
  'get_cart',
  'add_to_cart',
  'update_cart_item',
  'remove_cart_item',
  'propose_checkout',
  'get_order_status',
  'get_invoice_summary',
]);

export const TOOL_DECLARATIONS = [
  {
    name: 'search_catalog',
    description: 'Search live authorized wholesale products by keyword/alias. Never invent products.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text in any language' },
        limit: { type: 'integer', description: 'Max results 1-8' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_cart',
    description: 'Get the authenticated shopkeeper persistent cart with server-calculated totals.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'add_to_cart',
    description: 'Add a product quantity to the shopkeeper cart. Validates MOQ and stock.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        quantity: { type: 'integer' },
      },
      required: ['productId', 'quantity'],
    },
  },
  {
    name: 'update_cart_item',
    description: 'Set absolute quantity for a cart line. Use 0 to remove.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        quantity: { type: 'integer' },
      },
      required: ['productId', 'quantity'],
    },
  },
  {
    name: 'remove_cart_item',
    description: 'Remove a product from the cart.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
    },
  },
  {
    name: 'propose_checkout',
    description:
      'Summarize the current cart for checkout. Does NOT place an order. User must confirm separately in UI.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_order_status',
    description: 'Read the shopkeeper own orders and shipment statuses.',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
    },
  },
  {
    name: 'get_invoice_summary',
    description: 'Read the shopkeeper invoice balances. Never expose cost prices.',
    parameters: { type: 'object', properties: {} },
  },
];

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} is required.`);
  return value.trim().slice(0, 200);
}

function asInt(value: unknown, field: string, min = 0, max = 100000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

async function searchCatalog(query: string, limit = 5) {
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await getDb()
    .select({ product: products, wholesaler: wholesalers })
    .from(products)
    .innerJoin(wholesalers, eq(products.wholesalerId, wholesalers.id))
    .where(
      and(
        eq(wholesalers.status, 'active'),
        sql`${products.status} <> 'inactive'`,
        or(ilike(products.name, like), ilike(products.sku, like), sql`${products.aliases}::text ILIKE ${like}`)
      )
    )
    .limit(Math.min(Math.max(limit, 1), 8));

  // Also keyword token match for roman urdu / mixed
  if (rows.length === 0) {
    const all = await getDb()
      .select({ product: products, wholesaler: wholesalers })
      .from(products)
      .innerJoin(wholesalers, eq(products.wholesalerId, wholesalers.id))
      .where(and(eq(wholesalers.status, 'active'), sql`${products.status} <> 'inactive'`));
    const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    return all
      .filter(({ product }) => {
        const hay = `${product.name} ${product.sku} ${JSON.stringify(product.aliases)}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      })
      .slice(0, Math.min(Math.max(limit, 1), 8))
      .map(({ product }) => mapProduct(product, false));
  }

  return rows.map(({ product }) => mapProduct(product, false));
}

export async function executeTool(
  user: AuthUser,
  name: string,
  rawArgs: Record<string, unknown>,
  meta: { conversationId: string; messageId?: string }
) {
  if (!ALLOWED_TOOLS.has(name)) {
    throw new HttpError(400, `Tool ${name} is not allowed.`);
  }
  if (user.role !== 'client') {
    throw new HttpError(403, 'AI tools are only available to shopkeepers.');
  }

  let result: unknown;
  let status = 'ok';
  try {
    switch (name) {
      case 'search_catalog': {
        const query = asString(rawArgs.query, 'query');
        const limit = rawArgs.limit == null ? 5 : asInt(rawArgs.limit, 'limit', 1, 8);
        const productsFound = await searchCatalog(query, limit);
        result = {
          products: productsFound.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            unit: p.unit,
            packSize: p.packSize,
            sellingPrice: p.sellingPrice,
            moq: p.moq,
            availableStock: p.availableStock,
            wholesalerId: p.wholesalerId,
            status: p.status,
          })),
          count: productsFound.length,
        };
        break;
      }
      case 'get_cart': {
        result = { cart: await getCart(user) };
        break;
      }
      case 'add_to_cart': {
        const productId = asString(rawArgs.productId, 'productId');
        const quantity = asInt(rawArgs.quantity, 'quantity', 1, 100000);
        result = { cart: await addToCart(user, productId, quantity) };
        break;
      }
      case 'update_cart_item': {
        const productId = asString(rawArgs.productId, 'productId');
        const quantity = asInt(rawArgs.quantity, 'quantity', 0, 100000);
        result = { cart: await upsertCartItem(user, productId, quantity) };
        break;
      }
      case 'remove_cart_item': {
        const productId = asString(rawArgs.productId, 'productId');
        result = { cart: await upsertCartItem(user, productId, 0) };
        break;
      }
      case 'propose_checkout': {
        const cart = await getCart(user);
        if (cart.itemCount === 0) {
          result = { ready: false, reason: 'Cart is empty.', cart };
        } else {
          result = {
            ready: true,
            requiresExplicitConfirmation: true,
            note: 'Order is NOT placed. Shopkeeper must confirm in the checkout UI.',
            cart,
            wholesalerCount: cart.byWholesaler.length,
            subtotal: cart.subtotal,
          };
        }
        break;
      }
      case 'get_order_status': {
        const orders = await listOrdersForUser(user);
        const shipments = await listShipmentsForUser(user);
        const orderId = typeof rawArgs.orderId === 'string' ? rawArgs.orderId : undefined;
        const filtered = orderId ? orders.filter((o) => o.id === orderId) : orders.slice(0, 5);
        result = {
          orders: filtered.map((o) => ({
            id: o.id,
            status: o.status,
            totalAmount: o.totalAmount,
            paymentStatus: o.paymentStatus,
            subOrders: o.subOrders.map((s) => ({
              id: s.id,
              wholesalerId: s.wholesalerId,
              status: s.status,
              subtotal: s.subtotal,
            })),
          })),
          shipments: shipments
            .filter((s) => !orderId || s.orderId === orderId)
            .slice(0, 10)
            .map((s) => ({ id: s.id, orderId: s.orderId, status: s.status, assigneeName: s.assigneeName })),
        };
        break;
      }
      case 'get_invoice_summary': {
        const invoices = await listInvoicesForUser(user);
        result = {
          invoices: invoices.slice(0, 10).map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            amount: inv.amount,
            paidAmount: inv.paidAmount,
            outstandingAmount: inv.outstandingAmount,
            status: inv.status,
            wholesalerName: inv.wholesalerName,
          })),
        };
        break;
      }
      default:
        throw new HttpError(400, 'Unknown tool.');
    }
  } catch (err: any) {
    status = 'error';
    result = { error: err?.message || 'Tool failed' };
  }

  await getDb().insert(aiToolCalls).values({
    id: `TOOL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    conversationId: meta.conversationId,
    messageId: meta.messageId || null,
    clientId: user.id,
    toolName: name,
    arguments: rawArgs,
    result: result as any,
    status,
  });

  return { name, status, result };
}

export { searchCatalog };
