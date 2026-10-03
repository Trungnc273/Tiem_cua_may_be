import { pool } from './db.js';
import { renderOrderNotification, sendOrderEmail } from './order-email.js';
import { createOrderNotificationProcessor } from './order-notification-worker.js';

const processBatch = createOrderNotificationProcessor(pool, renderOrderNotification, sendOrderEmail);

export function processPendingOrderNotifications(limit = 10): Promise<void> {
  return processBatch(limit);
}

export function startOrderNotificationWorker() {
  const interval = setInterval(() => { void processPendingOrderNotifications().catch(() => undefined); }, 5000);
  interval.unref();
  return () => clearInterval(interval);
}
