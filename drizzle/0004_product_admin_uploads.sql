ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_event_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_event_type_check CHECK (event_type IN (
  'ADMIN_LOGIN_SUCCEEDED','ADMIN_LOGOUT','ORDER_STATUS_CHANGED','PRODUCT_PRICE_CHANGED','PRODUCT_DISCOUNT_CHANGED','STORE_SETTINGS_CHANGED',
  'PRODUCT_CREATED','PRODUCT_UPDATED','PRODUCT_STATUS_CHANGED','PRODUCT_IMAGE_ADDED','PRODUCT_IMAGE_REMOVED',
  'PRODUCT_VARIANT_CREATED','PRODUCT_VARIANT_UPDATED','PRODUCT_VARIANT_DISABLED','PRODUCT_STOCK_CHANGED',
  'CATEGORY_CREATED','CATEGORY_UPDATED','CATEGORY_STATUS_CHANGED'
));
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_entity_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK (entity_type IN ('ADMIN','ORDER','PRODUCT','SETTINGS','CATEGORY','VARIANT','IMAGE'));

UPDATE categories SET icon_key='accessory',updated_at=now() WHERE icon_key='bag';

CREATE TABLE product_media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key varchar(48) NOT NULL UNIQUE CHECK (storage_key ~ '^[a-f0-9]{32}\.(jpg|png|webp)$'),
  content_type varchar(32) NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_images_one_primary_uq ON product_images(product_id) WHERE is_primary = true;
CREATE INDEX product_variants_sku_search_idx ON product_variants(sku);
CREATE INDEX product_media_created_idx ON product_media_files(created_at DESC);
