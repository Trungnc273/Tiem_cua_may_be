import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool } from './db.js';
import { registerCatalogRoutes } from './catalog.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CATALOG_MODE: z.enum(['production', 'test']).default('production'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});
const env = envSchema.parse(process.env);
export async function createApp() {
  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'], level: env.NODE_ENV === 'test' ? 'silent' : 'info' }, bodyLimit: 16 * 1024 });
  const origins = env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  await app.register(cors, { origin: origins, methods: ['GET', 'HEAD', 'OPTIONS'], maxAge: 600 });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.length > 2048) return reply.code(414).send({ error: { code: 'URI_TOO_LONG', message: 'Yêu cầu quá dài.' } });
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra.' } });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  await registerCatalogRoutes(app);
  return app;
}
