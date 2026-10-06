-- Owner changed the order notification inbox to the Midora Brevo sender address.
-- Keep the migration additive; do not edit the already-applied Batch 6 migrations.
UPDATE store_settings
SET order_notification_to = 'midoradesign@gmail.com',
    order_notifications_enabled = true,
    updated_at = now();
