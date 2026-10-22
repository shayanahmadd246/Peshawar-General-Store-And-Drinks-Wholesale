import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { products, wholesalers } from '../db/schema';
import { HttpError } from '../auth/rbac';
import type { AuthUser } from '../auth/types';
import type { ProductView } from './types';

const ACTIVE_CATALOG = ['available', 'low_stock'] as const;

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export function mapProduct(row: typeof products.$inferSelect, includeCost: boolean): ProductView {
  const stockOnHand = row.stockOnHand;
  const stockReserved = row.stockReserved;
  return {
    id: row.id,
    wholesalerId: row.wholesalerId,
    sku: row.sku,
    name: row.name,
    aliases: row.aliases as { en: string; ur: string; ps: string },
    unit: row.unit,
    packSize: row.packSize,
    costPrice: includeCost ? toNumber(row.costPrice) : 0,
    sellingPrice: toNumber(row.sellingPrice),
    moq: row.moq,
    reorderPoint: row.reorderPoint,
    stockOnHand,
    stockReserved,
    availableStock: Math.max(0, stockOnHand - stockReserved),
    status: row.status,
  };
}

function deriveStatus(stockOnHand: number, stockReserved: number, reorderPoint: number, explicit?: string): string {
  if (explicit === 'inactive') return 'inactive';
  const available = stockOnHand - stockReserved;
  if (available <= 0) return 'out_of_stock';
  if (available <= reorderPoint) return 'low_stock';
  return 'available';
}

function validateProductInput(input: {
  sku?: string;
  name?: string;
  unit?: string;
  packSize?: string;
  costPrice?: number;
  sellingPrice?: number;
  moq?: number;
  reorderPoint?: number;
  stockOnHand?: number;
}) {
  if (!input.sku?.trim() || !input.name?.trim() || !input.unit?.trim() || !input.packSize?.trim()) {
    throw new HttpError(400, 'SKU, name, unit, and pack size are required.');
  }
  if (input.costPrice == null || input.sellingPrice == null || input.costPrice < 0 || input.sellingPrice <= 0) {
    throw new HttpError(400, 'Valid cost and selling prices are required.');
  }
  if (input.sellingPrice < input.costPrice) {
    throw new HttpError(400, 'Selling price should be greater than or equal to cost price.');
  }
  if (input.moq != null && input.moq < 1) throw new HttpError(400, 'MOQ must be at least 1.');
  if (input.stockOnHand != null && input.stockOnHand < 0) throw new HttpError(400, 'Stock cannot be negative.');
  if (input.reorderPoint != null && input.reorderPoint < 0) throw new HttpError(400, 'Reorder point cannot be negative.');
}

export async function listProductsForUser(user?: AuthUser): Promise<ProductView[]> {
  if (!user) {
    const rows = await getDb()
      .select({ product: products, wholesalerStatus: wholesalers.status })
      .from(products)
      .innerJoin(wholesalers, eq(products.wholesalerId, wholesalers.id))
      .where(and(eq(wholesalers.status, 'active'), ne(products.status, 'inactive')));
    return rows
      .filter((row) => ACTIVE_CATALOG.includes(row.product.status as (typeof ACTIVE_CATALOG)[number]) || row.product.status === 'out_of_stock')
      .map((row) => mapProduct(row.product, false));
  }

  if (user.role === 'wholesaler') {
    if (!user.tenantId) throw new HttpError(403, 'Wholesaler tenant missing.');
    const rows = await getDb().select().from(products).where(eq(products.wholesalerId, user.tenantId));
    return rows.map((row) => mapProduct(row, true));
  }

  if (user.role === 'admin') {
    const rows = await getDb().select().from(products);
    return rows.map((row) => mapProduct(row, true));
  }

  const rows = await getDb()
    .select({ product: products })
    .from(products)
    .innerJoin(wholesalers, eq(products.wholesalerId, wholesalers.id))
    .where(and(eq(wholesalers.status, 'active'), ne(products.status, 'inactive')));
  return rows
    .filter((row) => row.product.status !== 'inactive')
    .map((row) => mapProduct(row.product, false));
}

