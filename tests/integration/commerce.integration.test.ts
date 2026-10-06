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
const startupDiagnostics: string[] = [];
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; PostgreSQL integration tests must not be skipped.');
const testDatabase = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]', 'database'].includes(testDatabase.hostname) || !/(?:^|[_-])(?:test|stage|staging)(?:$|[_-])/i.test(testDatabase.pathname)) throw new Error('Refusing integration tests unless TEST_DATABASE_URL targets a local database explicitly named TEST/staging.');
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
async function submit(cookie: string, key: string, overrides: Record<string,unknown> = {}) { return api<{data:{orderCode:string;status:string;subtotalVnd:number;shippingEstimateMinVnd:number|null;shippingEstimateMaxVnd:number|null}}>(
  '/api/v1/public/orders',{method:'POST',cookie,key,body:{customerName:'Khách QA',customerPhone:'0876146498',provinceCode:'79',provinceLabel:'Thành phố Hồ Chí Minh',deliveryAddress:'12 Nguyễn Huệ, Quận 1, TP Hồ Chí Minh',note:'Giao giờ hành chính',...overrides}}); }

before(async () => {
  if (!databaseUrl) return;
  const salt = randomBytes(16).toString('hex'); const hash = scryptSync(adminPassword,salt,64).toString('hex');
  await pool!.query('INSERT INTO admin_users(provenance,email,password_salt,password_hash) VALUES(\'TEST\',$1,$2,$3)',[adminEmail,salt,hash]);
  await pool!.query("UPDATE store_settings SET order_notifications_enabled=false WHERE provenance='TEST'");
  server = spawn(process.execPath,['--import','tsx','src/server.ts'],{cwd:process.cwd(),stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:databaseUrl,BREVO_API_KEY:'',NODE_ENV:'test',CATALOG_MODE:'test',PORT:new URL(baseUrl).port,HOST:'127.0.0.1',CORS_ORIGINS:origin}});
  server.stderr?.on('data',(chunk:Buffer)=>startupDiagnostics.push(chunk.toString('utf8').replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi,'$1[REDACTED]@')));
  for(let i=0;i<150;i++){try{if((await fetch(`${baseUrl}/ready`)).ok)break}catch{} await delay(100);if(i===149)throw new Error(`Commerce test API did not become ready; exit=${server.exitCode??'running'}; startup=${startupDiagnostics.join('').slice(-2000)}`);}
  const login=await api('/api/v1/admin/auth/login',{method:'POST',body:{email:adminEmail,password:adminPassword}});assert.equal(login.status,200);adminCookie=login.cookie;assert.match(adminCookie,/^tcm_admin=/);
});
after(async()=>{await pool?.end();server?.kill();});

