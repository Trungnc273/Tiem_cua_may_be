import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeTestTarget } from '../scripts/safe-test-target.ts';

const valid = {
  NODE_ENV: 'production',
  TCM_ENVIRONMENT: 'staging',
  TCM_SAFE_TEST_DATABASE: 'tiem_cua_may_batch5_stage',
  CATALOG_MODE: 'test',
  DATABASE_URL: 'postgresql://stage_user:local-only@database:5432/tiem_cua_may_batch5_stage',
};

test('fixture tools require an explicit environment and exact local TEST database allowlist', () => {
  assert.equal(assertSafeTestTarget('seed', valid), 'tiem_cua_may_batch5_stage');
  assert.throws(() => assertSafeTestTarget('seed', { ...valid, TCM_SAFE_TEST_DATABASE: 'production' }), /must exactly match/);
  assert.throws(() => assertSafeTestTarget('seed', { ...valid, DATABASE_URL: 'postgresql://u:p@db.example.com:5432/tiem_cua_may_batch5_stage' }), /local TEST\/staging/);
  assert.throws(() => assertSafeTestTarget('seed', { ...valid, DATABASE_URL: 'postgresql://u:p@database:5432/tiem_cua_may_prod', TCM_SAFE_TEST_DATABASE: 'tiem_cua_may_prod' }), /local TEST\/staging/);
  assert.throws(() => assertSafeTestTarget('seed', { ...valid, TCM_ENVIRONMENT: 'production' }), /requires TCM_ENVIRONMENT/);
});
