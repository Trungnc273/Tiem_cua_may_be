import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
export const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
export const db = drizzle(pool, { schema });