test('A-D: discounts are server projected and integer VND prices are deterministic',async()=>{
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

test('E-H: cart is cookie backed, quantity and stock are validated, and guests cannot read orders',async()=>{
  const variant=(await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-1-M'")).rows[0].id as string;
  const count=await api<{data:{count:number}}>('/api/v1/public/cart/count');assert.equal(count.body.data.count,0);assert.equal(count.cookie,'');
  const cookie=await newCart();assert.equal((await add(cookie,variant,2)).status,201);
  const cart=await api<{data:{items:{quantity:number;originalPriceVnd:number;salePriceVnd:number}[];subtotalVnd:number}}>(`/api/v1/public/cart`,{cookie});
  assert.equal(cart.body.data.items.length,1);assert.equal(cart.body.data.items[0].quantity,2);assert.equal(cart.body.data.subtotalVnd,518000);
  assert.equal((await add(cookie,variant,4)).status,409);
  assert.equal((await api('/api/v1/public/cart/items',{method:'POST',cookie,origin:'https://malicious.example',body:{variantId:variant,quantity:1}})).status,403);
  const itemId=(await pool!.query('SELECT id FROM cart_items WHERE variant_id=$1',( [variant] )).catch(()=>({rows:[]}))).rows[0]?.id;
  assert.ok(itemId);
  assert.equal((await api(`/api/v1/public/cart/items/${itemId}`,{method:'PATCH',cookie,body:{quantity:0}})).status,400);
  const key=randomUUID();
  assert.equal((await api(`/api/v1/public/orders/${randomBytes(16).toString('hex')}`)).status,404);
  assert.equal((await submit(cookie,key,{customerPhone:'not a phone'})).status,400);
});

test('I-N: order snapshots prices and estimated shipping, retries are idempotent, and cancellation restores stock',async()=>{
  const variant=(await pool!.query("SELECT id,stock_quantity FROM product_variants WHERE sku='TCM-TEST-2-M'")).rows[0];
  const product=(await pool!.query("SELECT id FROM products WHERE slug='chan-vay-tang-bong-benh'")).rows[0];
  const cart=await newCart();assert.equal((await add(cart,variant.id,2)).status,201);
  const idempotency=randomUUID();
  const first=await submit(cart,idempotency);assert.equal(first.status,201);assert.match(first.body.data.orderCode,/^TCM-[A-F0-9]{10}$/);
  const repeated=await submit(cart,idempotency);assert.equal(repeated.status,200);assert.equal(repeated.body.data.orderCode,first.body.data.orderCode);
  assert.equal((await submit(cart,idempotency,{note:'different payload'})).status,409);
  const row=(await pool!.query('SELECT id,subtotal_vnd,shipping_fee_vnd,total_vnd,status,shipping_estimate_min_vnd,shipping_estimate_max_vnd FROM orders WHERE order_code=$1',[first.body.data.orderCode])).rows[0];
  assert.equal(Number(row.subtotal_vnd),478000);assert.equal(row.shipping_fee_vnd,null);assert.equal(row.total_vnd,null);assert.ok(row.shipping_estimate_min_vnd !== null);assert.ok(row.shipping_estimate_max_vnd !== null);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[variant.id])).rows[0].stock_quantity),3);
  await pool!.query("UPDATE products SET base_price_vnd=999999,discount_percent=45 WHERE id=$1",[product.id]);
  await pool!.query("UPDATE shipping_estimate_rules SET estimate_min_vnd=99000,estimate_max_vnd=120000 WHERE provenance='TEST' AND is_fallback=true");
  assert.equal(Number((await pool!.query('SELECT subtotal_vnd FROM orders WHERE id=$1',[row.id])).rows[0].subtotal_vnd),478000);
  const historical=(await pool!.query('SELECT shipping_estimate_min_vnd,shipping_estimate_max_vnd FROM orders WHERE id=$1',[row.id])).rows[0];assert.equal(Number(historical.shipping_estimate_min_vnd),Number(row.shipping_estimate_min_vnd));assert.equal(Number(historical.shipping_estimate_max_vnd),Number(row.shipping_estimate_max_vnd));
  await assert.rejects(pool!.query('UPDATE order_items SET sale_unit_price_vnd=1 WHERE order_id=$1',[row.id]),{message:/Order item snapshots are immutable/});
  await assert.rejects(pool!.query('UPDATE orders SET province_code=\'01\' WHERE id=$1',[row.id]),{message:/Order snapshots are immutable/});
  assert.equal((await api(`/api/v1/admin/orders/${row.id}`,{cookie:adminCookie})).status,200);
  assert.equal((await api(`/api/v1/admin/orders/${row.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CANCELLED'}})).status,200);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[variant.id])).rows[0].stock_quantity),5);
  assert.equal((await api(`/api/v1/admin/orders/${row.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,409);
  await pool!.query("UPDATE products SET base_price_vnd=239000,discount_percent=0 WHERE id=$1",[product.id]);
  await pool!.query("UPDATE shipping_estimate_rules SET estimate_min_vnd=25000,estimate_max_vnd=40000 WHERE provenance='TEST' AND is_fallback=true");
});

test('O-R: transactions protect last stock, lifecycle actions and audit records',async()=>{
  const variant=(await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-3-L'")).rows[0].id as string;
  await pool!.query('UPDATE product_variants SET stock_quantity=1 WHERE id=$1',[variant]);
  const a=await newCart(),b=await newCart();assert.equal((await add(a,variant,1)).status,201);assert.equal((await add(b,variant,1)).status,201);
  const outcomes=await Promise.all([submit(a,randomUUID()),submit(b,randomUUID())]);
  assert.deepEqual(outcomes.map(o=>o.status).sort(),[201,409]);
  assert.equal(Number((await pool!.query('SELECT stock_quantity FROM product_variants WHERE id=$1',[variant])).rows[0].stock_quantity),0);
  const success=outcomes.find(o=>o.status===201)!;const order=(await pool!.query('SELECT id FROM orders WHERE order_code=$1',[success.body.data.orderCode])).rows[0];
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,409);
  const shipping=await api(`/api/v1/admin/orders/${order.id}/shipping`,{method:'PATCH',cookie:adminCookie,body:{carrierCode:'OTHER',carrierCustomName:'QA Carrier',shippingFinalVnd:25000,trackingNumber:'QA-TRACK-01'}});assert.equal(shipping.status,200);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,200);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'SHIPPING'}})).status,200);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CANCELLED'}})).status,409);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'COMPLETED'}})).status,200);
  const events=await pool!.query("SELECT count(*)::int n FROM audit_events WHERE event_type='ORDER_STATUS_CHANGED' AND entity_id=$1",[order.id]);assert.equal(events.rows[0].n,3);
  await pool!.query('UPDATE product_variants SET stock_quantity=5 WHERE id=$1',[variant]);
});

