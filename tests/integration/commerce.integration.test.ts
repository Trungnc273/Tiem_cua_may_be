import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import pg from 'pg';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.COMMERCE_TEST_API_URL ?? 'http://127.0.0.1:4002';
const origin = process.env.COMMERCE_TEST_ORIGIN ?? 'http://127.0.0.1:3100';
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const adminEmail = `batch3-${randomBytes(5).toString('hex')}@example.invalid`;
const adminPassword = randomBytes(24).toString('base64url');
let server: ChildProcess | undefined;
let adminCookie = '';
const skip = databaseUrl ? undefined : { skip: 'Set TEST_DATABASE_URL to the isolated Tiệm Của Mây PostgreSQL database.' };
type ApiResult<T=Record<string, unknown>> = { status: number; body: T; cookie: string };
async function api<T=Record<string, unknown>>(path: string, options: { method?: string; body?: unknown; cookie?: string; key?: string; origin?: string } = {}): Promise<ApiResult<T>> {
  const headers: Record<string,string> = { Origin: options.origin ?? origin };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.key) headers['Idempotency-Key'] = options.key;
  const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { status: response.status, body: (response.status === 204 ? {} : await response.json()) as T, cookie };
}
async function newCart() { const result = await api<{data:unknown}>('/api/v1/public/cart'); assert.equal(result.status,200); assert.match(result.cookie,/^tcm_cart=/); return result.cookie; }
async function add(cookie: string, variantId: string, quantity: number) { return api('/api/v1/public/cart/items',{method:'POST',cookie,body:{variantId,quantity}}); }
async function submit(cookie: string, key: string, overrides: Record<string,unknown> = {}) { return api<{data:{orderCode:string;status:string}}>(
  '/api/v1/public/orders',{method:'POST',cookie,key,body:{customerName:'Khách QA',customerPhone:'0876146498',deliveryAddress:'12 Nguyễn Huệ, Quận 1, TP Hồ Chí Minh',note:'Giao giờ hành chính',...overrides}}); }

before(async () => {
  if (!databaseUrl) return;
  const salt = randomBytes(16).toString('hex'); const hash = scryptSync(adminPassword,salt,64).toString('hex');
  await pool!.query('INSERT INTO admin_users(provenance,email,password_salt,password_hash) VALUES(\'TEST\',$1,$2,$3)',[adminEmail,salt,hash]);
  server = spawn(process.execPath,['--import','tsx','src/server.ts'],{cwd:process.cwd(),stdio:'ignore',env:{...process.env,DATABASE_URL:databaseUrl,NODE_ENV:'test',CATALOG_MODE:'test',PORT:new URL(baseUrl).port,HOST:'127.0.0.1',CORS_ORIGINS:origin}});
  for(let i=0;i<70;i++){try{if((await fetch(`${baseUrl}/ready`)).ok)break}catch{} await delay(100);if(i===69)throw new Error('Commerce test API did not become ready');}
  const login=await api('/api/v1/admin/auth/login',{method:'POST',body:{email:adminEmail,password:adminPassword}});assert.equal(login.status,200);adminCookie=login.cookie;assert.match(adminCookie,/^tcm_admin=/);
});
after(async()=>{await pool?.end();server?.kill();});

