import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { registerProductAdminRoutes } from './product-admin.js';
import { z } from 'zod';
import { pool } from './db.js';

export const mode = process.env.CATALOG_MODE ?? 'production';
export const provenance = mode === 'test' ? 'TEST' : 'PRODUCTION';
const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((v) => v.trim()).filter(Boolean);
const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const salePrice = (original: number, discount: number) => Math.floor((original * (100 - discount) + 50) / 100);
const cartCookie = 'tcm_cart';
const adminCookie = 'tcm_admin';
const cookieValue = (request: FastifyRequest, name: string) => request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const setCookie = (reply: FastifyReply, name: string, value: string, age: number) => reply.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookie}`);
const clearCookie = (reply: FastifyReply, name: string) => reply.header('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`);
const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store');
const invalid = (reply: FastifyReply, code: string, message: string, status = 400) => reply.code(status).send({ error: { code, message } });
const phoneSchema = z.string().trim().min(8).max(24).transform((raw, ctx) => {
  if (!/^[+0-9 .-]+$/.test(raw)) { ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number.' }); return z.NEVER; }
  const compact = raw.replace(/[ .-]/g, '');
  const normalized = compact.startsWith('+84') ? `0${compact.slice(3)}` : compact;
  if (!/^0\d{9,10}$/.test(normalized)) { ctx.addIssue({ code: 'custom', message: 'Enter a valid Vietnam phone number.' }); return z.NEVER; }
  return normalized;
});
const uuid = z.string().uuid();
const loginFailures = new Map<string, { count: number; expires: number }>();

type DbRow = Record<string, unknown>;
async function ensureCart(request: FastifyRequest, reply: FastifyReply) {
  let token = cookieValue(request, cartCookie);
  if (token && /^[A-Za-z0-9_-]{40,80}$/.test(token)) {
    const found = await pool.query('SELECT id FROM cart_sessions WHERE token_hash=$1 AND provenance=$2 AND expires_at>now()', [sha(token), provenance]);
    if (found.rows[0]) return String(found.rows[0].id);
  }
  token = randomBytes(32).toString('base64url');
  const created = await pool.query(`INSERT INTO cart_sessions(token_hash, provenance, expires_at) VALUES($1,$2,now()+interval '30 days') RETURNING id`, [sha(token), provenance]);
  setCookie(reply, cartCookie, token, 60 * 60 * 24 * 30);
  return String(created.rows[0].id);
}
export async function audit(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, actorId: string, event: string, entity: string, id: string | null, metadata: Record<string, unknown> = {}) {
  await client.query('INSERT INTO audit_events(provenance,actor_admin_id,event_type,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [provenance, actorId, event, entity, id, JSON.stringify(metadata)]);
}
export async function adminId(request: FastifyRequest) {
  const token = cookieValue(request, adminCookie);
  if (!token || !/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  const result = await pool.query(`SELECT u.id FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true AND u.provenance=$2`, [sha(token), provenance]);
  return result.rows[0]?.id as string | undefined ?? null;
}
async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply);
  const id = await adminId(request);
  if (!id) { invalid(reply, 'ADMIN_AUTH_REQUIRED', 'Please sign in to continue.', 401); return null; }
  return id;
}
export async function transactional<T>(work: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function registerCommerceRoutes(app: FastifyInstance): Promise<void> {
  const enforceOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) return invalid(reply, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.', 403);
  };
  await registerProductAdminRoutes(app);
  app.get('/api/v1/public/store-settings', async (_request, reply) => {
    const result = await pool.query('SELECT contact_phone AS "contactPhone", messenger_url AS "messengerUrl", default_shipping_fee_vnd AS "shippingFeeVnd" FROM store_settings WHERE provenance=$1', [provenance]);
    const row = result.rows[0] ?? { contactPhone: '0876146498', messengerUrl: 'https://www.facebook.com/tiemcuamay04', shippingFeeVnd: null };
    return reply.send({ data: { contactPhone: row.contactPhone, messengerUrl: row.messengerUrl, shippingConfigured: row.shippingFeeVnd !== null } });
  });
  app.get('/api/v1/public/cart/count', async (request, reply) => {
    const token = cookieValue(request, cartCookie);
    if (!token || !/^[A-Za-z0-9_-]{40,80}$/.test(token)) return reply.send({ data: { count: 0 } });
    const session = await pool.query('SELECT id FROM cart_sessions WHERE token_hash=$1 AND provenance=$2 AND expires_at>now()', [sha(token), provenance]);
    if (!session.rows[0]) return reply.send({ data: { count: 0 } });
    const result = await pool.query('SELECT COALESCE(sum(quantity),0)::int AS count FROM cart_items WHERE cart_session_id=$1', [session.rows[0].id]);
    return reply.send({ data: { count: Number(result.rows[0].count) } });
  });
  app.get('/api/v1/public/cart', async (request, reply) => {
    noStore(reply);
    const session = await ensureCart(request, reply);
    const [settings, items] = await Promise.all([
      pool.query('SELECT default_shipping_fee_vnd AS fee FROM store_settings WHERE provenance=$1', [provenance]),
      pool.query(`SELECT ci.id AS "itemId",v.id AS "variantId",p.slug,p.name AS "productName",v.sku,v.size,v.color_name AS "colorName",v.stock_quantity AS stock,(v.is_active AND p.status='ACTIVE') AS available,ci.quantity,COALESCE(v.price_override_vnd,p.base_price_vnd) AS "originalPriceVnd",p.discount_percent AS "discountPercent",COALESCE((SELECT i.url FROM product_images i WHERE i.product_id=p.id AND (i.variant_id IS NULL OR i.variant_id=v.id) ORDER BY (i.variant_id=v.id) DESC NULLS LAST,i.is_primary DESC,i.sort_order,i.id LIMIT 1),'') AS "imageUrl" FROM cart_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE ci.cart_session_id=$1 ORDER BY ci.created_at,ci.id`, [session]),
    ]);
    const rows = items.rows.map((item: DbRow) => ({ ...item, originalPriceVnd: Number(item.originalPriceVnd), discountPercent: Number(item.discountPercent), salePriceVnd: salePrice(Number(item.originalPriceVnd), Number(item.discountPercent)), hasDiscount: salePrice(Number(item.originalPriceVnd), Number(item.discountPercent)) < Number(item.originalPriceVnd), lineTotalVnd: salePrice(Number(item.originalPriceVnd), Number(item.discountPercent)) * Number(item.quantity), stock: Number(item.stock) }));
    const subtotalVnd = rows.reduce((total: number, item: DbRow) => total + Number(item.lineTotalVnd), 0);
    const fee = settings.rows[0]?.fee;
    return reply.send({ data: { items: rows, subtotalVnd, shippingFeeVnd: fee === null || fee === undefined ? null : Number(fee), shippingConfigured: fee !== null && fee !== undefined, totalVnd: fee === null || fee === undefined ? null : subtotalVnd + Number(fee) } });
  });
  app.post('/api/v1/public/cart/items', { preHandler: enforceOrigin }, async (request, reply) => {
    noStore(reply);
    const parsed = z.object({ variantId: uuid, quantity: z.number().int().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_CART_ITEM', 'Choose a valid variant and quantity.');
    const session = await ensureCart(request, reply);
    const result = await transactional(async (client) => {
      const found = await client.query(`SELECT v.id,v.stock_quantity,v.is_active,p.status,p.provenance FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1 FOR UPDATE OF v`, [parsed.data.variantId]);
      const variant = found.rows[0];
      if (!variant || !variant.is_active || variant.status !== 'ACTIVE' || (mode === 'production' && variant.provenance !== 'PRODUCTION')) return 'UNAVAILABLE';
      if (parsed.data.quantity > Number(variant.stock_quantity)) return 'OUT_OF_STOCK';
      const existing = await client.query('SELECT id,quantity FROM cart_items WHERE cart_session_id=$1 AND variant_id=$2 FOR UPDATE', [session, parsed.data.variantId]);
      const quantity = parsed.data.quantity + Number(existing.rows[0]?.quantity ?? 0);
      if (quantity > Number(variant.stock_quantity) || quantity > 100) return 'OUT_OF_STOCK';
      await client.query(`INSERT INTO cart_items(cart_session_id,variant_id,quantity) VALUES($1,$2,$3) ON CONFLICT(cart_session_id,variant_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()`, [session, parsed.data.variantId, quantity]);
      return 'OK';
    });
    if (result === 'UNAVAILABLE') return invalid(reply, 'VARIANT_UNAVAILABLE', 'This variant is unavailable.', 404);
    if (result === 'OUT_OF_STOCK') return invalid(reply, 'INSUFFICIENT_STOCK', 'The selected quantity is not available.', 409);
    return reply.code(201).send({ data: { added: true } });
  });
  app.patch<{ Params: { itemId: string } }>('/api/v1/public/cart/items/:itemId', { preHandler: enforceOrigin }, async (request, reply) => {
    noStore(reply);
    if (!uuid.safeParse(request.params.itemId).success) return invalid(reply, 'INVALID_CART_ITEM', 'Cart item not found.', 404);
    const parsed = z.object({ quantity: z.number().int().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_QUANTITY', 'Quantity must be a positive whole number.');
    const session = await ensureCart(request, reply);
    const changed = await transactional(async (client) => {
      const found = await client.query("SELECT ci.id,ci.variant_id,v.stock_quantity,v.is_active,p.status,p.provenance FROM cart_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE ci.id=$1 AND ci.cart_session_id=$2 FOR UPDATE OF v,ci", [request.params.itemId, session]);
      if (!found.rows[0]) return 'MISSING';
      if (!found.rows[0].is_active || found.rows[0].status !== 'ACTIVE' || (mode === 'production' && found.rows[0].provenance !== 'PRODUCTION')) return 'UNAVAILABLE';
      if (parsed.data.quantity > Number(found.rows[0].stock_quantity)) return 'STOCK';
      await client.query('UPDATE cart_items SET quantity=$1,updated_at=now() WHERE id=$2', [parsed.data.quantity, request.params.itemId]); return 'OK';
    });
    if (changed === 'MISSING') return invalid(reply, 'CART_ITEM_NOT_FOUND', 'Cart item not found.', 404);
    if (changed === 'UNAVAILABLE') return invalid(reply, 'VARIANT_UNAVAILABLE', 'This product is no longer available.', 409);
    if (changed === 'STOCK') return invalid(reply, 'INSUFFICIENT_STOCK', 'The selected quantity is not available.', 409);
    return reply.send({ data: { updated: true } });
  });
  app.delete<{ Params: { itemId: string } }>('/api/v1/public/cart/items/:itemId', { preHandler: enforceOrigin }, async (request, reply) => {
    noStore(reply);
    if (!uuid.safeParse(request.params.itemId).success) return invalid(reply, 'INVALID_CART_ITEM', 'Cart item not found.', 404);
    const session = await ensureCart(request, reply);
    await pool.query('DELETE FROM cart_items WHERE id=$1 AND cart_session_id=$2', [request.params.itemId, session]);
    return reply.code(204).send();
  });
  app.post('/api/v1/public/orders', { preHandler: enforceOrigin }, async (request, reply) => {
    noStore(reply);
    const key = uuid.safeParse(request.headers['idempotency-key']);
    if (!key.success) return invalid(reply, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid request key is required.');
    const parsed = z.object({ customerName: z.string().trim().min(1).max(120), customerPhone: phoneSchema, deliveryAddress: z.string().trim().min(5).max(500), note: z.string().max(1000).optional().default('') }).safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_ORDER', 'Check the name, phone number, address, and note.');
    const sessionId = await ensureCart(request, reply);
    const requestHash = sha(JSON.stringify(parsed.data));
    try {
      const result = await transactional(async (client) => {
        await client.query('SELECT id FROM cart_sessions WHERE id=$1 FOR UPDATE', [sessionId]);
        const dupe = await client.query('SELECT id,order_code,request_hash FROM orders WHERE cart_session_id=$1 AND idempotency_key=$2', [sessionId, key.data]);
        if (dupe.rows[0]) return dupe.rows[0].request_hash === requestHash ? { existing: true, code: dupe.rows[0].order_code } : { error: 'IDEMPOTENCY_CONFLICT' };
        const settings = await client.query('SELECT default_shipping_fee_vnd AS fee FROM store_settings WHERE provenance=$1 FOR UPDATE', [provenance]);
        if (settings.rows[0]?.fee === null || settings.rows[0]?.fee === undefined) return { error: 'SHIPPING_NOT_CONFIGURED' };
        const items = await client.query(`SELECT ci.variant_id,ci.quantity,v.product_id,v.sku,v.size,v.color_name,v.stock_quantity,v.is_active,p.status,p.provenance,p.name,p.discount_percent,COALESCE(v.price_override_vnd,p.base_price_vnd)::int AS original_price,COALESCE((SELECT i.url FROM product_images i WHERE i.product_id=p.id AND (i.variant_id IS NULL OR i.variant_id=v.id) ORDER BY (i.variant_id=v.id) DESC NULLS LAST,i.is_primary DESC,i.sort_order,i.id LIMIT 1),'') AS image_url FROM cart_items ci JOIN product_variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE ci.cart_session_id=$1 ORDER BY ci.variant_id FOR UPDATE OF v,p`, [sessionId]);
        if (!items.rows.length) return { error: 'CART_EMPTY' };
        if (items.rows.some((item: DbRow) => !item.is_active || item.status !== 'ACTIVE' || (mode === 'production' && item.provenance !== 'PRODUCTION'))) return { error: 'VARIANT_UNAVAILABLE' };
        for (const item of items.rows) if (Number(item.quantity) > Number(item.stock_quantity)) return { error: 'INSUFFICIENT_STOCK' };
        const enriched: DbRow[] = items.rows.map((item: DbRow) => ({ ...item, original: Number(item.original_price), discount: Number(item.discount_percent), sale: salePrice(Number(item.original_price), Number(item.discount_percent)), quantity: Number(item.quantity) }));
        const subtotal = enriched.reduce((sum: number, item: DbRow) => sum + Number(item.sale) * Number(item.quantity), 0);
        const fee = Number(settings.rows[0].fee);
        const code = `TCM-${randomBytes(5).toString('hex').toUpperCase()}`;
        const created = await client.query(`INSERT INTO orders(order_code,provenance,cart_session_id,idempotency_key,request_hash,customer_name,customer_phone,delivery_address,customer_note,subtotal_vnd,shipping_fee_vnd,total_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [code, provenance, sessionId, key.data, requestHash, parsed.data.customerName, parsed.data.customerPhone, parsed.data.deliveryAddress, parsed.data.note, subtotal, fee, subtotal + fee]);
        const orderId = created.rows[0].id as string;
        for (const item of enriched) {
          const updated = await client.query('UPDATE product_variants SET stock_quantity=stock_quantity-$1,updated_at=now() WHERE id=$2 AND stock_quantity >= $1 RETURNING id', [item.quantity, item.variant_id]);
          if (!updated.rowCount) throw new Error('STOCK_RACE');
          await client.query(`INSERT INTO order_items(order_id,product_id,variant_id,product_name,variant_sku,color_name,size,image_url,original_unit_price_vnd,discount_percent,sale_unit_price_vnd,quantity,line_total_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [orderId, item.product_id, item.variant_id, item.name, item.sku, item.color_name, item.size, item.image_url, item.original, item.discount, item.sale, item.quantity, Number(item.sale) * Number(item.quantity)]);
        }
        await client.query('DELETE FROM cart_items WHERE cart_session_id=$1', [sessionId]);
        return { existing: false, code, status: 'NEW' };
      });
      if (result.error) return invalid(reply, result.error, result.error === 'SHIPPING_NOT_CONFIGURED' ? 'The store has not configured its shipping fee yet.' : result.error === 'CART_EMPTY' ? 'Your cart is empty.' : 'The requested quantity is no longer available.', result.error === 'SHIPPING_NOT_CONFIGURED' ? 409 : result.error === 'CART_EMPTY' ? 400 : 409);
      return reply.code(result.existing ? 200 : 201).send({ data: { orderCode: result.code, status: result.existing ? 'NEW' : 'NEW' } });
    } catch (error) { if ((error as Error).message === 'STOCK_RACE') return invalid(reply, 'INSUFFICIENT_STOCK', 'The requested quantity is no longer available.', 409); throw error; }
  });

  app.post('/api/v1/admin/auth/login', { preHandler: enforceOrigin }, async (request, reply) => {
    noStore(reply);
    const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    const attemptKey = sha(`${request.ip}:${parsed.data.email.toLowerCase()}`);
    const attempt = loginFailures.get(attemptKey);
    if (attempt && attempt.expires > Date.now() && attempt.count >= 10) return invalid(reply, 'LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Try again later.', 429);
    const found = await pool.query('SELECT id,password_salt,password_hash FROM admin_users WHERE provenance=$1 AND lower(email)=lower($2) AND is_active=true', [provenance, parsed.data.email]);
    const admin = found.rows[0];
    const salt = admin?.password_salt ?? '00000000000000000000000000000000';
    const hash = scryptSync(parsed.data.password, salt, 64).toString('hex');
    const good = admin && timingSafeEqual(Buffer.from(hash), Buffer.from(admin.password_hash));
    if (!good) {
      const previous = loginFailures.get(attemptKey);
      loginFailures.set(attemptKey, { count: previous && previous.expires > Date.now() ? previous.count + 1 : 1, expires: Date.now() + 15 * 60_000 });
      return invalid(reply, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    }
    loginFailures.delete(attemptKey);
    const token = randomBytes(32).toString('base64url');
    await transactional(async (client) => { await client.query('INSERT INTO admin_sessions(token_hash,admin_user_id,expires_at) VALUES($1,$2,now()+interval \'12 hours\')', [sha(token), admin.id]); await audit(client, admin.id, 'ADMIN_LOGIN_SUCCEEDED', 'ADMIN', admin.id); });
    setCookie(reply, adminCookie, token, 60 * 60 * 12);
    return reply.send({ data: { authenticated: true } });
  });
  app.post('/api/v1/admin/auth/logout', { preHandler: enforceOrigin }, async (request, reply) => {
    noStore(reply); const actor = await adminId(request); const token = cookieValue(request, adminCookie);
    if (actor && token) await transactional(async (client) => { await client.query('DELETE FROM admin_sessions WHERE token_hash=$1', [sha(token)]); await audit(client, actor, 'ADMIN_LOGOUT', 'ADMIN', actor); });
    clearCookie(reply, adminCookie); return reply.code(204).send();
  });
  app.get('/api/v1/admin/auth/me', async (request, reply) => { noStore(reply); const actor = await adminId(request); if (!actor) return invalid(reply, 'ADMIN_AUTH_REQUIRED', 'Please sign in.', 401); return { data: { authenticated: true } }; });
  app.get('/api/v1/admin/orders', async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    const query = z.object({ status: z.enum(['NEW','CONFIRMED','SHIPPING','COMPLETED','CANCELLED']).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(request.query);
    if (!query.success) return invalid(reply, 'INVALID_QUERY', 'Invalid order filters.');
    const values: unknown[] = [provenance]; let statusClause = '';
    if (query.data.status) { values.push(query.data.status); statusClause = `AND status=$${values.length}`; }
    const offset = (query.data.page - 1) * query.data.limit;
    const [count, rows] = await Promise.all([pool.query(`SELECT count(*)::int total FROM orders WHERE provenance=$1 ${statusClause}`, values), pool.query(`SELECT id,order_code AS "orderCode",customer_name AS "customerName",right(customer_phone,4) AS "phoneLast4",status,subtotal_vnd AS "subtotalVnd",shipping_fee_vnd AS "shippingFeeVnd",total_vnd AS "totalVnd",created_at AS "createdAt" FROM orders WHERE provenance=$1 ${statusClause} ORDER BY created_at DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values, query.data.limit, offset])]);
    return reply.send({ data: rows.rows, pagination: { page: query.data.page, limit: query.data.limit, total: count.rows[0].total } });
  });
  app.get<{ Params: { orderId: string } }>('/api/v1/admin/orders/:orderId', async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    if (!uuid.safeParse(request.params.orderId).success) return invalid(reply, 'NOT_FOUND', 'Order not found.', 404);
    const [order, items] = await Promise.all([pool.query(`SELECT id,order_code AS "orderCode",customer_name AS "customerName",customer_phone AS "customerPhone",delivery_address AS "deliveryAddress",customer_note AS note,status,subtotal_vnd AS "subtotalVnd",shipping_fee_vnd AS "shippingFeeVnd",total_vnd AS "totalVnd",created_at AS "createdAt" FROM orders WHERE id=$1 AND provenance=$2`, [request.params.orderId, provenance]), pool.query(`SELECT product_name AS "productName",variant_sku AS sku,color_name AS "colorName",size,image_url AS "imageUrl",original_unit_price_vnd AS "originalPriceVnd",discount_percent AS "discountPercent",sale_unit_price_vnd AS "salePriceVnd",quantity,line_total_vnd AS "lineTotalVnd" FROM order_items WHERE order_id=$1 ORDER BY id`, [request.params.orderId])]);
    if (!order.rows[0]) return invalid(reply, 'NOT_FOUND', 'Order not found.', 404);
    return reply.send({ data: { ...order.rows[0], items: items.rows } });
  });
  app.patch<{ Params: { orderId: string } }>('/api/v1/admin/orders/:orderId/status', { preHandler: enforceOrigin }, async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    const parsed = z.object({ status: z.enum(['CONFIRMED','SHIPPING','COMPLETED','CANCELLED']) }).safeParse(request.body);
    if (!parsed.success || !uuid.safeParse(request.params.orderId).success) return invalid(reply, 'INVALID_STATUS', 'Invalid status update.');
    const result = await transactional(async (client) => {
      const found = await client.query('SELECT id,status FROM orders WHERE id=$1 AND provenance=$2 FOR UPDATE', [request.params.orderId, provenance]);
      const order = found.rows[0]; if (!order) return 'MISSING';
      const transitions: Record<string, string[]> = { NEW: ['CONFIRMED','CANCELLED'], CONFIRMED: ['SHIPPING','CANCELLED'], SHIPPING: ['COMPLETED'], COMPLETED: [], CANCELLED: [] };
      const target = parsed.data.status;
      if (!transitions[order.status]?.includes(target)) return 'TRANSITION';
      if (target === 'CANCELLED') {
        const items = await client.query('SELECT variant_id,quantity FROM order_items WHERE order_id=$1 FOR UPDATE', [order.id]);
        for (const item of items.rows) await client.query('UPDATE product_variants SET stock_quantity=stock_quantity+$1,updated_at=now() WHERE id=$2', [item.quantity, item.variant_id]);
      }
      await client.query('UPDATE orders SET status=$1,updated_at=now() WHERE id=$2', [target, order.id]);
      await audit(client, actor, 'ORDER_STATUS_CHANGED', 'ORDER', order.id, { from: order.status, to: target }); return 'OK';
    });
    if (result === 'MISSING') return invalid(reply, 'NOT_FOUND', 'Order not found.', 404);
    if (result === 'TRANSITION') return invalid(reply, 'INVALID_TRANSITION', 'This order cannot move to that status.', 409);
    return reply.send({ data: { status: parsed.data.status } });
  });
  app.get('/api/v1/admin/products', async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    const rows = await pool.query(`SELECT p.id,p.slug,p.name,p.base_price_vnd AS "basePriceVnd",p.discount_percent AS "discountPercent",p.status='ACTIVE' AS "isActive" FROM products p WHERE p.provenance=$1 ORDER BY p.name,p.id`, [provenance]);
    return reply.send({ data: rows.rows });
  });
  app.patch<{ Params: { productId: string } }>('/api/v1/admin/products/:productId', { preHandler: enforceOrigin }, async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    const parsed = z.object({ basePriceVnd: z.number().int().min(0).max(2000000000), discountPercent: z.number().int().min(0).max(100), isActive: z.boolean() }).safeParse(request.body);
    if (!parsed.success || !uuid.safeParse(request.params.productId).success) return invalid(reply, 'INVALID_PRODUCT', 'Invalid product values.');
    const result = await transactional(async (client) => {
      const found = await client.query('SELECT id,base_price_vnd,discount_percent,status FROM products WHERE id=$1 AND provenance=$2 FOR UPDATE', [request.params.productId, provenance]);
      const item = found.rows[0]; if (!item) return 'MISSING';
      const status = parsed.data.isActive ? 'ACTIVE' : 'INACTIVE';
      await client.query('UPDATE products SET base_price_vnd=$1,discount_percent=$2,status=$3,updated_at=now() WHERE id=$4', [parsed.data.basePriceVnd, parsed.data.discountPercent, status, item.id]);
      if (Number(item.base_price_vnd) !== parsed.data.basePriceVnd) await audit(client, actor, 'PRODUCT_PRICE_CHANGED', 'PRODUCT', item.id, { fromVnd: Number(item.base_price_vnd), toVnd: parsed.data.basePriceVnd });
      if (Number(item.discount_percent) !== parsed.data.discountPercent) await audit(client, actor, 'PRODUCT_DISCOUNT_CHANGED', 'PRODUCT', item.id, { fromPercent: Number(item.discount_percent), toPercent: parsed.data.discountPercent });
      return 'OK';
    });
    if (result === 'MISSING') return invalid(reply, 'NOT_FOUND', 'Product not found.', 404);
    return reply.send({ data: parsed.data });
  });
  app.get('/api/v1/admin/settings', async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    const found = await pool.query('SELECT contact_phone AS "contactPhone",messenger_url AS "messengerUrl",default_shipping_fee_vnd AS "defaultShippingFeeVnd" FROM store_settings WHERE provenance=$1', [provenance]);
    return reply.send({ data: found.rows[0] });
  });
  app.patch('/api/v1/admin/settings', { preHandler: enforceOrigin }, async (request, reply) => {
    const actor = await requireAdmin(request, reply); if (!actor) return;
    const parsed = z.object({ contactPhone: phoneSchema, messengerUrl: z.string().url().max(300).refine((v) => /^https:\/\/(www\.)?facebook\.com\//.test(v)), defaultShippingFeeVnd: z.number().int().min(0).max(2000000).nullable() }).safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_SETTINGS', 'Check the phone, Messenger link, and shipping fee.');
    const old = await pool.query('SELECT contact_phone,messenger_url,default_shipping_fee_vnd FROM store_settings WHERE provenance=$1', [provenance]);
    const next = parsed.data;
    await transactional(async (client) => {
      await client.query('UPDATE store_settings SET contact_phone=$1,messenger_url=$2,default_shipping_fee_vnd=$3,updated_at=now() WHERE provenance=$4', [next.contactPhone,next.messengerUrl,next.defaultShippingFeeVnd,provenance]);
      const before = old.rows[0];
      if (before.contact_phone !== next.contactPhone || before.messenger_url !== next.messengerUrl || before.default_shipping_fee_vnd !== next.defaultShippingFeeVnd) await audit(client, actor, 'STORE_SETTINGS_CHANGED', 'SETTINGS', null, { phoneChanged: before.contact_phone !== next.contactPhone, messengerChanged: before.messenger_url !== next.messengerUrl, shippingChanged: before.default_shipping_fee_vnd !== next.defaultShippingFeeVnd });
    });
    return reply.send({ data: { ...next } });
  });
}

export function hashAdminPassword(password: string, salt = randomBytes(16).toString('hex')) {
  if (password.length < 12 || password.length > 256) throw new Error('Admin password must contain 12 to 256 characters.');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
