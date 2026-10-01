# Tiệm Của Mây catalog API

Fashion-only catalog, commerce, and product-admin API, built on Fastify, PostgreSQL, Drizzle schema definitions, and Zod validation. This service has an independent migration sequence and no MIDORA entities.

## Local setup

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Set `DATABASE_URL` to the Tiệm Của Mây PostgreSQL database before running migration or starting the server. The root compose file publishes local Postgres on port 5438.

For an isolated test database, migrate it first, then set `NODE_ENV=test` and `CATALOG_MODE=test` and run `pnpm db:seed:test`. The seed command refuses production mode. Never seed a production database.

## Public API

- `GET /api/v1/public/categories`
- `GET /api/v1/public/products?q=&category=&newOnly=&sort=&page=&limit=`
- `GET /api/v1/public/products/:slug`
- `GET /api/v1/public/categories/:slug/products?q=&sort=&page=&limit=`
- `GET /api/v1/public/media/products/:storageKey`
- `/api/v1/admin/catalog/categories` — authenticated category list/create/edit/activate.
- `/api/v1/admin/catalog/products` — authenticated bounded product list/create/detail/edit/status, variants/stock, and product image operations.
- `GET /health`, `GET /ready`

Sorts are `newest`, `price_asc`, `price_desc`, and `name`; `limit` is capped at 50. Search matches product name, category name, and active variant SKU. Detail returns active variants with inherited/overridden integer VND price, derived stock availability, and ordered image metadata.

## Domain rules

- Categories use stable unique slugs and deterministic order. Only active, eligible categories are public.
- Products have lifecycle status and explicit `PRODUCTION` or `TEST` provenance. Only active products with at least one active variant are public.
- The default `CATALOG_MODE=production` includes `PRODUCTION` rows only. `CATALOG_MODE=test` explicitly adds test fixtures for isolated QA. Provenance is not returned in public JSON.
- Variant SKU is unique. Size is free text; color identity is a stable code, with optional display name and hex.
- Variant price override falls back to the parent base price. All prices and stock are non-negative PostgreSQL integers.
- Inventory V1 is a per-variant quantity only; no warehouse or reservation model exists.
- Product uploads accept JPEG, PNG, and WebP after byte-signature and dimension checks. Maximum file size is 8 MiB, dimensions are capped at 6000 × 6000 and 24 megapixels, filenames are random, and files are stored outside the app image.
- `PRODUCT_UPLOAD_DIR` selects a dedicated persistent directory. Local development defaults to `TIEM_CUA_MAY_BE/uploads/products`; Docker mounts the named `tiem_cua_may_product_uploads` volume at `/data/uploads/products`. PostgreSQL and this upload volume both belong in backups. Do not store this path in an ephemeral container layer.
- Public media is served only through a generated-key route, with a fixed image content type, `nosniff`, a restrictive CSP, immutable caching, and no directory listing. Removed product images stay available while an order snapshot refers to the URL; otherwise their media record is removed and the file is unlinked after commit. Failed file cleanup is logged by generated media key.
- Product upload rows hold storage metadata only; image binaries never enter PostgreSQL or audit metadata. The frontend points uploaded-image requests at its configured catalog API origin (`NEXT_PUBLIC_CATALOG_API_URL`); server-rendered catalog data uses `CATALOG_API_URL`.
- Product publication requires an active category, an active variant, and at least one image. Drafts are not public. Out-of-stock active variants remain visible as out of stock.
- Admin product and category updates use `updated_at` preconditions; variants use row locks and stock edits are audited. Product/category records are not hard-deleted; variants are disabled, preserving order foreign keys and snapshots.
- Collection is omitted because there are no owner-approved collection records or current UI use.

See `../TIEM_CUA_MAY_DOC/BATCH-2-REPORT.md` for decisions, verification, and known limitations.
