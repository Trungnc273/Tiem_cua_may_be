export type EmailItem = {
  productName: string; sku: string; colorName: string; size: string; quantity: number;
  originalPriceVnd: number; discountPercent: number; salePriceVnd: number; lineTotalVnd: number;
};
export type OrderEmail = {
  id: string; orderCode: string; createdAt: Date; customerName: string; customerPhone: string;
  provinceLabel: string; deliveryAddress: string; note: string; subtotalVnd: number;
  shippingEstimateMinVnd: number | null; shippingEstimateMaxVnd: number | null; items: EmailItem[];
};

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
function estimateText(order: OrderEmail) {
  if (order.shippingEstimateMinVnd === null || order.shippingEstimateMaxVnd === null) return 'Phí vận chuyển sẽ được nhân viên Tiệm Của Mây xác nhận khi liên hệ với bạn.';
  return `${money(order.shippingEstimateMinVnd)} – ${money(order.shippingEstimateMaxVnd)}`;
}

export function renderOrderNotification(order: OrderEmail, appUrl?: string) {
  const adminUrl = appUrl ? new URL(`/admin/orders/${encodeURIComponent(order.id)}`, appUrl).toString() : null;
  const itemRows = order.items.map((item) => `<tr><td>${escapeEmailHtml(item.productName)}<br><small>${escapeEmailHtml(item.sku)} · ${escapeEmailHtml(item.colorName)} · ${escapeEmailHtml(item.size)}</small></td><td>${item.quantity}</td><td>${money(item.originalPriceVnd)}${item.discountPercent ? ` (-${item.discountPercent}%)` : ''}</td><td>${money(item.salePriceVnd)}</td><td>${money(item.lineTotalVnd)}</td></tr>`).join('');
  const adminLink = adminUrl ? `<p><a href="${escapeEmailHtml(adminUrl)}">Mở đơn hàng trong trang quản trị</a></p>` : '';
  const estimatedTotals = order.shippingEstimateMinVnd === null || order.shippingEstimateMaxVnd === null ? 'Chưa có khoảng phí dự kiến' : `${money(order.subtotalVnd + order.shippingEstimateMinVnd)} – ${money(order.subtotalVnd + order.shippingEstimateMaxVnd)}`;
  const disclaimer = 'Phí vận chuyển chưa phải phí chính thức. Tiệm Của Mây sẽ liên hệ để xác nhận đơn hàng và phí vận chuyển chính thức trước khi gửi hàng.';
  const html = `<!doctype html><html lang="vi"><body><h1>Tiệm Của Mây — Có đơn hàng mới</h1><p><strong>Mã đơn:</strong> ${escapeEmailHtml(order.orderCode)}</p><p><strong>Thời gian:</strong> ${escapeEmailHtml(order.createdAt.toISOString())}</p><h2>Khách hàng</h2><p>${escapeEmailHtml(order.customerName)}<br>${escapeEmailHtml(order.customerPhone)}<br>${escapeEmailHtml(order.provinceLabel)}<br>${escapeEmailHtml(order.deliveryAddress)}</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Sản phẩm</th><th>SL</th><th>Giá gốc</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${itemRows}</tbody></table><p>Tiền hàng: ${money(order.subtotalVnd)}<br>Phí vận chuyển dự kiến: ${escapeEmailHtml(estimateText(order))}<br>Tạm tính dự kiến: ${escapeEmailHtml(estimatedTotals)}</p><p>${escapeEmailHtml(disclaimer)}</p>${order.note ? `<p><strong>Ghi chú:</strong> ${escapeEmailHtml(order.note)}</p>` : ''}${adminLink}</body></html>`;
  const textItems = order.items.map((item) => `- ${item.productName} (${item.colorName}, ${item.size}, SKU ${item.sku}) × ${item.quantity}: ${money(item.lineTotalVnd)}`).join('\n');
  const text = [
    'Tiệm Của Mây — Có đơn hàng mới', `Mã đơn: ${order.orderCode}`, `Thời gian: ${order.createdAt.toISOString()}`,
    `Khách hàng: ${order.customerName}`, `Điện thoại: ${order.customerPhone}`, `Tỉnh/thành phố: ${order.provinceLabel}`, `Địa chỉ: ${order.deliveryAddress}`,
    '', 'Sản phẩm:', textItems, '', `Tiền hàng: ${money(order.subtotalVnd)}`, `Phí vận chuyển dự kiến: ${estimateText(order)}`,
    `Tạm tính dự kiến: ${estimatedTotals}`, disclaimer, ...(order.note ? [`Ghi chú: ${order.note}`] : []), ...(adminUrl ? [`Đơn hàng: ${adminUrl}`] : []),
  ].join('\n');
  return { subject: `[Tiệm Của Mây] Có đơn hàng mới ${order.orderCode}`, html, text };
}

type DeliveryResult = { sent: true } | { sent: false; errorCode: string };
type FetchLike = typeof fetch;
export async function sendOrderEmail(to: string, payload: ReturnType<typeof renderOrderNotification>, env: NodeJS.ProcessEnv = process.env, fetcher: FetchLike = fetch): Promise<DeliveryResult> {
  if (env.NODE_ENV === 'test') {
    if (env.TCM_TEST_BREVO_MODE === 'fail') return { sent: false, errorCode: 'BREVO_TEST_FAILURE' };
    return { sent: true };
  }
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.BREVO_SENDER_EMAIL ?? 'midoradesign@gmail.com';
  if (!apiKey || !senderEmail) return { sent: false, errorCode: 'BREVO_NOT_CONFIGURED' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: controller.signal,
      headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: { email: senderEmail, name: 'Tiệm Của Mây' }, to: [{ email: to }], subject: payload.subject, htmlContent: payload.html, textContent: payload.text }),
    });
    return response.ok ? { sent: true } : { sent: false, errorCode: `BREVO_HTTP_${response.status}` };
  } catch (error) {
    return { sent: false, errorCode: error instanceof Error && error.name === 'AbortError' ? 'BREVO_TIMEOUT' : 'BREVO_NETWORK_ERROR' };
  } finally { clearTimeout(timeout); }
}
