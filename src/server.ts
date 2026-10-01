import 'dotenv/config';
import { createApp } from './app.js';
import { pool } from './db.js';

const app = await createApp();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
const shutdown = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
