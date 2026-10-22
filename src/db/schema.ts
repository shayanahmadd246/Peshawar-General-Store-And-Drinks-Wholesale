import { pgTable, text, timestamp, decimal, integer, jsonb, uniqueIndex, index, boolean } from 'drizzle-orm/pg-core';

export const wholesalers = pgTable('wholesalers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  city: text('city').notNull(),
  status: text('status').default('active').notNull(),
  ownerEmail: text('owner_email').notNull(),
  phone: text('phone').notNull(),
  rating: decimal('rating', { precision: 3, scale: 2 }).default('5.00').notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  tenantId: text('tenant_id').references(() => wholesalers.id, { onDelete: 'set null' }),
  phone: text('phone').unique(),
  storeName: text('store_name'),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    wholesalerId: text('wholesaler_id').references(() => wholesalers.id, { onDelete: 'cascade' }).notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    aliases: jsonb('aliases').notNull(),
    unit: text('unit').notNull(),
    packSize: text('pack_size').notNull(),
    costPrice: decimal('cost_price', { precision: 10, scale: 2 }).notNull(),
    sellingPrice: decimal('selling_price', { precision: 10, scale: 2 }).notNull(),
    moq: integer('moq').default(1).notNull(),
    reorderPoint: integer('reorder_point').default(10).notNull(),
    stockOnHand: integer('stock_on_hand').default(0).notNull(),
    stockReserved: integer('stock_reserved').default(0).notNull(),
    status: text('status').default('available').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('products_wholesaler_sku_idx').on(table.wholesalerId, table.sku),
    index('products_wholesaler_id_idx').on(table.wholesalerId),
  ]
);

export const carts = pgTable(
  'carts',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    status: text('status').default('open').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('carts_open_client_idx').on(table.clientId, table.status)]
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: text('id').primaryKey(),
    cartId: text('cart_id').references(() => carts.id, { onDelete: 'cascade' }).notNull(),
    productId: text('product_id').references(() => products.id).notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('cart_items_cart_product_idx').on(table.cartId, table.productId)]
);

export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  clientName: text('client_name').notNull(),
  deliveryAddress: text('delivery_address').notNull(),
  status: text('status').default('Submitted').notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  paymentStatus: text('payment_status').default('Unpaid').notNull(),
  paidAmount: decimal('paid_amount', { precision: 10, scale: 2 }).default('0.00').notNull(),
  idempotencyKey: text('idempotency_key').unique(),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const subOrders = pgTable(
  'sub_orders',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    wholesalerId: text('wholesaler_id').references(() => wholesalers.id).notNull(),
    subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
    status: text('status').default('Submitted').notNull(),
    rejectReason: text('reject_reason'),
    reviewedAt: timestamp('reviewed_at'),
  },
  (table) => [index('sub_orders_wholesaler_id_idx').on(table.wholesalerId)]
);

