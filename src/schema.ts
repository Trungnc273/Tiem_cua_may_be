import { pgEnum, pgTable, uuid, varchar, text, integer, boolean, timestamp, char, bigint, jsonb, unique } from 'drizzle-orm/pg-core';

export const productStatus = pgEnum('product_status', ['DRAFT', 'ACTIVE', 'INACTIVE', 'DISCONTINUED']);
export const catalogProvenance = pgEnum('catalog_provenance', ['PRODUCTION', 'TEST']);
export const orderStatus = pgEnum('order_status', ['NEW', 'CONFIRMED', 'SHIPPING', 'COMPLETED', 'CANCELLED']);
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(), slug: varchar('slug', { length: 96 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(), description: text('description'), iconKey: varchar('icon_key', { length: 40 }),
  imageUrl: text('image_url'), provenance: catalogProvenance('provenance').notNull(), sortOrder: integer('sort_order').notNull(), isActive: boolean('is_active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(), slug: varchar('slug', { length: 140 }).notNull().unique(),
  name: varchar('name', { length: 180 }).notNull(), description: text('description').notNull(), categoryId: uuid('category_id').notNull(),
  status: productStatus('status').notNull(), provenance: catalogProvenance('provenance').notNull(), basePriceVnd: integer('base_price_vnd').notNull(),
  discountPercent: integer('discount_percent').notNull().default(0), isFeatured: boolean('is_featured').notNull(), isNew: boolean('is_new').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const productVariants = pgTable('product_variants', {
  id: uuid('id').defaultRandom().primaryKey(), productId: uuid('product_id').notNull(), sku: varchar('sku', { length: 80 }).notNull().unique(),
  size: varchar('size', { length: 40 }).notNull(), colorCode: varchar('color_code', { length: 48 }).notNull(), colorName: varchar('color_name', { length: 80 }).notNull(),
  displayColor: varchar('display_color', { length: 80 }), colorHex: varchar('color_hex', { length: 7 }), priceOverrideVnd: integer('price_override_vnd'),
  stockQuantity: integer('stock_quantity').notNull(), isActive: boolean('is_active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const productImages = pgTable('product_images', {
  id: uuid('id').defaultRandom().primaryKey(), productId: uuid('product_id').notNull(), variantId: uuid('variant_id'),
  url: text('url'), storageKey: text('storage_key').unique(), altText: varchar('alt_text', { length: 180 }).notNull(), sortOrder: integer('sort_order').notNull(),
  isPrimary: boolean('is_primary').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const productMediaFiles = pgTable('product_media_files', {
  id: uuid('id').defaultRandom().primaryKey(), storageKey: text('storage_key').notNull().unique(), contentType: varchar('content_type', { length: 32 }).notNull(),
  byteSize: integer('byte_size').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const storeSettings = pgTable('store_settings', {
  provenance: catalogProvenance('provenance').primaryKey(), contactPhone: varchar('contact_phone', { length: 24 }).notNull(), messengerUrl: text('messenger_url').notNull(),
  orderNotificationTo: varchar('order_notification_to', { length: 254 }).notNull(), orderNotificationsEnabled: boolean('order_notifications_enabled').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const cartSessions = pgTable('cart_sessions', {
  id: uuid('id').defaultRandom().primaryKey(), tokenHash: char('token_hash', { length: 64 }).notNull().unique(), provenance: catalogProvenance('provenance').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const cartItems = pgTable('cart_items', {
  id: uuid('id').defaultRandom().primaryKey(), cartSessionId: uuid('cart_session_id').notNull().references(() => cartSessions.id, { onDelete: 'cascade' }), variantId: uuid('variant_id').notNull().references(() => productVariants.id), quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [unique('cart_items_session_variant_uq').on(table.cartSessionId, table.variantId)]);
export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(), orderCode: varchar('order_code', { length: 20 }).notNull().unique(), provenance: catalogProvenance('provenance').notNull(),
  cartSessionId: uuid('cart_session_id').notNull().references(() => cartSessions.id), idempotencyKey: uuid('idempotency_key').notNull(), requestHash: char('request_hash', { length: 64 }).notNull(),
  customerName: varchar('customer_name', { length: 120 }).notNull(), customerPhone: varchar('customer_phone', { length: 24 }).notNull(), deliveryAddress: varchar('delivery_address', { length: 500 }).notNull(), customerNote: varchar('customer_note', { length: 1000 }).notNull(),
  status: orderStatus('status').notNull(), subtotalVnd: bigint('subtotal_vnd', { mode: 'number' }).notNull(), shippingFeeVnd: integer('shipping_fee_vnd'), totalVnd: bigint('total_vnd', { mode: 'number' }),
  shippingStatus: varchar('shipping_status', { length: 16 }).notNull(), provinceCode: varchar('province_code', { length: 12 }), provinceLabel: varchar('province_label', { length: 120 }),
  shippingEstimateRuleId: uuid('shipping_estimate_rule_id'), shippingEstimateRuleSnapshot: varchar('shipping_estimate_rule_snapshot', { length: 120 }),
  shippingEstimateMinVnd: integer('shipping_estimate_min_vnd'), shippingEstimateMaxVnd: integer('shipping_estimate_max_vnd'),
  carrierCode: varchar('carrier_code', { length: 24 }), carrierCustomName: varchar('carrier_custom_name', { length: 120 }), trackingNumber: varchar('tracking_number', { length: 120 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [unique('orders_cart_idempotency_uq').on(table.cartSessionId, table.idempotencyKey)]);
export const shippingEstimateRules = pgTable('shipping_estimate_rules', {
  id: uuid('id').defaultRandom().primaryKey(), provenance: catalogProvenance('provenance').notNull(), provinceCode: varchar('province_code', { length: 12 }), displayName: varchar('display_name', { length: 120 }).notNull(),
  estimateMinVnd: integer('estimate_min_vnd').notNull(), estimateMaxVnd: integer('estimate_max_vnd').notNull(), isFallback: boolean('is_fallback').notNull(), isActive: boolean('is_active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const orderNotifications = pgTable('order_notifications', {
  id: uuid('id').defaultRandom().primaryKey(), orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 16 }).notNull(), recipient: varchar('recipient', { length: 254 }).notNull(), status: varchar('status', { length: 16 }).notNull(),
  attempts: integer('attempts').notNull(), lastErrorCode: varchar('last_error_code', { length: 80 }), nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), sentAt: timestamp('sent_at', { withTimezone: true }),
});
export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(), orderId: uuid('order_id').notNull().references(() => orders.id), productId: uuid('product_id').notNull().references(() => products.id), variantId: uuid('variant_id').notNull().references(() => productVariants.id),
  productName: varchar('product_name', { length: 180 }).notNull(), variantSku: varchar('variant_sku', { length: 80 }).notNull(), colorName: varchar('color_name', { length: 80 }).notNull(), size: varchar('size', { length: 40 }).notNull(), imageUrl: text('image_url').notNull(), imageStorageKey: text('image_storage_key'),
  originalUnitPriceVnd: integer('original_unit_price_vnd').notNull(), discountPercent: integer('discount_percent').notNull(), saleUnitPriceVnd: integer('sale_unit_price_vnd').notNull(), quantity: integer('quantity').notNull(), lineTotalVnd: bigint('line_total_vnd', { mode: 'number' }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(), provenance: catalogProvenance('provenance').notNull(), email: varchar('email', { length: 254 }).notNull(), passwordSalt: char('password_salt', { length: 32 }).notNull(), passwordHash: char('password_hash', { length: 128 }).notNull(), role: varchar('role', { length: 16 }).notNull(), isActive: boolean('is_active').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => [unique('admin_users_provenance_email_uq').on(table.provenance, table.email)]);
export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').defaultRandom().primaryKey(), tokenHash: char('token_hash', { length: 64 }).notNull().unique(), adminUserId: uuid('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(), provenance: catalogProvenance('provenance').notNull(), actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }), eventType: varchar('event_type', { length: 48 }).notNull(), entityType: varchar('entity_type', { length: 24 }).notNull(), entityId: uuid('entity_id'), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
