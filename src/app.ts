import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool } from './db.js';
import { registerCatalogRoutes } from './catalog.js';
import { registerCommerceRoutes } from './commerce.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CATALOG_MODE: z.enum(['production', 'test']).default('production'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TCM_ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).optional(),
  PUBLIC_APP_URL: z.string().url().optional(),
});
const env = envSchema.parse(process.env);
const origins = env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
if (origins.some((origin) => origin === '*' || !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.');
if (env.NODE_ENV === 'production') {
  if (!env.TCM_ENVIRONMENT || !process.env.CORS_ORIGINS || !env.PUBLIC_APP_URL) throw new Error('Production runtime requires TCM_ENVIRONMENT, PUBLIC_APP_URL, and an explicit CORS_ORIGINS allowlist.');
  if (!env.PUBLIC_APP_URL.startsWith('https://') || !origins.includes(env.PUBLIC_APP_URL)) throw new Error('PUBLIC_APP_URL must be HTTPS and included in CORS_ORIGINS.');
  if (env.TCM_ENVIRONMENT === 'production' && env.CATALOG_MODE !== 'production') throw new Error('Production environment must use production catalog provenance.');
  if (env.TCM_ENVIRONMENT === 'staging') {
    if (env.CATALOG_MODE !== 'test') throw new Error('Public staging must use the isolated TEST catalog.');
    let database: URL;
    try { database = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Staging requires a valid DATABASE_URL.'); }
    const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
    if (!['database', 'localhost', '127.0.0.1'].includes(database.hostname) || !/(?:^|[_-])(?:test|stage|staging)(?:$|[_-])/i.test(databaseName)) throw new Error('Staging may connect only to an explicitly named local TEST/stage database.');
  } else if (env.TCM_ENVIRONMENT !== 'production') throw new Error('Production runtime must declare TCM_ENVIRONMENT=production or staging.');
}
export async function createApp() {
  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'], level: env.NODE_ENV === 'test' ? 'silent' : 'info' }, bodyLimit: 16 * 1024 });
  await app.register(cors, { origin: origins, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Idempotency-Key'], maxAge: 600 });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.length > 2048) return reply.code(414).send({ error: { code: 'URI_TOO_LONG', message: 'Yêu cầu quá dài.' } });
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ name: (error as Error).name, code: (error as Error & { code?: string }).code }, 'request failed');
    if ((error as Error & { statusCode?: number; code?: string }).statusCode === 413 || (error as Error & { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: { code: 'REQUEST_TOO_LARGE', message: 'The request is too large. Product images must be 8 MB or smaller.' } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra.' } });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try { await pool.query("SELECT 1 FROM schema_migrations WHERE name='0007_shipping_estimates.sql'"); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  await registerCatalogRoutes(app);
  await registerCommerceRoutes(app);
  return app;
}
