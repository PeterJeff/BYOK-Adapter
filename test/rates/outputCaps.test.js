// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOutputCaps } = require('../../src/rates/outputCaps');

test('falls back to the catalog default until a correction is recorded', () => {
  const caps = createOutputCaps(undefined);
  assert.equal(caps.get('gpt-5.6-luna', 900000), 900000);
  caps.correct('gpt-5.6-luna', 32768);
  assert.equal(caps.get('gpt-5.6-luna', 900000), 32768);
  assert.equal(caps.get('some-other-model', 8000), 8000, 'a correction for one model must not leak to another');
});

test('persists corrections through the injected store', () => {
  /** @type {Record<string, number> | undefined} */
  let saved;
  const store = { get: () => saved, set: (v) => (saved = v) };
  const capsA = createOutputCaps(store);
  capsA.correct('gpt-5.6-luna', 32768);
  const capsB = createOutputCaps(store); // simulates a fresh extension-host activation
  assert.equal(capsB.get('gpt-5.6-luna', 900000), 32768);
});
