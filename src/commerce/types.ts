export interface ProductView {
  id: string;
  wholesalerId: string;
  sku: string;
  name: string;
  aliases: { en: string; ur: string; ps: string };
  unit: string;
  packSize: string;
  costPrice: number;
  sellingPrice: number;
  moq: number;
  reorderPoint: number;
  stockOnHand: number;
  stockReserved: number;
  availableStock: number;
  status: string;
}

export interface CartLineView {
  id: string;
  productId: string;
  quantity: number;
  product: ProductView;
  lineTotal: number;
}

export interface CartView {
  id: string;
  clientId: string;
  items: CartLineView[];
  itemCount: number;
  subtotal: number;
  byWholesaler: { wholesalerId: string; subtotal: number; itemCount: number }[];
}

export interface OrderItemView {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  unit: string;
  packSize?: string;
}

export interface SubOrderView {
  id: string;
  orderId?: string;
  wholesalerId: string;
  items: OrderItemView[];
  subtotal: number;
  status: string;
  rejectReason?: string | null;
  clientName?: string;
}

export interface OrderView {
  id: string;
  clientId: string;
  clientName: string;
  deliveryAddress: string;
  status: string;
  subOrders: SubOrderView[];
  totalAmount: number;
  createdAt: string;
  paymentStatus: string;
  paidAmount: number;
}
