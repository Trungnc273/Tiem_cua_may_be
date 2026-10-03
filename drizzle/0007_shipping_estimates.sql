-- Batch 6 V1: province-based estimated ranges and staff-confirmed shipping.
-- Kept additive because production migration state must be verified before any cleanup.
CREATE TABLE shipping_estimate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provenance catalog_provenance NOT NULL,
  province_code varchar(12),
  display_name varchar(120) NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  estimate_min_vnd integer NOT NULL CHECK (estimate_min_vnd >= 0),
  estimate_max_vnd integer NOT NULL CHECK (estimate_max_vnd >= estimate_min_vnd),
  is_fallback boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_estimate_region_shape CHECK ((is_fallback AND province_code IS NULL) OR (NOT is_fallback AND province_code IS NOT NULL))
);
CREATE UNIQUE INDEX shipping_estimate_one_active_region_idx
  ON shipping_estimate_rules(provenance, province_code) WHERE is_active AND NOT is_fallback;
CREATE UNIQUE INDEX shipping_estimate_one_active_fallback_idx
  ON shipping_estimate_rules(provenance) WHERE is_active AND is_fallback;

ALTER TABLE orders
  ALTER COLUMN shipping_fee_vnd DROP NOT NULL,
  ALTER COLUMN total_vnd DROP NOT NULL,
  DROP CONSTRAINT orders_shipping_fee_vnd_check,
  -- The cross-column total CHECK is named orders_check by PostgreSQL.
  DROP CONSTRAINT orders_check,
  ADD CONSTRAINT orders_shipping_total_pair_check CHECK (
    (shipping_fee_vnd IS NULL AND total_vnd IS NULL) OR
    (shipping_fee_vnd IS NOT NULL AND shipping_fee_vnd >= 0 AND total_vnd = subtotal_vnd + shipping_fee_vnd)
  ),
  ADD COLUMN shipping_status varchar(16) NOT NULL DEFAULT 'CONFIRMED' CHECK (shipping_status IN ('ESTIMATED', 'CONFIRMED')),
  ADD COLUMN province_code varchar(12),
  ADD COLUMN province_label varchar(120),
  ADD COLUMN shipping_estimate_rule_id uuid,
  ADD COLUMN shipping_estimate_rule_snapshot varchar(120),
  ADD COLUMN shipping_estimate_min_vnd integer CHECK (shipping_estimate_min_vnd IS NULL OR shipping_estimate_min_vnd >= 0),
  ADD COLUMN shipping_estimate_max_vnd integer CHECK (shipping_estimate_max_vnd IS NULL OR shipping_estimate_max_vnd >= shipping_estimate_min_vnd),
  ADD COLUMN carrier_code varchar(24),
  ADD COLUMN carrier_custom_name varchar(120),
  ADD COLUMN tracking_number varchar(120),
  ADD CONSTRAINT orders_shipping_estimate_pair_check CHECK ((shipping_estimate_min_vnd IS NULL) = (shipping_estimate_max_vnd IS NULL)),
  ADD CONSTRAINT orders_shipping_confirmed_fields_check CHECK (
    shipping_status <> 'CONFIRMED' OR
    (shipping_fee_vnd IS NOT NULL AND total_vnd IS NOT NULL)
  );

-- Existing orders retain their previously confirmed fee and total. Only newly inserted
-- Batch 6 orders explicitly start as ESTIMATED with nullable final values.
UPDATE orders SET shipping_status='CONFIRMED' WHERE shipping_fee_vnd IS NOT NULL AND total_vnd IS NOT NULL;

-- The Batch 5 immutable item/order snapshot stays protected. Batch 6 shipping confirmation
-- fields are intentionally mutable and guarded by Admin endpoints plus audit events.
CREATE OR REPLACE FUNCTION guard_order_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.order_code, NEW.provenance, NEW.cart_session_id, NEW.idempotency_key, NEW.request_hash,
      NEW.customer_name, NEW.customer_phone, NEW.delivery_address, NEW.customer_note,
      NEW.subtotal_vnd, NEW.created_at,
      NEW.province_code, NEW.province_label, NEW.shipping_estimate_rule_id,
      NEW.shipping_estimate_rule_snapshot, NEW.shipping_estimate_min_vnd, NEW.shipping_estimate_max_vnd)
     IS DISTINCT FROM
     (OLD.order_code, OLD.provenance, OLD.cart_session_id, OLD.idempotency_key, OLD.request_hash,
      OLD.customer_name, OLD.customer_phone, OLD.delivery_address, OLD.customer_note,
      OLD.subtotal_vnd, OLD.created_at,
      OLD.province_code, OLD.province_label, OLD.shipping_estimate_rule_id,
      OLD.shipping_estimate_rule_snapshot, OLD.shipping_estimate_min_vnd, OLD.shipping_estimate_max_vnd) THEN
    RAISE EXCEPTION 'Order snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Remove the abandoned distance/map model introduced in unreleased 0006.
ALTER TABLE orders
  DROP COLUMN shop_address_snapshot,
  DROP COLUMN shop_latitude_snapshot,
  DROP COLUMN shop_longitude_snapshot,
  DROP COLUMN delivery_latitude,
  DROP COLUMN delivery_longitude,
  DROP COLUMN distance_meters,
  DROP COLUMN distance_method,
  DROP COLUMN shipping_rule_id,
  DROP COLUMN shipping_rule_name_snapshot,
  DROP COLUMN shipping_rule_min_distance_snapshot,
  DROP COLUMN shipping_rule_max_distance_snapshot;
DROP TABLE shipping_distance_rules;
ALTER TABLE store_settings
  DROP COLUMN default_shipping_fee_vnd,
  DROP COLUMN shop_address,
  DROP COLUMN shop_latitude,
  DROP COLUMN shop_longitude;
ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_event_type_check,
  ADD CONSTRAINT audit_events_event_type_check CHECK (event_type IN (
    'ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGOUT', 'ORDER_STATUS_CHANGED', 'PRODUCT_PRICE_CHANGED',
    'PRODUCT_DISCOUNT_CHANGED', 'STORE_SETTINGS_CHANGED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED',
    'PRODUCT_STATUS_CHANGED', 'PRODUCT_IMAGE_ADDED', 'PRODUCT_IMAGE_REMOVED', 'PRODUCT_VARIANT_CREATED',
    'PRODUCT_VARIANT_UPDATED', 'PRODUCT_VARIANT_DISABLED', 'PRODUCT_STOCK_CHANGED', 'CATEGORY_CREATED',
    'CATEGORY_UPDATED', 'CATEGORY_STATUS_CHANGED', 'ORDER_NOTIFICATION_RECIPIENT_CHANGED',
    'ORDER_NOTIFICATION_RETRIED', 'ORDER_SHIPPING_CONFIRMED', 'SHIPPING_ESTIMATE_CREATED',
    'SHIPPING_ESTIMATE_UPDATED', 'SHIPPING_ESTIMATE_DISABLED'
  )),
  DROP CONSTRAINT audit_events_entity_type_check,
  ADD CONSTRAINT audit_events_entity_type_check CHECK (entity_type IN ('ADMIN','ORDER','PRODUCT','SETTINGS','CATEGORY','VARIANT','IMAGE','SHIPPING_ESTIMATE'));