test('S-V: admin auth, origin checks, settings, price changes, and protected PII',async()=>{
  const wrongOrigin=await api('/api/v1/admin/settings',{method:'PATCH',cookie:adminCookie,origin:'https://malicious.example',body:{}});assert.equal(wrongOrigin.status,403);
  const unauthorized=await api('/api/v1/admin/orders');assert.equal(unauthorized.status,401);
  const products=await api<{data:{id:string;slug:string;basePriceVnd:number;discountPercent:number}[]}>('/api/v1/admin/products',{cookie:adminCookie});assert.equal(products.status,200);
  const product=products.body.data.find(row=>row.slug==='ao-blouse-no-tay')!;
  assert.equal((await api(`/api/v1/admin/products/${product.id}`,{method:'PATCH',cookie:adminCookie,body:{basePriceVnd:300000,discountPercent:25,isActive:true}})).status,200);
  const settings=await api('/api/v1/admin/settings',{cookie:adminCookie});assert.equal(settings.status,200);
  const contact=await api<{data:{contactPhone:string;messengerUrl:string}}>('/api/v1/public/store-settings');assert.equal(contact.body.data.contactPhone,'0876146498');
  const logout=await api('/api/v1/admin/auth/logout',{method:'POST',cookie:adminCookie});assert.equal(logout.status,204);
  assert.equal((await api('/api/v1/admin/orders',{cookie:adminCookie})).status,401);
  assert.ok(await pool!.query("SELECT id FROM admin_users WHERE email=$1",[adminEmail]));
});

