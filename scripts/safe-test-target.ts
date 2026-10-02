export function assertSafeTestTarget(action: string, env: NodeJS.ProcessEnv = process.env) {
  if (!['test', 'staging'].includes(env.TCM_ENVIRONMENT ?? '') || env.CATALOG_MODE !== 'test') throw new Error(`${action} requires TCM_ENVIRONMENT=test/staging and CATALOG_MODE=test.`);
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error(`${action} requires a valid DATABASE_URL.`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${action} requires PostgreSQL.`);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const safeName = /(?:^|[_-])(?:test|stage|staging)(?:$|[_-])/i.test(databaseName);
  const allowedHost = ['localhost', '127.0.0.1', '::1', 'database'].includes(url.hostname);
  if (!safeName || !allowedHost) throw new Error(`${action} refused: target must be a local TEST/staging database.`);
  if (!env.TCM_SAFE_TEST_DATABASE || env.TCM_SAFE_TEST_DATABASE !== databaseName) throw new Error(`${action} refused: TCM_SAFE_TEST_DATABASE must exactly match the intended database name.`);
  return databaseName;
}
