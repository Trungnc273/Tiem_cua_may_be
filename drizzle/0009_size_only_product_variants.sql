ALTER TABLE product_variants
  ALTER COLUMN color_code DROP NOT NULL,
  ALTER COLUMN color_name DROP NOT NULL;
