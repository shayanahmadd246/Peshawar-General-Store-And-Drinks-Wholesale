import { sql } from 'drizzle-orm';
import { HttpError } from '../auth/rbac';
import { refreshProductAvailabilityStatus } from './products';

type Tx = {
  execute: (query: any) => Promise<any>;
};

export async function consumeReservedStock(
  tx: Tx,
  items: { productId: string; quantity: number; name: string }[]
) {
  for (const item of items) {
    const result = await tx.execute(sql`
      UPDATE products
      SET stock_on_hand = stock_on_hand - ${item.quantity},
          stock_reserved = stock_reserved - ${item.quantity},
          updated_at = NOW()
      WHERE id = ${item.productId}
        AND stock_reserved >= ${item.quantity}
        AND stock_on_hand >= ${item.quantity}
        AND stock_on_hand - ${item.quantity} >= 0
        AND stock_reserved - ${item.quantity} >= 0
    `);
    if (Number((result as any).rowCount ?? 0) !== 1) {
      throw new HttpError(409, `Unable to consume reserved stock for ${item.name}.`);
    }
    await refreshProductAvailabilityStatus(item.productId, tx as any);
  }
}

export async function releaseReservedStock(
  tx: Tx,
  items: { productId: string; quantity: number; name: string }[]
) {
  for (const item of items) {
    const result = await tx.execute(sql`
      UPDATE products
      SET stock_reserved = stock_reserved - ${item.quantity},
          updated_at = NOW()
      WHERE id = ${item.productId}
        AND stock_reserved >= ${item.quantity}
        AND stock_reserved - ${item.quantity} >= 0
    `);
    if (Number((result as any).rowCount ?? 0) !== 1) {
      throw new HttpError(409, `Unable to release reservation for ${item.name}.`);
    }
    await refreshProductAvailabilityStatus(item.productId, tx as any);
  }
}
