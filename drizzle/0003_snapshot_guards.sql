CREATE FUNCTION guard_order_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.order_code, NEW.provenance, NEW.cart_session_id, NEW.idempotency_key, NEW.request_hash,
      NEW.customer_name, NEW.customer_phone, NEW.delivery_address, NEW.customer_note,
      NEW.subtotal_vnd, NEW.shipping_fee_vnd, NEW.total_vnd, NEW.created_at)
     IS DISTINCT FROM
     (OLD.order_code, OLD.provenance, OLD.cart_session_id, OLD.idempotency_key, OLD.request_hash,
      OLD.customer_name, OLD.customer_phone, OLD.delivery_address, OLD.customer_note,
      OLD.subtotal_vnd, OLD.shipping_fee_vnd, OLD.total_vnd, OLD.created_at) THEN
    RAISE EXCEPTION 'Order snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION guard_order_snapshot_update();

CREATE FUNCTION guard_order_item_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order item snapshots are immutable';
END;
$$;
CREATE TRIGGER order_items_snapshot_immutable BEFORE UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION guard_order_item_update();

CREATE FUNCTION guard_audit_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION guard_audit_event_mutation();
