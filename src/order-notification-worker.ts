import type { OrderEmail } from './order-email.js';

type DbResult = { rows: Record<string, unknown>[] };
type NotificationDatabase = {
  connect(): Promise<{ query(sql: string, values?: unknown[]): Promise<DbResult>; release(): void }>;
  query(sql: string, values?: unknown[]): Promise<DbResult>;
};
type EmailPayload = { subject: string; html: string; text: string };
type EmailSender = (recipient: string, payload: EmailPayload) => Promise<{ sent: boolean; errorCode?: string }>;

const retryDelaySeconds = [30, 120, 600, 1800];

export function createOrderNotificationProcessor(
  database: NotificationDatabase,
  renderEmail: (order: OrderEmail, publicAppUrl?: string) => EmailPayload,
  sendEmail: EmailSender,
  nodeEnvironment = process.env.NODE_ENV,
) {
  let workerBusy = false;

  async function claimNotification() {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE order_notifications SET status='FAILED',locked_until=NULL,last_error_code=COALESCE(last_error_code,'WORKER_INTERRUPTED') WHERE status='SENDING' AND locked_until < now()");
      const next = await client.query("SELECT id,order_id,recipient,attempts FROM order_notifications WHERE status='PENDING' AND next_attempt_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
      if (!next.rows[0]) { await client.query('COMMIT'); return null; }
      const row = next.rows[0];
      const claimed = await client.query("UPDATE order_notifications SET status='SENDING',attempts=attempts+1,locked_until=now()+interval '2 minutes' WHERE id=$1 RETURNING id,order_id,recipient,attempts", [row.id]);
      await client.query('COMMIT');
      return claimed.rows[0] as { id: string; order_id: string; recipient: string; attempts: number };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function sendClaimed(row: { id: string; order_id: string; recipient: string; attempts: number }) {
    const [orderResult, itemsResult] = await Promise.all([
      database.query('SELECT id,order_code AS "orderCode",created_at AS "createdAt",customer_name AS "customerName",customer_phone AS "customerPhone",province_label AS "provinceLabel",delivery_address AS "deliveryAddress",customer_note AS note,subtotal_vnd AS "subtotalVnd",shipping_estimate_min_vnd AS "shippingEstimateMinVnd",shipping_estimate_max_vnd AS "shippingEstimateMaxVnd" FROM orders WHERE id=$1', [row.order_id]),
      database.query('SELECT product_name AS "productName",variant_sku AS sku,color_name AS "colorName",size,quantity,original_unit_price_vnd AS "originalPriceVnd",discount_percent AS "discountPercent",sale_unit_price_vnd AS "salePriceVnd",line_total_vnd AS "lineTotalVnd" FROM order_items WHERE order_id=$1 ORDER BY id', [row.order_id]),
    ]);
    if (!orderResult.rows[0]) {
      await database.query("UPDATE order_notifications SET status='FAILED',locked_until=NULL,last_error_code='ORDER_NOT_FOUND' WHERE id=$1", [row.id]);
      return;
    }
    const payload = renderEmail({ ...orderResult.rows[0], items: itemsResult.rows } as OrderEmail, process.env.PUBLIC_APP_URL);
    const result = await sendEmail(row.recipient, payload);
    if (result.sent) {
      await database.query("UPDATE order_notifications SET status='SENT',sent_at=now(),locked_until=NULL,last_error_code=NULL WHERE id=$1 AND status='SENDING'", [row.id]);
      return;
    }
    if (row.attempts >= 5) {
      await database.query("UPDATE order_notifications SET status='FAILED',locked_until=NULL,last_error_code=$2 WHERE id=$1 AND status='SENDING'", [row.id, result.errorCode]);
      return;
    }
    const delaySeconds = nodeEnvironment === 'test' ? 0 : retryDelaySeconds[row.attempts - 1] ?? 1800;
    await database.query("UPDATE order_notifications SET status='PENDING',locked_until=NULL,last_error_code=$2,next_attempt_at=now()+make_interval(secs=>$3) WHERE id=$1 AND status='SENDING'", [row.id, result.errorCode, delaySeconds]);
  }

  return async function processPendingOrderNotifications(limit = 10): Promise<void> {
    if (workerBusy) return;
    workerBusy = true;
    try {
      for (let i = 0; i < limit; i++) {
        const row = await claimNotification();
        if (!row) break;
        await sendClaimed(row);
      }
    } finally { workerBusy = false; }
  };
}
