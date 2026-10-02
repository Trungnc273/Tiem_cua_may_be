import 'dotenv/config';
import pg from 'pg';
import { assertSafeTestTarget } from './safe-test-target.js';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
assertSafeTestTarget('Test fixture seed');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const categories = [
  ['vay-dam', 'Váy đầm', 'dress'], ['ao', 'Áo', 'shirt'], ['quan', 'Quần', 'pants'], ['chan-vay', 'Chân váy', 'skirt'], ['phu-kien', 'Phụ kiện', 'accessory'],
];
const products = [
  { slug: 'ao-blouse-no-tay', name: 'Áo blouse nơ tay phồng', category: 'ao', price: 259000, image: 'product-blouse-clean.png', detailImage: null, fresh: true },
  { slug: 'chan-vay-tang-bong-benh', name: 'Chân váy tầng bồng bềnh', category: 'chan-vay', price: 239000, image: 'product-skirt-clean.png', detailImage: null, fresh: true },
  { slug: 'ao-khoac-cardigan-basic', name: 'Áo khoác cardigan basic', category: 'ao', price: 299000, image: 'product-cardigan-clean.png', detailImage: null, fresh: true },
  { slug: 'vay-hoa-nhi-hai-day', name: 'Váy hoa nhí hai dây', category: 'vay-dam', price: 269000, image: 'product-floral-dress-clean.png', detailImage: 'product-floral-dress-detail.png', fresh: true },
  { slug: 'quan-ong-rong-may', name: 'Quần ống rộng Mây', category: 'quan', price: 319000, image: 'product-blouse-clean.png', detailImage: null, fresh: false },
  { slug: 'kep-toc-ngoc-trai', name: 'Kẹp tóc ngọc trai', category: 'phu-kien', price: 89000, image: 'product-skirt-clean.png', detailImage: null, fresh: false },
];
try {
  await pool.query('BEGIN');
  await pool.query("UPDATE store_settings SET default_shipping_fee_vnd=25000,updated_at=now() WHERE provenance='TEST'");
  await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE provenance='TEST')");
  await pool.query("DELETE FROM orders WHERE provenance='TEST'");
  await pool.query("DELETE FROM cart_items WHERE cart_session_id IN (SELECT id FROM cart_sessions WHERE provenance='TEST')");
  await pool.query("DELETE FROM cart_sessions WHERE provenance='TEST'");
  await pool.query('DELETE FROM categories c WHERE c.provenance=$1 AND NOT(c.slug=ANY($2::text[])) AND NOT EXISTS(SELECT 1 FROM products p WHERE p.category_id=c.id)', ['TEST', categories.map(([slug]) => slug)]);
  for (const [i, [slug, name, icon]] of categories.entries()) {
    await pool.query(`INSERT INTO categories(slug,name,icon_key,sort_order,is_active,provenance) VALUES($1,$2,$3,$4,true,'TEST') ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,icon_key=EXCLUDED.icon_key,sort_order=EXCLUDED.sort_order,is_active=true,provenance='TEST'`, [slug, name, icon, i + 1]);
  }
  await pool.query("DELETE FROM products WHERE provenance='TEST'");
  for (const [index, item] of products.entries()) {
    const category = await pool.query('SELECT id FROM categories WHERE slug=$1', [item.category]);
    const row = await pool.query(`INSERT INTO products(slug,name,description,category_id,status,provenance,base_price_vnd,is_featured,is_new) VALUES($1,$2,$3,$4,'ACTIVE','TEST',$5,$6,$7) RETURNING id`, [item.slug, item.name, `Sản phẩm thử nghiệm trong môi trường phát triển.`, category.rows[0].id, item.price, index === 0, item.fresh]);
    const productId = row.rows[0].id as string;
    for (const size of ['S', 'M', 'L', 'XL']) {
      await pool.query(`INSERT INTO product_variants(product_id,sku,size,color_code,color_name,display_color,color_hex,price_override_vnd,stock_quantity,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`, [productId, `TCM-TEST-${index + 1}-${size}`, size, size === 'M' ? 'BABY_BLUE' : 'CREAM', size === 'M' ? 'Xanh baby' : 'Kem', size === 'M' ? 'Xanh baby' : 'Kem', size === 'M' ? '#A9D6F5' : '#EFE4D1', size === 'XL' ? item.price + 10000 : null, index === 0 && size === 'S' ? 0 : 5]);
    }
    const variant = await pool.query('SELECT id FROM product_variants WHERE product_id=$1 ORDER BY size LIMIT 1', [productId]);
    await pool.query(`INSERT INTO product_images(product_id,variant_id,url,alt_text,sort_order,is_primary) VALUES($1,NULL,$2,$3,0,true),($1,$4,$5,$6,1,false)`, [productId, `/demo/${item.image}`, item.name, variant.rows[0].id, `/demo/${item.detailImage ?? item.image}`, `${item.name} - ảnh chi tiết`]);
  }
  await pool.query('COMMIT');
  console.log(`Seeded ${categories.length} TEST categories and ${products.length} TEST products.`);
} catch (error) { await pool.query('ROLLBACK'); throw error; }
finally { await pool.end(); }
