import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const migrationsDir = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const name of files) {
    const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
    if (exists.rowCount) continue;
    const sql = await readFile(join(migrationsDir, name), 'utf8');
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(sql); await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    console.log(`applied ${name}`);
  }
} finally { await pool.end(); }
