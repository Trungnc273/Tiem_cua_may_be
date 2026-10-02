import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.PRODUCT_ADMIN_TEST_API_URL ?? 'http://127.0.0.1:4003';
const origin = process.env.PRODUCT_ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:3100';
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const email = `batch4-${randomBytes(5).toString('hex')}@example.invalid`;
const password = randomBytes(24).toString('base64url');
const skip = databaseUrl ? undefined : { skip: 'Set TEST_DATABASE_URL to the isolated Tiệm Của Mây PostgreSQL test database.' };
let server: ChildProcess | undefined;
let cookie = '';
let uploadsDir = '';
// API payload shape varies by route; individual assertions narrow the fields in each step.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = { status: number; body: any; cookie: string };

async function api(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}): Promise<Result> {
  const headers: Record<string, string> = { Origin: options.origin ?? origin };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  return { status: response.status, body: response.status === 204 ? {} : await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}

before(async () => {
  if (!databaseUrl) return;
  uploadsDir = await mkdtemp(join(tmpdir(), 'tcm-batch4-media-'));
  const salt = randomBytes(16).toString('hex'); const hash = scryptSync(password, salt, 64).toString('hex');
  await pool!.query("INSERT INTO admin_users(provenance,email,password_salt,password_hash) VALUES('TEST',$1,$2,$3)", [email, salt, hash]);
  await pool!.query("UPDATE store_settings SET default_shipping_fee_vnd=25000 WHERE provenance='TEST'");
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', CATALOG_MODE: 'test', PORT: new URL(baseUrl).port, HOST: '127.0.0.1', CORS_ORIGINS: origin, PRODUCT_UPLOAD_DIR: uploadsDir } });
  for (let i=0;i<70;i++) { try { if ((await fetch(`${baseUrl}/ready`)).ok) break; } catch { /* server starting */ } await delay(100); if (i===69) throw new Error('Product admin API did not become ready'); }
  const login = await api('/api/v1/admin/auth/login', { method: 'POST', body: { email, password } }); assert.equal(login.status, 200); cookie = login.cookie; assert.match(cookie, /^tcm_admin=/);
});
after(async () => { await pool?.end(); server?.kill(); });

test('B4 catalog journey: draft, images, variant stock, immutable order image snapshot and safe deletion', skip, async () => {
  const unauth = await api('/api/v1/admin/catalog/products'); assert.equal(unauth.status, 401);
  const category = await api('/api/v1/admin/catalog/categories', { method: 'POST', cookie, body: { name: 'QA batch 4', slug: `qa-b4-${randomBytes(4).toString('hex')}`, iconKey: 'accessory', sortOrder: 70 } });
  assert.equal(category.status, 201); const categoryId = category.body.data.id as string;
  const created = await api('/api/v1/admin/catalog/products', { method: 'POST', cookie, body: { name: 'Áo thử quản trị Batch 4', categoryId, basePriceVnd: 100000, discountPercent: 0 } });
  assert.equal(created.status, 201); assert.equal(created.body.data.status, 'DRAFT'); const product = created.body.data;
  const madeVariant = await api(`/api/v1/admin/catalog/products/${product.id}/variants`, { method: 'POST', cookie, body: { sku: `B4-${randomBytes(4).toString('hex')}`, size: 'XXL/Custom', colorCode: 'CLOUD_BLUE', colorName: 'Xanh mây', displayColor: 'Mây', colorHex: '#A9D6F5', priceOverrideVnd: null, stockQuantity: 2 } });
  assert.equal(madeVariant.status, 201); const variant = madeVariant.body.data;
  const filtered = await api(`/api/v1/admin/catalog/products?q=${variant.sku}&categoryId=${categoryId}&status=DRAFT&page=1&limit=5`, { cookie }); assert.equal(filtered.status, 200); assert.equal(filtered.body.pagination.total, 1); assert.equal(filtered.body.data[0].totalStock, 2);

  const png = await readFile(join(process.cwd(), '..', 'TIEM_CUA_MAY_FE', 'public', 'demo', 'product-blouse-clean.png'));
  const jpeg = await readFile(join(process.cwd(), '..', 'TIEM_CUA_MAY_FE', 'public', 'brand', 'logo.jpg'));
  const makeImage = (bytes: Buffer, altText: string, variantId: string | null = null, isPrimary = false) => ({ dataBase64: bytes.toString('base64'), altText, variantId, isPrimary });
  const uploaded = await api(`/api/v1/admin/catalog/products/${product.id}/images`, { method: 'POST', cookie, body: makeImage(png, 'Ảnh PNG', null, true) });
  assert.equal(uploaded.status, 201); const image = uploaded.body.data;
  const jpegUpload = await api(`/api/v1/admin/catalog/products/${product.id}/images`, { method: 'POST', cookie, body: makeImage(jpeg, 'Ảnh JPEG') }); assert.equal(jpegUpload.status, 201);
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA', 'base64');
  const webpUpload = await api(`/api/v1/admin/catalog/products/${product.id}/images`, { method: 'POST', cookie, body: makeImage(webp, 'Ảnh WebP', variant.id) });
  assert.equal(webpUpload.status, 201);
  const unauthUpload = await api(`/api/v1/admin/catalog/products/${product.id}/images`, { method: 'POST', body: makeImage(png, 'Unauthenticated') }); assert.equal(unauthUpload.status, 401);
  const mediaUrl = `http://127.0.0.1:${new URL(baseUrl).port}${image.url}`;
  const media = await fetch(mediaUrl); assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/png'); assert.equal(media.headers.get('x-content-type-options'), 'nosniff'); assert.match(media.headers.get('cache-control') ?? '', /immutable/);
  assert.equal((await fetch(`http://127.0.0.1:${new URL(baseUrl).port}${jpegUpload.body.data.url}`)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`http://127.0.0.1:${new URL(baseUrl).port}${webpUpload.body.data.url}`)).headers.get('content-type'), 'image/webp');
  const svg = await api(`/api/v1/admin/catalog/products/${product.id}/images`, { method: 'POST', cookie, body: makeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'bad svg') }); assert.equal(svg.status, 400);
  const huge = await api(`/api/v1/admin/catalog/products/${product.id}/images`, { method: 'POST', cookie, body: makeImage(Buffer.alloc(8 * 1024 * 1024 + 1), 'too large') }); assert.equal(huge.status, 400, JSON.stringify(huge.body)); assert.equal(huge.body.error.code, 'IMAGE_TOO_LARGE');
  const traversal = await fetch(`${baseUrl}/api/v1/public/media/products/%2e%2e%2f..%2fetc%2fpasswd`); assert.notEqual(traversal.status, 200);

  const published = await api(`/api/v1/admin/catalog/products/${product.id}/status`, { method: 'PATCH', cookie, body: { status: 'ACTIVE', updatedAt: product.updatedAt } }); assert.equal(published.status, 200);
  const publicProduct = await api(`/api/v1/public/products/${product.slug}`); assert.equal(publicProduct.status, 200); assert.equal(publicProduct.body.data.variants[0].size, 'XXL/Custom'); assert.equal(publicProduct.body.data.images.length, 3); assert.equal(publicProduct.body.data.images[0].storageKey, undefined, 'public APIs expose URLs but not object keys');
  const duplicateSku = await api(`/api/v1/admin/catalog/products/${product.id}/variants`, { method: 'POST', cookie, body: { sku: variant.sku, size: 'M', colorCode: 'RED', colorName: 'Đỏ', priceOverrideVnd: null, stockQuantity: 1 } }); assert.equal(duplicateSku.status, 409);
  const cart = await api('/api/v1/public/cart'); assert.equal(cart.status, 200); const cartCookie = cart.cookie;
  const added = await api('/api/v1/public/cart/items', { method: 'POST', cookie: cartCookie, body: { variantId: variant.id, quantity: 1 } }); assert.equal(added.status, 201);
  const key = randomUUID(); const checkout = await fetch(`${baseUrl}/api/v1/public/orders`, { method: 'POST', headers: { Origin: origin, Cookie: cartCookie, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ customerName: 'Khách QA', customerPhone: '0876146498', deliveryAddress: '12 Nguyễn Huệ, Quận 1, TP Hồ Chí Minh', note: '' }) });
  assert.equal(checkout.status, 201); const orderBody = await checkout.json() as { data: { orderCode: string } }; const orderRow = await pool!.query('SELECT id FROM orders WHERE order_code=$1', [orderBody.data.orderCode]); const orderId = orderRow.rows[0].id as string;
  const stockAfterOrder = await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1', [variant.id]); assert.equal(Number(stockAfterOrder.rows[0].stock_quantity), 1);
  const orderSnapshot = await pool!.query('SELECT product_name,original_unit_price_vnd,discount_percent,sale_unit_price_vnd,image_url,image_storage_key FROM order_items WHERE order_id=$1', [orderId]); const snapshot = orderSnapshot.rows[0]; assert.equal(snapshot.image_url, ''); assert.equal(snapshot.image_storage_key, webpUpload.body.data.storageKey);
  const cancelled = await api(`/api/v1/admin/orders/${orderId}/status`, { method: 'PATCH', cookie, body: { status: 'CANCELLED' } }); assert.equal(cancelled.status, 200);
  const restored = await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1', [variant.id]); assert.equal(Number(restored.rows[0].stock_quantity), 2);
  const detail = await api(`/api/v1/admin/catalog/products/${product.id}`, { cookie }); const currentProduct = detail.body.data;
  const edited = await api(`/api/v1/admin/catalog/products/${product.id}`, { method: 'PATCH', cookie, body: { slug: currentProduct.slug, name: 'Tên đã sửa', description: 'Mô tả đã sửa', categoryId, basePriceVnd: 150000, discountPercent: 10, isFeatured: true, isNew: false, updatedAt: currentProduct.updatedAt } }); assert.equal(edited.status, 200);
  const stale = await api(`/api/v1/admin/catalog/products/${product.id}`, { method: 'PATCH', cookie, body: { slug: currentProduct.slug, name: 'Ghi đè cũ', description: '', categoryId, basePriceVnd: 100000, discountPercent: 0, isFeatured: false, isNew: false, updatedAt: currentProduct.updatedAt } }); assert.equal(stale.status, 409);
  const currentVariant = currentProduct.variants[0]; const variantUpdate = await api(`/api/v1/admin/catalog/products/${product.id}/variants/${variant.id}`, { method: 'PATCH', cookie, body: { sku: currentVariant.sku, size: currentVariant.size, colorCode: 'CLOUD_BLUE', colorName: 'Xanh mới', displayColor: 'Mây', colorHex: '#A9D6F5', priceOverrideVnd: null, stockQuantity: 2, isActive: true, updatedAt: currentVariant.updatedAt } }); assert.equal(variantUpdate.status, 200);
  const removed = await api(`/api/v1/admin/catalog/products/${product.id}/images/${webpUpload.body.data.id}`, { method: 'DELETE', cookie }); assert.equal(removed.status, 204);
  const orderDetail = await api(`/api/v1/admin/orders/${orderId}`, { cookie }); const orderImageUrl = orderDetail.body.data.items[0].imageUrl as string;
  const retainedMedia = await fetch(orderImageUrl.startsWith('http') ? orderImageUrl : `http://127.0.0.1:${new URL(baseUrl).port}${orderImageUrl}`); assert.equal(retainedMedia.status, 200, 'order snapshot media remains available after product image removal');
  const preservedOrder = await pool!.query('SELECT product_name,original_unit_price_vnd,discount_percent,sale_unit_price_vnd,image_url,image_storage_key FROM order_items WHERE order_id=$1', [orderId]); assert.deepEqual(preservedOrder.rows[0], snapshot);
  const auditEvents = await pool!.query("SELECT event_type FROM audit_events WHERE entity_id IN ($1,$2,$3) ORDER BY created_at", [product.id, variant.id, webpUpload.body.data.id]); const names = auditEvents.rows.map((row) => row.event_type); assert.ok(names.includes('PRODUCT_CREATED')); assert.ok(names.includes('PRODUCT_PRICE_CHANGED')); assert.ok(names.includes('PRODUCT_DISCOUNT_CHANGED')); assert.ok(names.includes('PRODUCT_STOCK_CHANGED')); assert.ok(names.includes('PRODUCT_IMAGE_ADDED')); assert.ok(names.includes('PRODUCT_IMAGE_REMOVED'));
  const categoryState = await api(`/api/v1/admin/catalog/categories/${categoryId}`, { method: 'PATCH', cookie, body: { slug: category.body.data.slug, name: category.body.data.name, description: '', iconKey: 'accessory', sortOrder: 70, isActive: false, updatedAt: category.body.data.updatedAt } }); assert.equal(categoryState.status, 200);
  const hidden = await api(`/api/v1/public/products/${product.slug}`); assert.equal(hidden.status, 404);
});