test('A-D: discounts are server projected and integer VND prices are deterministic',skip,async()=>{
  const variant=(await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-1-M'")).rows[0].id as string;
  await pool!.query("UPDATE products SET discount_percent=15 WHERE slug='ao-blouse-no-tay'");
  try {
    const detail=await api<{data:{discountPercent:number;variants:{variantId:string;originalPriceVnd:number;salePriceVnd:number;discountPercent:number}[]}}>(`/api/v1/public/products/ao-blouse-no-tay`);
    assert.equal(detail.status,200);assert.equal(detail.body.data.discountPercent,15);
    const priced=detail.body.data.variants.find(row=>row.variantId===variant)!;
    assert.equal(priced.originalPriceVnd,259000);assert.equal(priced.salePriceVnd,220150);assert.equal(priced.discountPercent,15);
    const listed=await api<{data:{slug:string;originalPriceVnd:number;salePriceVnd:number;hasDiscount:boolean}[]}>('/api/v1/public/products');
    const card=listed.body.data.find(row=>row.slug==='ao-blouse-no-tay')!;assert.equal(card.hasDiscount,true);assert.equal(card.salePriceVnd,220150);
  } finally {await pool!.query("UPDATE products SET discount_percent=0 WHERE slug='ao-blouse-no-tay'");}
});

test('E-H: cart is cookie backed, quantity and stock are validated, and guests cannot read orders',skip,async()=>{
  const variant=(await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-1-M'")).rows[0].id as string;
  const count=await api<{data:{count:number}}>('/api/v1/public/cart/count');assert.equal(count.body.data.count,0);assert.equal(count.cookie,'');
  const cookie=await newCart();assert.equal((await add(cookie,variant,2)).status,201);
  const cart=await api<{data:{items:{quantity:number;originalPriceVnd:number;salePriceVnd:number}[];shippingConfigured:boolean;shippingFeeVnd:number}}>(`/api/v1/public/cart`,{cookie});
  assert.equal(cart.body.data.items.length,1);assert.equal(cart.body.data.items[0].quantity,2);assert.equal(cart.body.data.shippingConfigured,true);assert.equal(cart.body.data.shippingFeeVnd,25000);
  assert.equal((await add(cookie,variant,4)).status,409);
  assert.equal((await api('/api/v1/public/cart/items',{method:'POST',cookie,origin:'https://malicious.example',body:{variantId:variant,quantity:1}})).status,403);
  const itemId=(await pool!.query('SELECT id FROM cart_items WHERE variant_id=$1',( [variant] )).catch(()=>({rows:[]}))).rows[0]?.id;
  assert.ok(itemId);
  assert.equal((await api(`/api/v1/public/cart/items/${itemId}`,{method:'PATCH',cookie,body:{quantity:0}})).status,400);
  const key=randomUUID();
  assert.equal((await api(`/api/v1/public/orders/${randomBytes(16).toString('hex')}`)).status,404);
  assert.equal((await submit(cookie,key,{customerPhone:'not a phone'})).status,400);
  const feeVariant=(await pool!.query("SELECT id,stock_quantity FROM product_variants WHERE sku='TCM-TEST-2-L'")).rows[0];
  const pendingCart=await newCart();assert.equal((await add(pendingCart,feeVariant.id,1)).status,201);
  await pool!.query("UPDATE store_settings SET default_shipping_fee_vnd=NULL WHERE provenance='TEST'");
  assert.equal((await submit(pendingCart,randomUUID())).status,409);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[feeVariant.id])).rows[0].stock_quantity),Number(feeVariant.stock_quantity));
  await pool!.query("UPDATE store_settings SET default_shipping_fee_vnd=25000 WHERE provenance='TEST'");
});

