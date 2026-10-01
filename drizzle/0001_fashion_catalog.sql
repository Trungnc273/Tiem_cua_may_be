CREATE TYPE product_status AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'DISCONTINUED');
CREATE TYPE catalog_provenance AS ENUM ('PRODUCTION', 'TEST');

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(96) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  description text,
  icon_key varchar(40),
  image_url text,
  provenance catalog_provenance NOT NULL DEFAULT 'PRODUCTION',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(140) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  description text NOT NULL DEFAULT '',
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  status product_status NOT NULL DEFAULT 'DRAFT',
  provenance catalog_provenance NOT NULL DEFAULT 'TEST',
  base_price_vnd integer NOT NULL CHECK (base_price_vnd >= 0),
  is_featured boolean NOT NULL DEFAULT false,
  is_new boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE INDEX products_status_created_idx ON products(status, created_at DESC, id);
CREATE INDEX products_category_status_idx ON products(category_id, status);

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku varchar(80) NOT NULL UNIQUE,
  size varchar(40) NOT NULL,
  color_code varchar(48) NOT NULL,
  color_name varchar(80) NOT NULL,
  display_color varchar(80),
  color_hex varchar(7) CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  price_override_vnd integer CHECK (price_override_vnd IS NULL OR price_override_vnd >= 0),
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variants_product_active_idx ON product_variants(product_id, is_active);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~ '^(https?://|/)'),
  alt_text varchar(180) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_order_idx ON product_images(product_id, sort_order, id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
