import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const testUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.TEST_API_URL ?? 'http://127.0.0.1:4000';
const { Pool } = pg;
const pool = testUrl ? new Pool({ connectionString: testUrl }) : null;
let productionProcess: ChildProcess | undefined;
type ProductList = { data: Array<{ slug: string; name: string; categorySlug: string; priceVnd: number }>; pagination: { total: number; page: number; limit: number; pages: number } };
type CategoryList = { data: Array<{ slug: string }> };
type ProductDetail = { data: { variants: Array<{ size: string; priceVnd: number; availability: string }>; images: unknown[] } };
const fetchJson = async <T = unknown>(path: string, url = baseUrl) => {
  const response = await fetch(`${url}${path}`);
  return { status: response.status, body: await response.json() as T };
};
const skipOptions = testUrl ? undefined : { skip: 'Set TEST_DATABASE_URL to an isolated Tiệm Của Mây PostgreSQL test database.' };

before(async () => {
  if (!testUrl) return;
  productionProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test', CATALOG_MODE: 'production', PORT: '4001' },
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch('http://127.0.0.1:4001/ready')).ok) return; } catch { /* service is starting */ }
    await delay(100);
  }
  throw new Error('Production-mode API did not start');
});
after(async () => { await pool?.end(); productionProcess?.kill(); });