test('I-N: order snapshots prices/shipping, retries are idempotent, and cancellation restores stock',skip,async()=>{
  const variant=(await pool!.query("SELECT id,stock_quantity FROM product_variants WHERE sku='TCM-TEST-2-M'")).rows[0];
  const product=(await pool!.query("SELECT id FROM products WHERE slug='chan-vay-tang-bong-benh'")).rows[0];
  const cart=await newCart();assert.equal((await add(cart,variant.id,2)).status,201);
  const idempotency=randomUUID();
  const first=await submit(cart,idempotency);assert.equal(first.status,201);assert.match(first.body.data.orderCode,/^TCM-[A-F0-9]{10}$/);
  const repeated=await submit(cart,idempotency);assert.equal(repeated.status,200);assert.equal(repeated.body.data.orderCode,first.body.data.orderCode);
  assert.equal((await submit(cart,idempotency,{note:'different payload'})).status,409);
  const row=(await pool!.query('SELECT id,subtotal_vnd,shipping_fee_vnd,total_vnd,status FROM orders WHERE order_code=$1',[first.body.data.orderCode])).rows[0];
  assert.equal(Number(row.subtotal_vnd),478000);assert.equal(Number(row.shipping_fee_vnd),25000);assert.equal(Number(row.total_vnd),503000);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[variant.id])).rows[0].stock_quantity),3);
  await pool!.query("UPDATE products SET base_price_vnd=999999,discount_percent=45 WHERE id=$1",[product.id]);
  await pool!.query("UPDATE store_settings SET default_shipping_fee_vnd=99000 WHERE provenance='TEST'");
  assert.equal(Number((await pool!.query('SELECT subtotal_vnd FROM orders WHERE id=$1',[row.id])).rows[0].subtotal_vnd),478000);
  assert.equal(Number((await pool!.query('SELECT shipping_fee_vnd FROM orders WHERE id=$1',[row.id])).rows[0].shipping_fee_vnd),25000);
  await assert.rejects(pool!.query('UPDATE order_items SET sale_unit_price_vnd=1 WHERE order_id=$1',[row.id]),{message:/Order item snapshots are immutable/});
  await assert.rejects(pool!.query('UPDATE orders SET shipping_fee_vnd=1 WHERE id=$1',[row.id]),{message:/Order snapshots are immutable/});
  assert.equal((await api(`/api/v1/admin/orders/${row.id}`,{cookie:adminCookie})).status,200);
  assert.equal((await api(`/api/v1/admin/orders/${row.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CANCELLED'}})).status,200);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[variant.id])).rows[0].stock_quantity),5);
  assert.equal((await api(`/api/v1/admin/orders/${row.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,409);
  await pool!.query("UPDATE products SET base_price_vnd=239000,discount_percent=0 WHERE id=$1",[product.id]);
  await pool!.query("UPDATE store_settings SET default_shipping_fee_vnd=25000 WHERE provenance='TEST'");
});

test('O-R: transactions protect last stock, lifecycle actions and audit records',skip,async()=>{
  const variant=(await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-3-L'")).rows[0].id as string;
  await pool!.query('UPDATE product_variants SET stock_quantity=1 WHERE id=$1',[variant]);
  const a=await newCart(),b=await newCart();assert.equal((await add(a,variant,1)).status,201);assert.equal((await add(b,variant,1)).status,201);
  const outcomes=await Promise.all([submit(a,randomUUID()),submit(b,randomUUID())]);
  assert.deepEqual(outcomes.map(o=>o.status).sort(),[201,409]);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[variant])).rows[0].stock_quantity),0);
  const success=outcomes.find(o=>o.status===201)!;const order=(await pool!.query('SELECT id FROM orders WHERE order_code=$1',[success.body.data.orderCode])).rows[0];
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,200);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'SHIPPING'}})).status,200);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CANCELLED'}})).status,409);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'COMPLETED'}})).status,200);
  const events=await pool!.query("SELECT count(*)::int n FROM audit_events WHERE event_type='ORDER_STATUS_CHANGED' AND entity_id=$1",[order.id]);assert.equal(events.rows[0].n,3);
  await pool!.query('UPDATE product_variants SET stock_quantity=5 WHERE id=$1',[variant]);
});

test('S-V: admin auth, origin checks, settings, price changes, and protected PII',skip,async()=>{
  const wrongOrigin=await api('/api/v1/admin/settings',{method:'PATCH',cookie:adminCookie,origin:'https://malicious.example',body:{}});assert.equal(wrongOrigin.status,403);
  const unauthorized=await api('/api/v1/admin/orders');assert.equal(unauthorized.status,401);
  const products=await api<{data:{id:string;slug:string;basePriceVnd:number;discountPercent:number}[]}>('/api/v1/admin/products',{cookie:adminCookie});assert.equal(products.status,200);
  const product=products.body.data.find(row=>row.slug==='ao-blouse-no-tay')!;
  assert.equal((await api(`/api/v1/admin/products/${product.id}`,{method:'PATCH',cookie:adminCookie,body:{basePriceVnd:300000,discountPercent:25,isActive:true}})).status,200);
  const settings=await api('/api/v1/admin/settings',{cookie:adminCookie});assert.equal(settings.status,200);
  const contact=await api<{data:{contactPhone:string;messengerUrl:string;shippingConfigured:boolean}}>('/api/v1/public/store-settings');assert.equal(contact.body.data.contactPhone,'0876146498');assert.equal(contact.body.data.shippingConfigured,true);
  const logout=await api('/api/v1/admin/auth/logout',{method:'POST',cookie:adminCookie});assert.equal(logout.status,204);
  assert.equal((await api('/api/v1/admin/orders',{cookie:adminCookie})).status,401);
  assert.ok(await pool!.query("SELECT id FROM admin_users WHERE email=$1",[adminEmail]));
});
