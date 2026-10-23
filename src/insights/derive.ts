/** Pure insights derived from live commerce payloads — never invents stock or revenue. */

export interface InsightProductRef {
  id: string;
  name: string;
  sellingPrice: number;
  unit: string;
  moq: number;
  availableStock?: number;
  stockOnHand: number;
  stockReserved: number;
  reorderPoint: number;
  status: string;
}

export interface InsightOrderLine {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface InsightOrder {
  id: string;
  totalAmount: number;
  createdAt: string;
  status: string;
  subOrders?: {
    items?: InsightOrderLine[];
    status?: string;
    subtotal?: number;
  }[];
}

export interface FreqProduct {
  productId: string;
  name: string;
  timesOrdered: number;
  totalQty: number;
  lastUnitPrice: number;
  unit: string;
}

export function frequentProductsFromOrders(orders: InsightOrder[], limit = 6): FreqProduct[] {
  const map = new Map<string, FreqProduct>();
  for (const ord of orders) {
    for (const sub of ord.subOrders || []) {
      for (const item of sub.items || []) {
        if (!item.productId) continue;
        const prev = map.get(item.productId);
        if (prev) {
          prev.timesOrdered += 1;
          prev.totalQty += item.quantity;
          prev.lastUnitPrice = item.unitPrice;
        } else {
          map.set(item.productId, {
            productId: item.productId,
            name: item.name,
            timesOrdered: 1,
            totalQty: item.quantity,
            lastUnitPrice: item.unitPrice,
            unit: item.unit,
          });
        }
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.timesOrdered - a.timesOrdered || b.totalQty - a.totalQty)
    .slice(0, limit);
}

export function lastOrderLines(orders: InsightOrder[]): { orderId: string; lines: InsightOrderLine[]; totalAmount: number; createdAt: string } | null {
  if (!orders.length) return null;
  const sorted = [...orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const latest = sorted[0];
  const lines = (latest.subOrders || []).flatMap((s) => s.items || []);
  if (!lines.length) return null;
  return {
    orderId: latest.id,
    lines,
    totalAmount: latest.totalAmount,
    createdAt: latest.createdAt,
  };
}

export function inventoryHealth(products: InsightProductRef[]) {
  const active = products.filter((p) => p.status !== 'inactive');
  let healthy = 0;
  let low = 0;
  let out = 0;
  for (const p of active) {
    const avail = p.availableStock ?? Math.max(0, p.stockOnHand - p.stockReserved);
    if (avail <= 0 || p.status === 'out_of_stock') out += 1;
    else if (avail <= p.reorderPoint || p.status === 'low_stock') low += 1;
    else healthy += 1;
  }
  return { healthy, low, out, total: active.length };
}

export function orderAmountSeries(orders: InsightOrder[], buckets = 8): number[] {
  if (!orders.length) return Array(buckets).fill(0);
  const sorted = [...orders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const series = sorted.map((o) => Number(o.totalAmount || 0));
  if (series.length <= buckets) {
    return [...Array(buckets - series.length).fill(0), ...series];
  }
  // downsample by averaging contiguous chunks
  const chunk = Math.ceil(series.length / buckets);
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const slice = series.slice(i * chunk, (i + 1) * chunk);
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0);
  }
  return out;
}

export function bestSellersFromSubOrders(
  orders: InsightOrder[],
  wholesalerIdFilter?: (sub: { wholesalerId?: string }) => boolean,
  limit = 5
) {
  const map = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const ord of orders) {
    for (const sub of ord.subOrders || []) {
      if (wholesalerIdFilter && !wholesalerIdFilter(sub as any)) continue;
      if (!['Approved', 'Fulfilled'].includes(String((sub as any).status || ''))) continue;
      for (const item of sub.items || []) {
        const key = item.productId || item.name;
        const prev = map.get(key) || { name: item.name, qty: 0, revenue: 0 };
        prev.qty += item.quantity;
        prev.revenue += item.quantity * item.unitPrice;
        map.set(key, prev);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}
