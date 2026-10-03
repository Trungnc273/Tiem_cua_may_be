import assert from 'node:assert/strict';
import { test } from 'node:test';

const { createOrderNotificationProcessor } = await import('../src/order-notification-worker.ts');
const { renderOrderNotification } = await import('../src/order-email.ts');

function fakeDatabase() {
  const state = { orderPersisted: true, status: 'PENDING', attempts: 0, sentAt: false, lastError: null as string | null };
  const order = { id: 'order-1', orderCode: 'TCM-TEST', createdAt: new Date('2026-10-03T12:00:00Z'), customerName: 'QA', customerPhone: '0900000000', provinceLabel: 'Thành phố Hồ Chí Minh', deliveryAddress: '12 Nguyễn Huệ', note: '', subtotalVnd: 100000, shippingEstimateMinVnd: 25000, shippingEstimateMaxVnd: 40000 };
  const item = { productName: 'Áo <x>', sku: 'QA-1', colorName: 'Mây', size: 'M', quantity: 1, originalPriceVnd: 100000, discountPercent: 0, salePriceVnd: 100000, lineTotalVnd: 100000 };
  const client = {
    async query(sql: string) {
      if (sql.includes("SET status='FAILED'") && sql.includes('locked_until < now()')) return { rows: [] };
      if (sql.includes('SELECT id,order_id,recipient,attempts FROM order_notifications')) return { rows: state.status === 'PENDING' ? [{ id: 'notice-1', order_id: 'order-1', recipient: 'ntvippro24@gmail.com', attempts: state.attempts }] : [] };
      if (sql.includes("SET status='SENDING'")) { state.status = 'SENDING'; state.attempts += 1; return { rows: [{ id: 'notice-1', order_id: 'order-1', recipient: 'ntvippro24@gmail.com', attempts: state.attempts }] }; }
      return { rows: [] };
    },
    release() {},
  };
  const database = {
    async connect() { return client; },
    async query(sql: string) {
      if (sql.startsWith('SELECT id,order_code')) return { rows: state.orderPersisted ? [order] : [] };
      if (sql.startsWith('SELECT product_name')) return { rows: [item] };
      if (sql.includes("SET status='SENT'")) { state.status = 'SENT'; state.sentAt = true; state.lastError = null; return { rows: [] }; }
      if (sql.includes("SET status='PENDING'")) { state.status = 'PENDING'; state.lastError = 'BREVO_UNAVAILABLE'; return { rows: [] }; }
      if (sql.includes("SET status='FAILED'")) { state.status = 'FAILED'; state.lastError = 'BREVO_UNAVAILABLE'; return { rows: [] }; }
      return { rows: [] };
    },
  } as Parameters<typeof createOrderNotificationProcessor>[0];
  return { state, database };
}

test('persisted order outbox can send successfully and finish SENT', async () => {
  const { state, database } = fakeDatabase();
  let sent = 0;
  const process = createOrderNotificationProcessor(database, renderOrderNotification, async () => { sent += 1; return { sent: true }; }, 'test');
  await process(1);
  assert.equal(state.orderPersisted, true);
  assert.equal(sent, 1);
  assert.equal(state.status, 'SENT');
  assert.equal(state.sentAt, true);
});

test('Brevo failure leaves the order persisted and stops after bounded retries', async () => {
  const { state, database } = fakeDatabase();
  let attempts = 0;
  const process = createOrderNotificationProcessor(database, renderOrderNotification, async () => { attempts += 1; return { sent: false, errorCode: 'BREVO_UNAVAILABLE' }; }, 'test');
  for (let index = 0; index < 5; index += 1) {
    await process(1);
  }
  assert.equal(state.orderPersisted, true);
  assert.equal(attempts, 5);
  assert.equal(state.attempts, 5);
  assert.equal(state.status, 'FAILED');
  assert.equal(state.lastError, 'BREVO_UNAVAILABLE');
});
