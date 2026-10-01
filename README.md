# Tiệm Của Mây API foundation

This is a clean, fashion-specific backend workspace. No MIDORA source, database, migrations, or domain entities are copied here. The initial database migration only enables `pgcrypto`; catalog tables belong in the catalog batch.

Proposed V1 direction from the project brief: Node.js + TypeScript, Fastify, PostgreSQL, Drizzle, and Zod in a modular monolith. Start the Tiệm Của Mây migration history from scratch when the catalog/API batch begins. Product, ProductVariant (including configurable size/color), Category, Collection, ProductImage, Inventory, Favorite, Cart, and CartItem are candidate fashion-commerce entities.

No checkout/order creation is present. Guest/account requirements, payment methods, shipping coverage/fees, order statuses, cancellations, refunds, and promotion rules remain owner decisions.

For local PostgreSQL, copy the root `.env.example` to `.env`, then run `docker compose up -d database`. The dev-only password must not be reused elsewhere.
