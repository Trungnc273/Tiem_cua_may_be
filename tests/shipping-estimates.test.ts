import assert from 'node:assert/strict';
import { test } from 'node:test';
import { provinceLabel, resolveShippingEstimate, vietnamProvinces } from '../src/shipping-estimates.ts';

test('province selector uses a unique controlled list of 34 current province and city codes', () => {
  assert.equal(vietnamProvinces.length, 34);
  assert.equal(new Set(vietnamProvinces.map(([code]) => code)).size, 34);
  assert.equal(provinceLabel('79'), 'Thành phố Hồ Chí Minh');
  assert.equal(provinceLabel('00'), null);
});

test('province estimate wins over fallback, fallback is used only without a province-specific row', async () => {
  const query = async (_sql: string, values: unknown[]) => ({
    rows: values[1] === '79'
      ? [{ id: 'specific', label: 'Thành phố Hồ Chí Minh', minVnd: 30000, maxVnd: 45000, isFallback: false }]
      : [{ id: 'fallback', label: 'Tỉnh/thành khác', minVnd: 25000, maxVnd: 40000, isFallback: true }],
  });
  assert.deepEqual(await resolveShippingEstimate(query, 'TEST', '79'), {
    ruleId: 'specific', label: 'Thành phố Hồ Chí Minh', minVnd: 30000, maxVnd: 45000, isFallback: false,
  });
  assert.deepEqual(await resolveShippingEstimate(query, 'TEST', '01'), {
    ruleId: 'fallback', label: 'Tỉnh/thành khác', minVnd: 25000, maxVnd: 40000, isFallback: true,
  });
});

test('no active estimate rule remains a valid no-estimate result', async () => {
  const result = await resolveShippingEstimate(async () => ({ rows: [] }), 'TEST', '79');
  assert.equal(result, null);
});