export async function createProduct(
  user: AuthUser,
  input: {
    sku: string;
    name: string;
    aliases?: { en?: string; ur?: string; ps?: string };
    unit: string;
    packSize: string;
    costPrice: number;
    sellingPrice: number;
    moq?: number;
    reorderPoint?: number;
    stockOnHand?: number;
  }
): Promise<ProductView> {
  if (user.role !== 'wholesaler' || !user.tenantId) {
    throw new HttpError(403, 'Only wholesalers can create products for their tenant.');
  }
  validateProductInput(input);

  const stockOnHand = input.stockOnHand ?? 0;
  const reorderPoint = input.reorderPoint ?? 10;
  const moq = input.moq ?? 1;
  const status = deriveStatus(stockOnHand, 0, reorderPoint);
  const id = `P${Date.now()}`;

  try {
    const [row] = await getDb()
      .insert(products)
      .values({
        id,
        wholesalerId: user.tenantId,
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        aliases: {
          en: input.aliases?.en || input.name.trim(),
          ur: input.aliases?.ur || input.name.trim(),
          ps: input.aliases?.ps || input.name.trim(),
        },
        unit: input.unit.trim(),
        packSize: input.packSize.trim(),
        costPrice: input.costPrice.toFixed(2),
        sellingPrice: input.sellingPrice.toFixed(2),
        moq,
        reorderPoint,
        stockOnHand,
        stockReserved: 0,
        status,
      })
      .returning();
    return mapProduct(row, true);
  } catch (err: any) {
    if (String(err?.message || '').includes('products_wholesaler_sku_idx')) {
      throw new HttpError(409, 'A product with this SKU already exists for your tenant.');
    }
    throw err;
  }
}

export async function updateProduct(
  user: AuthUser,
  productId: string,
  input: Partial<{
    name: string;
    aliases: { en?: string; ur?: string; ps?: string };
    unit: string;
    packSize: string;
    costPrice: number;
    sellingPrice: number;
    moq: number;
    reorderPoint: number;
    stockOnHand: number;
    status: string;
  }>
): Promise<ProductView> {
  if (user.role !== 'wholesaler' || !user.tenantId) {
    throw new HttpError(403, 'Only wholesalers can update their products.');
  }

  const [existing] = await getDb()
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.wholesalerId, user.tenantId)))
    .limit(1);
  if (!existing) throw new HttpError(404, 'Product not found.');

  const next = {
    name: input.name?.trim() || existing.name,
    unit: input.unit?.trim() || existing.unit,
    packSize: input.packSize?.trim() || existing.packSize,
    costPrice: input.costPrice ?? toNumber(existing.costPrice),
    sellingPrice: input.sellingPrice ?? toNumber(existing.sellingPrice),
    moq: input.moq ?? existing.moq,
    reorderPoint: input.reorderPoint ?? existing.reorderPoint,
    stockOnHand: input.stockOnHand ?? existing.stockOnHand,
  };
  validateProductInput({ sku: existing.sku, ...next });

  if (next.stockOnHand < existing.stockReserved) {
    throw new HttpError(400, 'Stock on hand cannot be lower than currently reserved quantity.');
  }

  const status =
    input.status === 'inactive'
      ? 'inactive'
      : deriveStatus(next.stockOnHand, existing.stockReserved, next.reorderPoint, input.status);

  const aliases = {
    en: input.aliases?.en || (existing.aliases as any).en || next.name,
    ur: input.aliases?.ur || (existing.aliases as any).ur || next.name,
    ps: input.aliases?.ps || (existing.aliases as any).ps || next.name,
  };

  const [row] = await getDb()
    .update(products)
    .set({
      name: next.name,
      unit: next.unit,
      packSize: next.packSize,
      costPrice: next.costPrice.toFixed(2),
      sellingPrice: next.sellingPrice.toFixed(2),
      moq: next.moq,
      reorderPoint: next.reorderPoint,
      stockOnHand: next.stockOnHand,
      status,
      aliases,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), eq(products.wholesalerId, user.tenantId)))
    .returning();

  return mapProduct(row, true);
}

export async function deactivateProduct(user: AuthUser, productId: string): Promise<ProductView> {
  return updateProduct(user, productId, { status: 'inactive' });
}

export async function getSellableProduct(productId: string) {
  const [row] = await getDb()
    .select({ product: products, wholesaler: wholesalers })
    .from(products)
    .innerJoin(wholesalers, eq(products.wholesalerId, wholesalers.id))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) throw new HttpError(404, 'Product not found.');
  if (row.wholesaler.status !== 'active') {
    throw new HttpError(400, 'This wholesaler is suspended and cannot accept new orders.');
  }
  if (row.product.status === 'inactive') {
    throw new HttpError(400, 'This product is inactive.');
  }
  return row;
}

export async function refreshProductAvailabilityStatus(productId: string, tx = getDb()) {
  await tx.execute(sql`
    UPDATE products
    SET status = CASE
      WHEN status = 'inactive' THEN 'inactive'
      WHEN (stock_on_hand - stock_reserved) <= 0 THEN 'out_of_stock'
      WHEN (stock_on_hand - stock_reserved) <= reorder_point THEN 'low_stock'
      ELSE 'available'
    END,
    updated_at = NOW()
    WHERE id = ${productId}
  `);
}
