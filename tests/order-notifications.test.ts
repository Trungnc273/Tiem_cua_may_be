import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeEmailHtml, renderOrderNotification, sendOrderEmail } from '../src/order-email.ts';

const order = {
  id: '00000000-0000-4000-8000-000000000001', orderCode: 'TCM-ABC123', createdAt: new Date('2026-10-03T12:00:00Z'),
  customerName: '<script>alert(1)</script>', customerPhone: '0900000000', provinceLabel: 'Thành phố Hồ Chí Minh', deliveryAddress: 'A & B <img src=x>', note: '"hello" & goodbye',
  subtotalVnd: 100000, shippingEstimateMinVnd: 25000, shippingEstimateMaxVnd: 35000,
  items: [{ productName: '<b>Hat</b>', sku: 'H-01', colorName: 'Cream & white', size: 'M', quantity: 2, originalPriceVnd: 60000, discountPercent: 20, salePriceVnd: 48000, lineTotalVnd: 96000 }],
};

test('HTML email escapes customer and product content while retaining a plain-text version', () => {
  const content = renderOrderNotification(order, 'https://midora.pro.vn');
  assert.equal(escapeEmailHtml(`<'"&>`), '&lt;&#39;&quot;&amp;&gt;');
  assert.ok(!content.html.includes('<script>alert(1)</script>'));
  assert.ok(!content.html.includes('<img src=x>'));
  assert.ok(content.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(content.text.includes('A & B <img src=x>'));
  assert.ok(content.text.includes('/admin/orders/00000000-0000-4000-8000-000000000001'));
  assert.ok(content.text.includes('Phí vận chuyển chưa phải phí chính thức.'));
  assert.ok(content.text.includes('Thành phố Hồ Chí Minh'));
});

test('email sender falls back to the approved sender and never requires the API key in client data', async () => {
  let requestBody: Record<string, unknown> | undefined;
  let requestHeaders: HeadersInit | undefined;
  const result = await sendOrderEmail('midoradesign@gmail.com', renderOrderNotification(order), { BREVO_API_KEY: 'secret-test-key' }, async (_url, init) => {
    requestHeaders = init?.headers;
    requestBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 201 });
  });
  assert.deepEqual(result, { sent: true });
  assert.equal((requestHeaders as Record<string, string>)['api-key'], 'secret-test-key');
  assert.deepEqual(requestBody?.sender, { email: 'midoradesign@gmail.com', name: 'Midora' });
  assert.equal(JSON.stringify(requestBody).includes('secret-test-key'), false);
});

test('missing Brevo API key leaves notification retryable without contacting Brevo', async () => {
  let called = false;
  const result = await sendOrderEmail('midoradesign@gmail.com', renderOrderNotification(order), {}, async () => { called = true; return new Response(null); });
  assert.deepEqual(result, { sent: false, errorCode: 'BREVO_NOT_CONFIGURED' });
  assert.equal(called, false);
});