test('A: active categories are listed and inactive categories are hidden', skipOptions, async () => {
  const result = await fetchJson<CategoryList>('/api/v1/public/categories');
  assert.equal(result.status, 200);
  assert.ok(result.body.data.some((row) => row.slug === 'vay-dam'));
  await pool!.query("INSERT INTO categories(slug,name,sort_order,is_active,provenance) VALUES('test-hidden-category','Hidden',99,false,'TEST') ON CONFLICT(slug) DO UPDATE SET is_active=false,provenance='TEST'");
  assert.equal((await fetchJson<CategoryList>('/api/v1/public/categories')).body.data.some((row) => row.slug === 'test-hidden-category'), false);
});
test('B: active product list returns only active products with active variants', skipOptions, async () => {
  const result = await fetchJson<ProductList>('/api/v1/public/products');
  assert.equal(result.status, 200); assert.equal(result.body.pagination.total, 6);
  assert.ok(result.body.data.every((row) => !row.name.includes('hidden')));
});
test('C/D/E: product detail returns active variants and effective integer VND prices', skipOptions, async () => {
  const result = await fetchJson<ProductDetail>('/api/v1/public/products/ao-blouse-no-tay');
  assert.equal(result.status, 200); assert.equal(result.body.data.variants.length, 4);
  assert.equal(result.body.data.variants.find((row) => row.size === 'S')?.priceVnd, 259000);
  assert.equal(result.body.data.variants.find((row) => row.size === 'S')?.availability, 'OUT_OF_STOCK');
  assert.equal(result.body.data.variants.find((row) => row.size === 'XL')?.priceVnd, 269000);
  assert.equal(result.body.data.images.length, 2);
});
test('F: PostgreSQL rejects negative stock', skipOptions, async () => {
  await assert.rejects(pool!.query("UPDATE product_variants SET stock_quantity=-1 WHERE sku='TCM-TEST-1-S'"), { code: '23514' });
});
test('G/H: PostgreSQL rejects duplicate SKU and product slug', skipOptions, async () => {
  await assert.rejects(pool!.query("INSERT INTO product_variants(product_id,sku,size,color_code,color_name,stock_quantity) SELECT product_id,sku,'FREE SIZE','X','X',0 FROM product_variants LIMIT 1"), { code: '23505' });
  await assert.rejects(pool!.query("INSERT INTO products(slug,name,category_id,provenance,base_price_vnd) SELECT slug,name,category_id,'TEST',0 FROM products LIMIT 1"), { code: '23505' });
});
test('I/J: search covers name and SKU, category filtering returns matching items', skipOptions, async () => {
  const search = await fetchJson<ProductList>('/api/v1/public/products?q=TCM-TEST-1-M');
  assert.equal(search.body.pagination.total, 1); assert.equal(search.body.data[0].slug, 'ao-blouse-no-tay');
  assert.equal((await fetchJson<ProductList>('/api/v1/public/products?q=Cardigan')).body.data[0]?.slug, 'ao-khoac-cardigan-basic');
  assert.ok((await fetchJson<ProductList>('/api/v1/public/products?q=Váy')).body.pagination.total > 0);
  const category = await fetchJson<ProductList>('/api/v1/public/products?category=chan-vay');
  assert.ok(category.body.data.length > 0); assert.ok(category.body.data.every((row) => row.categorySlug === 'chan-vay'));
  assert.equal((await fetchJson<ProductList>('/api/v1/public/categories/chan-vay/products')).body.data[0]?.categorySlug, 'chan-vay');
});
test('K/L: price sorting works and pagination is bounded', skipOptions, async () => {
  const result = await fetchJson<ProductList>('/api/v1/public/products?sort=price_asc&limit=2&page=1');
  assert.equal(result.body.data.length, 2); assert.ok(result.body.data[0].priceVnd <= result.body.data[1].priceVnd);
  const nextPage = await fetchJson<ProductList>('/api/v1/public/products?sort=price_asc&limit=2&page=2');
  assert.equal(nextPage.body.pagination.page, 2); assert.notEqual(nextPage.body.data[0].slug, result.body.data[0].slug);
  assert.equal((await fetchJson('/api/v1/public/products?limit=51')).status, 400);
});
test('M: inactive products are hidden', skipOptions, async () => {
  await pool!.query("UPDATE products SET status='INACTIVE' WHERE slug='kep-toc-ngoc-trai'");
  try { assert.equal((await fetchJson('/api/v1/public/products/kep-toc-ngoc-trai')).status, 404); }
  finally { await pool!.query("UPDATE products SET status='ACTIVE' WHERE slug='kep-toc-ngoc-trai'"); }
});
test('N: product with no active variants is hidden', skipOptions, async () => {
  await pool!.query("UPDATE product_variants SET is_active=false WHERE product_id=(SELECT id FROM products WHERE slug='kep-toc-ngoc-trai')");
  try { assert.equal((await fetchJson('/api/v1/public/products/kep-toc-ngoc-trai')).status, 404); }
  finally { await pool!.query("UPDATE product_variants SET is_active=true WHERE product_id=(SELECT id FROM products WHERE slug='kep-toc-ngoc-trai')"); }
});
test('O: production mode excludes TEST-only catalog data', skipOptions, async () => {
  const result = await fetchJson<ProductList>('/api/v1/public/products', 'http://127.0.0.1:4001');
  assert.equal(result.body.pagination.total, 0);
  const categories = await fetchJson<CategoryList>('/api/v1/public/categories', 'http://127.0.0.1:4001');
  assert.equal(categories.body.data.length, 0);
  const variant = (await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-1-M'")).rows[0].id as string;
  const cart = await fetch('http://127.0.0.1:4001/api/v1/public/cart');
  const cookie = cart.headers.get('set-cookie')?.split(';')[0] ?? '';
  const attempt = await fetch('http://127.0.0.1:4001/api/v1/public/cart/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ variantId: variant, quantity: 1 }) });
  assert.equal(attempt.status, 404);
  const order = await fetch('http://127.0.0.1:4001/api/v1/public/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': '6b7ed87a-7ed2-408b-9662-ccbfdf39b163' }, body: JSON.stringify({ customerName: 'QA', customerPhone: '0901234567', deliveryAddress: 'Test Address 123' }) });
  assert.equal(order.status, 409);
  assert.equal(((await order.json()) as { error: { code: string } }).error.code, 'SHIPPING_NOT_CONFIGURED');
});
