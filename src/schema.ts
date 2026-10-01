import { pgEnum, pgTable, uuid, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const productStatus = pgEnum('product_status', ['DRAFT', 'ACTIVE', 'INACTIVE', 'DISCONTINUED']);
export const catalogProvenance = pgEnum('catalog_provenance', ['PRODUCTION', 'TEST']);
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
  isFeatured: boolean('is_featured').notNull(), isNew: boolean('is_new').notNull(),
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
  url: text('url').notNull(), altText: varchar('alt_text', { length: 180 }).notNull(), sortOrder: integer('sort_order').notNull(),
  isPrimary: boolean('is_primary').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
