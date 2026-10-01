# Tiệm Của Mây catalog API

Fashion-only read API, built on Fastify, PostgreSQL, Drizzle schema definitions, and Zod query validation. This service has an independent clean migration sequence and no MIDORA entities.

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
- `GET /health`, `GET /ready`

Sorts are `newest`, `price_asc`, `price_desc`, and `name`; `limit` is capped at 50. Search matches product name, category name, and active variant SKU. Detail returns active variants with inherited/overridden integer VND price, derived stock availability, and ordered image metadata.

## Domain rules

- Categories use stable unique slugs and deterministic order. Only active, eligible categories are public.
- Products have lifecycle status and explicit `PRODUCTION` or `TEST` provenance. Only active products with at least one active variant are public.
- The default `CATALOG_MODE=production` includes `PRODUCTION` rows only. `CATALOG_MODE=test` explicitly adds test fixtures for isolated QA. Provenance is not returned in public JSON.
- Variant SKU is unique. Size is free text; color identity is a stable code, with optional display name and hex.
- Variant price override falls back to the parent base price. All prices and stock are non-negative PostgreSQL integers.
- Inventory V1 is a per-variant quantity only; no warehouse or reservation model exists.
- Images store ordered URL/path metadata only. Upload/storage are out of scope.
- Collection is omitted because there are no owner-approved collection records or current UI use.

See `../TIEM_CUA_MAY_DOC/BATCH-2-REPORT.md` for decisions, verification, and known limitations.
