import 'dotenv/config';
import pg from 'pg';
import { hashAdminPassword } from '../src/commerce.js';
import { assertSafeTestTarget } from './safe-test-target.js';

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const mode = process.env.CATALOG_MODE ?? 'production';
if (!['production', 'test'].includes(mode)) throw new Error('CATALOG_MODE must be production or test.');
if (process.env.NODE_ENV === 'production' && process.env.TCM_ENVIRONMENT !== 'production' && process.env.TCM_ENVIRONMENT !== 'staging') throw new Error('Production runtime must explicitly declare TCM_ENVIRONMENT.');
if (mode === 'test') assertSafeTestTarget('TEST admin creation');
if (process.env.TCM_ENVIRONMENT === 'production' && mode !== 'production') throw new Error('Production admin creation requires production catalog provenance.');
if (process.env.TCM_ENVIRONMENT === 'staging' && mode !== 'test') throw new Error('Staging admin creation requires TEST catalog provenance.');
const provenance = mode === 'test' ? 'TEST' : 'PRODUCTION';
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Set ADMIN_EMAIL to a valid admin email.');
if (!password) throw new Error('Inject ADMIN_PASSWORD through a protected process environment; do not pass it as a command argument.');
const { salt, hash } = hashAdminPassword(password);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const result = await pool.query('INSERT INTO admin_users(provenance,email,password_salt,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(provenance,email) DO NOTHING RETURNING id', [provenance, email, salt, hash]);
  if (!result.rowCount) throw new Error(`Admin already exists in ${provenance}; no account was changed.`);
  console.log(`Created ${provenance} admin account.`);
} finally { await pool.end(); }
