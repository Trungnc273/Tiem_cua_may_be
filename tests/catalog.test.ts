import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogQuerySchema } from '../src/validation.ts';

test('public catalog query has bounded defaults', () => {
  assert.deepEqual(catalogQuerySchema.parse({}), { sort: 'newest', page: 1, limit: 20 });
});
test('supports declared sorting and the pagination maximum', () => {
  assert.equal(catalogQuerySchema.parse({ sort: 'price_desc', limit: 50 }).limit, 50);
});
test('rejects oversized search, invalid sort, malformed category, and unbounded page size', () => {
  assert.equal(catalogQuerySchema.safeParse({ q: 'x'.repeat(81) }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ sort: 'bestseller' }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ category: '../ao' }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ limit: 51 }).success, false);
});
