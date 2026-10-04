ALTER TABLE store_settings
  ADD COLUMN shop_address varchar(500),
  ADD COLUMN shop_latitude numeric(9,6),
  ADD COLUMN shop_longitude numeric(9,6),
  ADD COLUMN order_notification_to varchar(254) NOT NULL DEFAULT 'ntvippro24@gmail.com',
  ADD COLUMN order_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT store_settings_shop_coordinates_pair_check
    CHECK ((shop_latitude IS NULL) = (shop_longitude IS NULL)),
  ADD CONSTRAINT store_settings_shop_latitude_check
    CHECK (shop_latitude IS NULL OR shop_latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT store_settings_shop_longitude_check
    CHECK (shop_longitude IS NULL OR shop_longitude BETWEEN -180 AND 180);

CREATE TABLE shipping_distance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provenance catalog_provenance NOT NULL,
  name varchar(100) NOT NULL,
  min_distance_meters integer NOT NULL CHECK (min_distance_meters >= 0),
  max_distance_meters integer CHECK (max_distance_meters IS NULL OR max_distance_meters > min_distance_meters),
  fee_vnd integer NOT NULL CHECK (fee_vnd >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_distance_rules_name_check CHECK (length(trim(name)) BETWEEN 1 AND 100)
);
CREATE INDEX shipping_distance_rules_active_lookup_idx
  ON shipping_distance_rules(provenance, is_active, min_distance_meters, sort_order);

ALTER TABLE orders
  ADD COLUMN shop_address_snapshot varchar(500),
  ADD COLUMN shop_latitude_snapshot numeric(9,6),
  ADD COLUMN shop_longitude_snapshot numeric(9,6),
  ADD COLUMN delivery_latitude numeric(9,6),
  ADD COLUMN delivery_longitude numeric(9,6),
  ADD COLUMN distance_meters integer CHECK (distance_meters IS NULL OR distance_meters >= 0),
  ADD COLUMN distance_method varchar(48),
  ADD COLUMN shipping_rule_id uuid REFERENCES shipping_distance_rules(id) ON DELETE SET NULL,
  ADD COLUMN shipping_rule_name_snapshot varchar(100),
  ADD COLUMN shipping_rule_min_distance_snapshot integer,
  ADD COLUMN shipping_rule_max_distance_snapshot integer;

CREATE TABLE order_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel varchar(16) NOT NULL DEFAULT 'EMAIL' CHECK (channel = 'EMAIL'),
  recipient varchar(254) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_error_code varchar(80),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(order_id, channel)
);
CREATE INDEX order_notifications_pending_idx
  ON order_notifications(next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'SENDING');

ALTER TABLE audit_events DROP CONSTRAINT audit_events_event_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_event_type_check CHECK (event_type IN (
  'ADMIN_LOGIN_SUCCEEDED', 'ADMIN_LOGOUT', 'ORDER_STATUS_CHANGED', 'PRODUCT_PRICE_CHANGED',
  'PRODUCT_DISCOUNT_CHANGED', 'STORE_SETTINGS_CHANGED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED',
  'PRODUCT_STATUS_CHANGED', 'PRODUCT_IMAGE_ADDED', 'PRODUCT_IMAGE_REMOVED', 'PRODUCT_VARIANT_CREATED',
  'PRODUCT_VARIANT_UPDATED', 'PRODUCT_VARIANT_DISABLED', 'PRODUCT_STOCK_CHANGED', 'CATEGORY_CREATED',
  'CATEGORY_UPDATED', 'CATEGORY_STATUS_CHANGED',
  'SHOP_LOCATION_CHANGED', 'SHIPPING_RULE_CREATED', 'SHIPPING_RULE_UPDATED', 'SHIPPING_RULE_DISABLED',
  'ORDER_NOTIFICATION_RECIPIENT_CHANGED', 'ORDER_NOTIFICATION_RETRIED'
));
ALTER TABLE audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK (entity_type IN (
  'ADMIN', 'ORDER', 'PRODUCT', 'SETTINGS', 'CATEGORY', 'VARIANT', 'IMAGE', 'SHIPPING_RULE'
));

CREATE OR REPLACE FUNCTION guard_order_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.order_code, NEW.provenance, NEW.cart_session_id, NEW.idempotency_key, NEW.request_hash,
      NEW.customer_name, NEW.customer_phone, NEW.delivery_address, NEW.customer_note,
      NEW.subtotal_vnd, NEW.shipping_fee_vnd, NEW.total_vnd, NEW.created_at,
      NEW.shop_address_snapshot, NEW.shop_latitude_snapshot, NEW.shop_longitude_snapshot, NEW.delivery_latitude,
      NEW.delivery_longitude, NEW.distance_meters, NEW.distance_method, NEW.shipping_rule_id,
      NEW.shipping_rule_name_snapshot, NEW.shipping_rule_min_distance_snapshot,
      NEW.shipping_rule_max_distance_snapshot)
     IS DISTINCT FROM
     (OLD.order_code, OLD.provenance, OLD.cart_session_id, OLD.idempotency_key, OLD.request_hash,
      OLD.customer_name, OLD.customer_phone, OLD.delivery_address, OLD.customer_note,
      OLD.subtotal_vnd, OLD.shipping_fee_vnd, OLD.total_vnd, OLD.created_at,
      OLD.shop_address_snapshot, OLD.shop_latitude_snapshot, OLD.shop_longitude_snapshot, OLD.delivery_latitude,
      OLD.delivery_longitude, OLD.distance_meters, OLD.distance_method, OLD.shipping_rule_id,
      OLD.shipping_rule_name_snapshot, OLD.shipping_rule_min_distance_snapshot,
      OLD.shipping_rule_max_distance_snapshot) THEN
    RAISE EXCEPTION 'Order snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