test('Batch 6 A-M: provincial estimates, fallback, snapshots, manual carrier confirmation, and server total',async()=>{
  const relogin=await api('/api/v1/admin/auth/login',{method:'POST',body:{email:adminEmail,password:adminPassword}});assert.equal(relogin.status,200);adminCookie=relogin.cookie;
  await pool!.query("UPDATE store_settings SET order_notifications_enabled=false,order_notification_to='midoradesign@gmail.com' WHERE provenance='TEST'");
  await pool!.query("UPDATE shipping_estimate_rules SET is_active=false,updated_at=now() WHERE provenance='TEST' AND is_active");
  const fallback=await api<{data:{id:string}}>('/api/v1/admin/shipping-estimates',{method:'POST',cookie:adminCookie,body:{provinceCode:null,displayName:'Tỉnh/thành khác',estimateMinVnd:25000,estimateMaxVnd:40000,isFallback:true}});assert.equal(fallback.status,201);
  const specific=await api<{data:{id:string}}>('/api/v1/admin/shipping-estimates',{method:'POST',cookie:adminCookie,body:{provinceCode:'79',displayName:'Thành phố Hồ Chí Minh',estimateMinVnd:30000,estimateMaxVnd:45000,isFallback:false}});assert.equal(specific.status,201);
  assert.equal((await api('/api/v1/admin/shipping-estimates',{method:'POST',cookie:adminCookie,body:{provinceCode:'79',displayName:'Trùng tỉnh',estimateMinVnd:1,estimateMaxVnd:2,isFallback:false}})).status,409);
  assert.equal((await api('/api/v1/admin/shipping-estimates',{method:'POST',cookie:adminCookie,body:{provinceCode:'01',displayName:'Sai khoảng',estimateMinVnd:45000,estimateMaxVnd:30000,isFallback:false}})).status,400);
  assert.equal((await api('/api/v1/admin/shipping-estimates',{method:'POST',cookie:adminCookie,body:{provinceCode:'01',displayName:'Phí âm',estimateMinVnd:-1,estimateMaxVnd:30000,isFallback:false}})).status,400);
  const specificEstimate=await api<{data:{estimate:{minVnd:number;maxVnd:number;isFallback:boolean}}}>('/api/v1/public/shipping/estimate?provinceCode=79');
  assert.deepEqual(specificEstimate.body.data.estimate,{minVnd:30000,maxVnd:45000,ruleId:specific.body.data.id,label:'Thành phố Hồ Chí Minh',isFallback:false});
  const fallbackEstimate=await api<{data:{estimate:{minVnd:number;maxVnd:number;isFallback:boolean}}}>('/api/v1/public/shipping/estimate?provinceCode=01');
  assert.equal(fallbackEstimate.body.data.estimate?.minVnd,25000);assert.equal(fallbackEstimate.body.data.estimate?.maxVnd,40000);assert.equal(fallbackEstimate.body.data.estimate?.isFallback,true);

  const variant=(await pool!.query("SELECT id FROM product_variants WHERE sku='TCM-TEST-1-M'")).rows[0].id as string;
  const noEstimateCookie=await newCart();assert.equal((await add(noEstimateCookie,variant,1)).status,201);
  assert.equal((await api(`/api/v1/admin/shipping-estimates/${fallback.body.data.id}`,{method:'PATCH',cookie:adminCookie,body:{isActive:false}})).status,200);
  assert.equal((await api(`/api/v1/admin/shipping-estimates/${specific.body.data.id}`,{method:'PATCH',cookie:adminCookie,body:{isActive:false}})).status,200);
  const noEstimate=await submit(noEstimateCookie,randomUUID(),{provinceCode:'79',provinceLabel:'Thành phố Hồ Chí Minh',shippingFinalVnd:999999,totalVnd:1,carrierCode:'GHTK'});assert.equal(noEstimate.status,201);
  const noEstimateRow=(await pool!.query('SELECT id,shipping_fee_vnd,total_vnd,shipping_estimate_min_vnd FROM orders WHERE order_code=$1',[noEstimate.body.data.orderCode])).rows[0];
  assert.equal(noEstimateRow.shipping_fee_vnd,null);assert.equal(noEstimateRow.total_vnd,null);assert.equal(noEstimateRow.shipping_estimate_min_vnd,null);
  assert.equal((await api(`/api/v1/admin/orders/${noEstimateRow.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,409);
  assert.equal((await api(`/api/v1/admin/orders/${noEstimateRow.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CANCELLED'}})).status,200);
  assert.equal((await api(`/api/v1/admin/shipping-estimates/${fallback.body.data.id}`,{method:'PATCH',cookie:adminCookie,body:{isActive:true}})).status,200);
  assert.equal((await api(`/api/v1/admin/shipping-estimates/${specific.body.data.id}`,{method:'PATCH',cookie:adminCookie,body:{isActive:true}})).status,200);

  await pool!.query("UPDATE store_settings SET order_notifications_enabled=true WHERE provenance='TEST'");
  const cookie=await newCart();assert.equal((await add(cookie,variant,1)).status,201);
  const placed=await submit(cookie,randomUUID(),{shippingFinalVnd:999999,totalVnd:1,shippingFeeVnd:0,carrierCode:'GHTK'});assert.equal(placed.status,201);
  assert.equal(placed.body.data.shippingEstimateMinVnd,30000);assert.equal(placed.body.data.shippingEstimateMaxVnd,45000);
  const order=(await pool!.query('SELECT id,subtotal_vnd,shipping_fee_vnd,total_vnd,shipping_status,province_code,province_label,shipping_estimate_rule_id,shipping_estimate_rule_snapshot,shipping_estimate_min_vnd,shipping_estimate_max_vnd FROM orders WHERE order_code=$1',[placed.body.data.orderCode])).rows[0];
  assert.equal(order.shipping_fee_vnd,null);assert.equal(order.total_vnd,null);assert.equal(order.shipping_status,'ESTIMATED');assert.equal(order.province_code,'79');assert.equal(order.province_label,'Thành phố Hồ Chí Minh');assert.equal(order.shipping_estimate_rule_id,specific.body.data.id);assert.equal(order.shipping_estimate_rule_snapshot,'Thành phố Hồ Chí Minh');assert.equal(Number(order.shipping_estimate_min_vnd),30000);assert.equal(Number(order.shipping_estimate_max_vnd),45000);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,409);
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/shipping`,{method:'PATCH',cookie:adminCookie,body:{carrierCode:'J_AND_T',shippingFinalVnd:-1,trackingNumber:'TCK-1'}})).status,400);
  const confirmedShipping=await api<{data:{shippingStatus:string;shippingFinalVnd:number;finalTotalVnd:number}}>('/api/v1/admin/orders/'+order.id+'/shipping',{method:'PATCH',cookie:adminCookie,body:{carrierCode:'J_AND_T',shippingFinalVnd:31750,trackingNumber:'TCK-1'}});
  assert.equal(confirmedShipping.status,200);assert.deepEqual(confirmedShipping.body.data,{shippingStatus:'CONFIRMED',shippingFinalVnd:31750,finalTotalVnd:Number(order.subtotal_vnd)+31750});
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CONFIRMED'}})).status,200);
  await api(`/api/v1/admin/shipping-estimates/${specific.body.data.id}`,{method:'PATCH',cookie:adminCookie,body:{estimateMinVnd:50000,estimateMaxVnd:70000}});
  const historical=(await pool!.query('SELECT shipping_estimate_min_vnd,shipping_estimate_max_vnd,shipping_fee_vnd,total_vnd,carrier_code,tracking_number FROM orders WHERE id=$1',[order.id])).rows[0];
  assert.equal(Number(historical.shipping_estimate_min_vnd),30000);assert.equal(Number(historical.shipping_estimate_max_vnd),45000);assert.equal(Number(historical.shipping_fee_vnd),31750);assert.equal(Number(historical.total_vnd),Number(order.subtotal_vnd)+31750);assert.equal(historical.carrier_code,'J_AND_T');assert.equal(historical.tracking_number,'TCK-1');
  const outbox=(await pool!.query('SELECT status,recipient FROM order_notifications WHERE order_id=$1',[order.id])).rows[0];assert.ok(outbox,'order commit creates a separate email outbox record');assert.equal(outbox.recipient,'midoradesign@gmail.com');
  assert.ok((await pool!.query('SELECT id FROM orders WHERE id=$1',[order.id])).rows[0],'Brevo configuration failure cannot roll back the committed order');
  assert.equal((await api(`/api/v1/admin/orders/${order.id}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'CANCELLED'}})).status,200);
  await pool!.query("UPDATE store_settings SET order_notifications_enabled=false WHERE provenance='TEST'");
});
