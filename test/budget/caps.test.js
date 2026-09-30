// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveCaps } = require('../../src/budget/caps');

const declared = { sessionCapTokens: 50000, hourlyCapTokens: 200000 };

test('effectiveCaps: unset caps follow the monthly limit, never above the declared default', () => {
  assert.deepEqual(effectiveCaps({ ...declared, sessionCapExplicit: false, hourlyCapExplicit: false }, 200000), { sessionCapTokens: 20000, hourlyCapTokens: 50000 });
  assert.deepEqual(effectiveCaps({ ...declared, sessionCapExplicit: false, hourlyCapExplicit: false }, 5_000_000), declared, 'a large pool keeps the declared defaults');
});

test('effectiveCaps: caps the user set are used as written, and 0 still disables', () => {
  assert.deepEqual(effectiveCaps({ sessionCapTokens: 90000, hourlyCapTokens: 0, sessionCapExplicit: true, hourlyCapExplicit: true }, 200000), { sessionCapTokens: 90000, hourlyCapTokens: 0 });
  assert.equal(effectiveCaps({ sessionCapTokens: 0, hourlyCapTokens: 0, sessionCapExplicit: false, hourlyCapExplicit: false }, 200000).sessionCapTokens, 0);
});

test('effectiveCaps: an unknown monthly limit leaves the declared defaults', () => {
  assert.deepEqual(effectiveCaps({ ...declared, sessionCapExplicit: false, hourlyCapExplicit: false }, null), declared);
});
