import 'dotenv/config';
import { createApp } from './app.js';
import { pool } from './db.js';
import { startOrderNotificationWorker } from './order-notifications.js';

const app = await createApp();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
const stopNotificationWorker = startOrderNotificationWorker();
const shutdown = async () => { stopNotificationWorker(); await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
