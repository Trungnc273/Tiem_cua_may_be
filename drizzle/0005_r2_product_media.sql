ALTER TABLE product_images ALTER COLUMN url DROP NOT NULL;
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_url_check;
ALTER TABLE product_images ADD COLUMN storage_key text UNIQUE;
ALTER TABLE product_images ADD CONSTRAINT product_images_storage_key_check CHECK (
  storage_key IS NULL OR storage_key ~ '^(?:[a-f0-9]{32}\.(jpg|png|webp)|products/[0-9a-f-]{36}/[a-f0-9]{32}\.(jpg|png|webp))$'
);
ALTER TABLE product_media_files ALTER COLUMN storage_key TYPE text;
ALTER TABLE product_media_files DROP CONSTRAINT IF EXISTS product_media_files_storage_key_check;
ALTER TABLE product_media_files ADD CONSTRAINT product_media_files_storage_key_check CHECK (storage_key ~ '^(?:[a-f0-9]{32}\.(jpg|png|webp)|products/[0-9a-f-]{36}/[a-f0-9]{32}\.(jpg|png|webp))$');
ALTER TABLE order_items ADD COLUMN image_storage_key text;
ALTER TABLE order_items ADD CONSTRAINT order_items_image_storage_key_check CHECK (
  image_storage_key IS NULL OR image_storage_key ~ '^(?:[a-f0-9]{32}\.(jpg|png|webp)|products/[0-9a-f-]{36}/[a-f0-9]{32}\.(jpg|png|webp))$'
);

UPDATE product_images
SET storage_key = substring(url FROM '^/api/v1/public/media/products/([a-f0-9]{32}\.(?:jpg|png|webp))$')
WHERE url ~ '^/api/v1/public/media/products/[a-f0-9]{32}\.(jpg|png|webp)$';
