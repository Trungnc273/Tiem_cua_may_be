ALTER TABLE products ADD COLUMN discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100);

CREATE TABLE store_settings (
  provenance catalog_provenance PRIMARY KEY,
  contact_phone varchar(24) NOT NULL DEFAULT '0876146498' CHECK (length(contact_phone) BETWEEN 8 AND 24),
  messenger_url text NOT NULL DEFAULT 'https://www.facebook.com/tiemcuamay04' CHECK (messenger_url ~ '^https://(www\.)?facebook\.com/'),
  default_shipping_fee_vnd integer CHECK (default_shipping_fee_vnd IS NULL OR default_shipping_fee_vnd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  provenance catalog_provenance NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_session_id uuid NOT NULL REFERENCES cart_sessions(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cart_session_id, variant_id)
);

CREATE TYPE order_status AS ENUM ('NEW', 'CONFIRMED', 'SHIPPING', 'COMPLETED', 'CANCELLED');
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code varchar(20) NOT NULL UNIQUE,
  provenance catalog_provenance NOT NULL,
  cart_session_id uuid NOT NULL REFERENCES cart_sessions(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  customer_name varchar(120) NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 120),
  customer_phone varchar(24) NOT NULL CHECK (length(customer_phone) BETWEEN 8 AND 24),
  delivery_address varchar(500) NOT NULL CHECK (length(trim(delivery_address)) BETWEEN 5 AND 500),
  customer_note varchar(1000) NOT NULL DEFAULT '' CHECK (length(customer_note) <= 1000),
  status order_status NOT NULL DEFAULT 'NEW',
  subtotal_vnd bigint NOT NULL CHECK (subtotal_vnd >= 0),
  shipping_fee_vnd integer NOT NULL CHECK (shipping_fee_vnd >= 0),
  total_vnd bigint NOT NULL CHECK (total_vnd = subtotal_vnd + shipping_fee_vnd),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cart_session_id, idempotency_key)
);
CREATE INDEX orders_created_idx ON orders(created_at DESC, id DESC);
CREATE INDEX orders_status_created_idx ON orders(status, created_at DESC, id);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name varchar(180) NOT NULL,
  variant_sku varchar(80) NOT NULL,
  color_name varchar(80) NOT NULL,
  size varchar(40) NOT NULL,
  image_url text NOT NULL DEFAULT '',
  original_unit_price_vnd integer NOT NULL CHECK (original_unit_price_vnd >= 0),
  discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  sale_unit_price_vnd integer NOT NULL CHECK (sale_unit_price_vnd >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  line_total_vnd bigint NOT NULL CHECK (line_total_vnd = sale_unit_price_vnd::bigint * quantity),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provenance catalog_provenance NOT NULL,
  email varchar(254) NOT NULL,
  password_salt char(32) NOT NULL,
  password_hash char(128) NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'ADMIN' CHECK (role = 'ADMIN'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provenance, email)
);
CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provenance catalog_provenance NOT NULL,
  actor_admin_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  event_type varchar(48) NOT NULL CHECK (event_type IN ('ADMIN_LOGIN_SUCCEEDED','ADMIN_LOGOUT','ORDER_STATUS_CHANGED','PRODUCT_PRICE_CHANGED','PRODUCT_DISCOUNT_CHANGED','STORE_SETTINGS_CHANGED')),
  entity_type varchar(24) NOT NULL CHECK (entity_type IN ('ADMIN','ORDER','PRODUCT','SETTINGS')),
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC, id);

INSERT INTO store_settings(provenance) VALUES ('PRODUCTION'), ('TEST') ON CONFLICT DO NOTHING;
