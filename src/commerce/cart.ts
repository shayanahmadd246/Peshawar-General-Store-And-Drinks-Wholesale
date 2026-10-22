import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { cartItems, carts, products } from '../db/schema';
import { HttpError } from '../auth/rbac';
import type { AuthUser } from '../auth/types';
import { getSellableProduct, mapProduct } from './products';
import type { CartView } from './types';

async function getOrCreateOpenCart(clientId: string) {
  const [existing] = await getDb()
    .select()
    .from(carts)
    .where(and(eq(carts.clientId, clientId), eq(carts.status, 'open')))
    .limit(1);
  if (existing) return existing;

  const [created] = await getDb()
    .insert(carts)
    .values({
      id: `CART-${clientId}`,
      clientId,
      status: 'open',
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [retry] = await getDb()
    .select()
    .from(carts)
    .where(and(eq(carts.clientId, clientId), eq(carts.status, 'open')))
    .limit(1);
  if (!retry) throw new HttpError(500, 'Unable to create cart.');
  return retry;
}

function assertClient(user: AuthUser) {
  if (user.role !== 'client') throw new HttpError(403, 'Only shopkeepers can manage carts.');
}

export async function getCart(user: AuthUser): Promise<CartView> {
  assertClient(user);
  const cart = await getOrCreateOpenCart(user.id);
  const rows = await getDb()
    .select({ item: cartItems, product: products })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .where(eq(cartItems.cartId, cart.id));

  const items = rows.map((row) => {
    const product = mapProduct(row.product, false);
    return {
      id: row.item.id,
      productId: row.item.productId,
      quantity: row.item.quantity,
      product,
      lineTotal: product.sellingPrice * row.item.quantity,
    };
  });

  const byWholesalerMap = new Map<string, { wholesalerId: string; subtotal: number; itemCount: number }>();
  for (const item of items) {
    const current = byWholesalerMap.get(item.product.wholesalerId) || {
      wholesalerId: item.product.wholesalerId,
      subtotal: 0,
      itemCount: 0,
    };
    current.subtotal += item.lineTotal;
    current.itemCount += item.quantity;
    byWholesalerMap.set(item.product.wholesalerId, current);
  }

  return {
    id: cart.id,
    clientId: user.id,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    byWholesaler: Array.from(byWholesalerMap.values()),
  };
}

export async function upsertCartItem(user: AuthUser, productId: string, quantity: number): Promise<CartView> {
  assertClient(user);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new HttpError(400, 'Quantity must be a non-negative integer.');
  }

  const cart = await getOrCreateOpenCart(user.id);
  const { product } = await getSellableProduct(productId);
  const available = product.stockOnHand - product.stockReserved;

  if (quantity === 0) {
    await getDb()
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));
    await getDb().update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return getCart(user);
  }

  if (quantity < product.moq) {
    throw new HttpError(400, `Minimum order quantity for this product is ${product.moq}.`);
  }
  if (quantity > available) {
    throw new HttpError(400, `Only ${available} units available for ${product.name}.`);
  }

  const [existing] = await getDb()
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)))
    .limit(1);

  if (existing) {
    await getDb()
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, existing.id));
  } else {
    await getDb().insert(cartItems).values({
      id: `CI-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      cartId: cart.id,
      productId,
      quantity,
    });
  }

  await getDb().update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
  return getCart(user);
}

export async function addToCart(user: AuthUser, productId: string, quantity = 1): Promise<CartView> {
  assertClient(user);
  const cart = await getCart(user);
  const existing = cart.items.find((item) => item.productId === productId);
  const nextQty = (existing?.quantity || 0) + quantity;
  return upsertCartItem(user, productId, nextQty);
}

export async function removeCartItem(user: AuthUser, productId: string): Promise<CartView> {
  return upsertCartItem(user, productId, 0);
}

export async function clearOpenCart(clientId: string, tx = getDb()) {
  const [cart] = await tx
    .select()
    .from(carts)
    .where(and(eq(carts.clientId, clientId), eq(carts.status, 'open')))
    .limit(1);
  if (!cart) return;
  await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
}