export const subOrderItems = pgTable('sub_order_items', {
  id: text('id').primaryKey(),
  subOrderId: text('sub_order_id').references(() => subOrders.id, { onDelete: 'cascade' }).notNull(),
  productId: text('product_id').references(() => products.id).notNull(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  costPrice: decimal('cost_price', { precision: 10, scale: 2 }).notNull(),
  unit: text('unit').notNull(),
  packSize: text('pack_size').notNull(),
});

export const shipments = pgTable(
  'shipments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').references(() => orders.id).notNull(),
    subOrderId: text('sub_order_id').references(() => subOrders.id),
    wholesalerId: text('wholesaler_id').references(() => wholesalers.id).notNull(),
    assigneeId: text('assignee_id'),
    assigneeName: text('assignee_name'),
    status: text('status').default('Unassigned').notNull(),
    expectedDate: text('expected_date').notNull(),
    proofNotes: text('proof_notes'),
    trackingRef: text('tracking_ref'),
    dispatchedAt: timestamp('dispatched_at'),
    inTransitAt: timestamp('in_transit_at'),
    deliveredAt: timestamp('delivered_at'),
    failedAt: timestamp('failed_at'),
    failureReason: text('failure_reason'),
    stockConsumed: boolean('stock_consumed').default(false).notNull(),
    reservationReleased: boolean('reservation_released').default(false).notNull(),
    statusIdempotencyKey: text('status_idempotency_key'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('shipments_assignee_id_idx').on(table.assigneeId),
    index('shipments_sub_order_id_idx').on(table.subOrderId),
    uniqueIndex('shipments_status_idempotency_idx').on(table.statusIdempotencyKey),
  ]
);

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    invoiceNumber: text('invoice_number').notNull(),
    orderId: text('order_id').references(() => orders.id).notNull(),
    subOrderId: text('sub_order_id').references(() => subOrders.id),
    shipmentId: text('shipment_id').references(() => shipments.id),
    wholesalerId: text('wholesaler_id').references(() => wholesalers.id).notNull(),
    clientId: text('client_id').notNull(),
    clientName: text('client_name').notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
    outstandingAmount: decimal('outstanding_amount', { precision: 12, scale: 2 }).notNull(),
    status: text('status').default('Unpaid').notNull(),
    idempotencyKey: text('idempotency_key'),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('invoices_invoice_number_idx').on(table.invoiceNumber),
    uniqueIndex('invoices_sub_order_id_idx').on(table.subOrderId),
    uniqueIndex('invoices_idempotency_key_idx').on(table.idempotencyKey),
    index('invoices_client_id_idx').on(table.clientId),
    index('invoices_wholesaler_id_idx').on(table.wholesalerId),
  ]
);

export const invoiceLines = pgTable('invoice_lines', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }).notNull(),
  productId: text('product_id').notNull(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  lineTotal: decimal('line_total', { precision: 12, scale: 2 }).notNull(),
  unit: text('unit').notNull(),
  packSize: text('pack_size').notNull(),
});

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    recordedByUserId: text('recorded_by_user_id').notNull(),
    recordedByRole: text('recorded_by_role').notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    status: text('status').default('Posted').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('payments_idempotency_key_idx').on(table.idempotencyKey)]
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull(),
    invoiceId: text('invoice_id').references(() => invoices.id).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('payment_allocations_invoice_id_idx').on(table.invoiceId)]
);

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  actor: text('actor').notNull(),
  role: text('role').notNull(),
  action: text('action').notNull(),
  details: text('details').notNull(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    title: text('title').default('Shopkeeper Assistant').notNull(),
    language: text('language').default('en').notNull(),
    status: text('status').default('open').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('conversations_client_id_idx').on(table.clientId)]
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
    clientId: text('client_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    language: text('language'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('chat_messages_conversation_id_idx').on(table.conversationId),
    index('chat_messages_client_id_idx').on(table.clientId),
  ]
);

export const aiToolCalls = pgTable('ai_tool_calls', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  messageId: text('message_id').references(() => chatMessages.id, { onDelete: 'set null' }),
  clientId: text('client_id').notNull(),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments').notNull(),
  result: jsonb('result'),
  status: text('status').default('ok').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const audioAssets = pgTable(
  'audio_assets',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // upload | tts
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    durationMs: integer('duration_ms'),
    storagePath: text('storage_path').notNull(),
    checksum: text('checksum'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audio_assets_client_id_idx').on(table.clientId)]
);

export const voiceTranscripts = pgTable(
  'voice_transcripts',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    audioAssetId: text('audio_asset_id').references(() => audioAssets.id, { onDelete: 'cascade' }).notNull(),
    rawTranscript: text('raw_transcript').notNull(),
    editedTranscript: text('edited_transcript'),
    detectedLanguage: text('detected_language'),
    status: text('status').default('pending_review').notNull(), // pending_review | submitted | discarded
    submissionKey: text('submission_key'),
    geminiUsed: boolean('gemini_used').default(false).notNull(),
    error: text('error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    submittedAt: timestamp('submitted_at'),
  },
  (table) => [
    index('voice_transcripts_client_id_idx').on(table.clientId),
    uniqueIndex('voice_transcripts_submission_key_uidx').on(table.submissionKey),
  ]
);

