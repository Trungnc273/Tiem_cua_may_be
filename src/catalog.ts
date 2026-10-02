import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { productMediaStorage } from './product-media-storage.js';
import { catalogQuerySchema } from './validation.js';
import { z } from 'zod';
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140);
const mode = process.env.CATALOG_MODE ?? 'production';
if (!['production', 'test'].includes(mode)) throw new Error('CATALOG_MODE must be production or test');
const provenanceClause = mode === 'test' ? "p.provenance IN ('PRODUCTION', 'TEST')" : "p.provenance = 'PRODUCTION'";
const saleSql = '(floor((COALESCE(v.price_override_vnd, p.base_price_vnd)::numeric * (100-p.discount_percent) + 50) / 100)::int)';
const orderBy = { newest: 'p.created_at DESC, p.id', price_asc: `min(${saleSql}) ASC, p.id`, price_desc: `min(${saleSql}) DESC, p.id`, name: 'p.name ASC, p.id' };
const searchEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/public/categories', async (_request, reply) => {
    const result = await pool.query(`SELECT slug, name, description, CASE WHEN icon_key IN ('dress','shirt','pants','skirt','accessory') THEN icon_key ELSE 'generic' END AS "iconKey", image_url AS "imageUrl" FROM categories WHERE is_active = true AND ${mode === 'test' ? "provenance IN ('PRODUCTION','TEST')" : "provenance = 'PRODUCTION'"} ORDER BY sort_order ASC, name ASC, slug ASC`);
    return reply.send({ data: result.rows });
  });

  const listProducts = async (request: { query: unknown; params?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }) => {
    const parsed = catalogQuerySchema.safeParse(request.query);
    const routeCategory = (request.params as { slug?: string } | undefined)?.slug;
    if (!parsed.success || (routeCategory && !slugSchema.safeParse(routeCategory).success)) return reply.code(400).send({ error: { code: 'INVALID_QUERY', message: 'Yêu cầu tìm kiếm chưa hợp lệ.' } });
    const query = parsed.data;
    const clauses = [`p.status = 'ACTIVE'`, provenanceClause, `c.is_active = true AND c.provenance ${mode === 'test' ? "IN ('PRODUCTION','TEST')" : "= 'PRODUCTION'"}`, 'EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true)'];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
    const category = routeCategory ?? query.category;
    if (category) add('c.slug = ?', category);
    if (query.newOnly === 'true') clauses.push('p.is_new = true');
    if (query.q) {
      const term = `%${searchEscape(query.q)}%`;
      values.push(term, term, term);
      const first = values.length - 2;
      clauses.push(`(p.name ILIKE $${first} ESCAPE '\\' OR c.name ILIKE $${first + 1} ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.is_active = true AND sv.sku ILIKE $${first + 2} ESCAPE '\\'))`);
    }
    const where = clauses.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where}`, values);
    const offset = (query.page - 1) * query.limit;
    const dataValues = [...values, query.limit, offset];
    const data = await pool.query(`
      SELECT p.slug, p.name, p.description, p.base_price_vnd AS "basePriceVnd", p.discount_percent AS "discountPercent", p.is_featured AS "isFeatured", p.is_new AS "isNew",
        c.slug AS "categorySlug", c.name AS "categoryName",
        COALESCE(min(COALESCE(v.price_override_vnd, p.base_price_vnd)), p.base_price_vnd)::int AS "originalPriceVnd",
        COALESCE(min(${saleSql}), p.base_price_vnd)::int AS "salePriceVnd",
        COALESCE(min(${saleSql}), p.base_price_vnd)::int AS "priceVnd",
        (COALESCE(min(${saleSql}), p.base_price_vnd) < COALESCE(min(COALESCE(v.price_override_vnd, p.base_price_vnd)), p.base_price_vnd)) AS "hasDiscount",
        COALESCE((SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.id LIMIT 1), '') AS image,
        (SELECT i.storage_key FROM product_images i WHERE i.product_id=p.id ORDER BY i.is_primary DESC,i.sort_order ASC,i.id LIMIT 1) AS "imageStorageKey",
        (SELECT array_agg(DISTINCT COALESCE(vv.color_hex, vv.display_color)) FILTER (WHERE COALESCE(vv.color_hex, vv.display_color) IS NOT NULL) FROM product_variants vv WHERE vv.product_id = p.id AND vv.is_active = true) AS colors
      FROM products p JOIN categories c ON c.id = p.category_id JOIN product_variants v ON v.product_id = p.id AND v.is_active = true
      WHERE ${where} GROUP BY p.id, c.id ORDER BY ${orderBy[query.sort]} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, dataValues);
    return reply.send({ data: data.rows.map((row) => { const { imageStorageKey, ...publicRow } = row; return { ...publicRow, image: imageStorageKey ? productMediaStorage.publicUrl(String(imageStorageKey)) : row.image }; }), pagination: { page: query.page, limit: query.limit, total: count.rows[0]?.total ?? 0, pages: Math.ceil((count.rows[0]?.total ?? 0) / query.limit) } });
  };
  app.get('/api/v1/public/products', listProducts);
  app.get('/api/v1/public/categories/:slug/products', listProducts);

  app.get<{ Params: { slug: string } }>('/api/v1/public/products/:slug', async (request, reply) => {
    const slug = slugSchema.safeParse(request.params.slug);
    if (!slug.success) return reply.code(400).send({ error: { code: 'INVALID_SLUG', message: 'Sản phẩm không hợp lệ.' } });
    const categoryMode = mode === 'test' ? "c.provenance IN ('PRODUCTION','TEST')" : "c.provenance = 'PRODUCTION'";
    const found = await pool.query(`SELECT p.id, p.slug, p.name, p.description, p.base_price_vnd AS "basePriceVnd",p.discount_percent AS "discountPercent", p.is_featured AS "isFeatured", p.is_new AS "isNew", c.slug AS "categorySlug", c.name AS "categoryName" FROM products p JOIN categories c ON c.id = p.category_id WHERE p.slug=$1 AND p.status='ACTIVE' AND ${provenanceClause} AND c.is_active=true AND ${categoryMode} AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.is_active=true)`, [slug.data]);
    const product = found.rows[0];
    if (!product) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy sản phẩm.' } });
    const [variants, images] = await Promise.all([
      pool.query(`SELECT id AS "variantId",size, color_code AS "colorCode", color_name AS "colorName", display_color AS "displayColor", color_hex AS "colorHex", COALESCE(price_override_vnd, $2::integer)::int AS "originalPriceVnd", floor((COALESCE(price_override_vnd,$2::integer)::numeric * (100-$3) + 50)/100)::int AS "salePriceVnd", $3::integer AS "discountPercent", (floor((COALESCE(price_override_vnd,$2::integer)::numeric * (100-$3) + 50)/100) < COALESCE(price_override_vnd, $2::integer)) AS "hasDiscount", COALESCE(price_override_vnd, $2::integer)::int AS "priceVnd", stock_quantity AS "stockQuantity", CASE WHEN stock_quantity > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END AS availability FROM product_variants WHERE product_id=$1 AND is_active=true ORDER BY size, color_code, id`, [product.id, product.basePriceVnd, product.discountPercent]),
      pool.query(`SELECT i.url, i.storage_key AS "storageKey", i.alt_text AS "altText", i.sort_order AS "sortOrder", i.is_primary AS "isPrimary", i.variant_id AS "variantId" FROM product_images i WHERE i.product_id=$1 AND (i.variant_id IS NULL OR EXISTS(SELECT 1 FROM product_variants v WHERE v.id=i.variant_id AND v.is_active)) ORDER BY i.is_primary DESC, i.sort_order ASC, i.id`, [product.id]),
    ]);
    delete product.id;
    return reply.send({ data: { ...product, variants: variants.rows, images: images.rows.map((image) => { const { storageKey, ...publicImage } = image; return { ...publicImage, url: storageKey ? productMediaStorage.publicUrl(String(storageKey)) : image.url }; }) } });
  });
}

