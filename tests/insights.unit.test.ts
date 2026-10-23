import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestSellersFromSubOrders,
  frequentProductsFromOrders,
  inventoryHealth,
  lastOrderLines,
  orderAmountSeries,
} from '../src/insights/derive.ts';

describe('insights/derive', () => {
  const orders = [
    {
      id: 'o1',
      totalAmount: 1000,
      createdAt: '2026-01-01T10:00:00.000Z',
      status: 'Delivered',
      subOrders: [
        {
          wholesalerId: 'w1',
          status: 'Approved',
          items: [
            { productId: 'p1', name: 'Pepsi', quantity: 5, unit: 'carton', unitPrice: 100 },
            { productId: 'p2', name: 'Lays', quantity: 2, unit: 'box', unitPrice: 80 },
          ],
        },
      ],
    },
    {
      id: 'o2',
      totalAmount: 500,
      createdAt: '2026-01-02T10:00:00.000Z',
      status: 'Submitted',
      subOrders: [
        {
          wholesalerId: 'w1',
          status: 'Approved',
          items: [{ productId: 'p1', name: 'Pepsi', quantity: 3, unit: 'carton', unitPrice: 100 }],
        },
      ],
    },
  ];

  it('ranks frequent products from real order lines', () => {
    const freq = frequentProductsFromOrders(orders as any, 5);
    assert.equal(freq[0].productId, 'p1');
    assert.equal(freq[0].timesOrdered, 2);
    assert.equal(freq[0].totalQty, 8);
  });

  it('returns last order lines without inventing items', () => {
    const last = lastOrderLines(orders as any);
    assert.ok(last);
    assert.equal(last!.orderId, 'o2');
    assert.equal(last!.lines.length, 1);
    assert.equal(last!.lines[0].productId, 'p1');
  });

  it('computes inventory health from live stock fields', () => {
    const health = inventoryHealth([
      { id: 'a', name: 'A', sellingPrice: 1, unit: 'u', moq: 1, stockOnHand: 50, stockReserved: 0, reorderPoint: 10, status: 'available' },
      { id: 'b', name: 'B', sellingPrice: 1, unit: 'u', moq: 1, stockOnHand: 5, stockReserved: 0, reorderPoint: 10, status: 'low_stock' },
      { id: 'c', name: 'C', sellingPrice: 1, unit: 'u', moq: 1, stockOnHand: 0, stockReserved: 0, reorderPoint: 5, status: 'out_of_stock' },
      { id: 'd', name: 'D', sellingPrice: 1, unit: 'u', moq: 1, stockOnHand: 9, stockReserved: 0, reorderPoint: 5, status: 'inactive' },
    ] as any);
    assert.deepEqual(health, { healthy: 1, low: 1, out: 1, total: 3 });
  });

  it('builds order amount series without fabricating non-zero points', () => {
    const series = orderAmountSeries([], 4);
    assert.deepEqual(series, [0, 0, 0, 0]);
    const live = orderAmountSeries(orders as any, 4);
    assert.equal(live.length, 4);
    assert.ok(live.some((v) => v > 0));
  });

  it('ranks best sellers only from approved/fulfilled subs', () => {
    const sellers = bestSellersFromSubOrders(orders as any, (sub) => (sub as any).wholesalerId === 'w1', 3);
    assert.equal(sellers[0].name, 'Pepsi');
    assert.equal(sellers[0].qty, 8);
  });
});
