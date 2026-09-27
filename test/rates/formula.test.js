// @ts-check
'use strict';

// Ported from test/probe/billing.test.mjs (research), pointed at the CommonJS runtime port
// under src/. Same real fixtures: expectedBill() reproduces measured bills within the
// documented +1..+5 per-request constant (research/rate-sources-investigation.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const { cacheRule } = require('../../src/rates/cacheRules');
const { expectedBill, verdict } = require('../../src/rates/formula');
const { normalize } = require('../../src/normalize');

test('cacheRule follows the measured hosts', () => {
  assert.deepEqual(cacheRule('M', 'google-claude-45-haiku'), { read: 0.1, write5m: 1.25, write1h: 2 });
  assert.ok(cacheRule('CC', 'gpt-4.1-nano'));
  assert.equal(cacheRule('CC', 'aws-bedrock-gpt-5-6-luna-gov'), null);
  assert.equal(cacheRule('M', 'google-claude-opus-5-5')?.read, 0.05, 'measured 2026-09-26');
  assert.equal(cacheRule('M', 'aws-bedrock-claude-fable-5-1-gov')?.read, 0.025, 'web table, unmeasured');
  assert.equal(cacheRule('G', 'google-gemini-2.5-flash'), null);
  assert.equal(cacheRule('N', 'x'), null);
});

test('expectedBill reproduces measured bills (2026-09-25) within the +1..5 constant', () => {
  const haiku = { prompt: 0.071477, completion: 0.3575 };
  // 40k Haiku write billed 3105, then read billed 253
  const w = expectedBill(normalize('M', { input_tokens: 11, cache_creation_input_tokens: 34683, cache_creation: { ephemeral_5m_input_tokens: 34683, ephemeral_1h_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: 4 }), haiku, cacheRule('M', 'h'));
  const r = expectedBill(normalize('M', { input_tokens: 11, cache_creation_input_tokens: 0, cache_read_input_tokens: 34683, output_tokens: 4 }), haiku, cacheRule('M', 'h'));
  assert.equal(verdict(3105, w), 'fits');
  assert.equal(verdict(253, r), 'fits');

  // CC (OpenAI on Azure): read 0.1x, write 1.25x only where cache_write_tokens is reported.
  const gptRates = { prompt: 0.05, completion: 0.25 };
  const ccRead = expectedBill(normalize('CC', { prompt_tokens: 4312, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 4000 }, completion_tokens_details: { reasoning_tokens: 0 } }), gptRates, cacheRule('CC', 'gpt-5.4-nano'));
  assert.equal(ccRead, Math.round((312 * 0.05 + 4000 * 0.05 * 0.1 + 4 * 0.25) * 100) / 100);

  // R: a cache write reported without a TTL split is priced at write5m (measured on gpt-5.6-luna).
  const rWrite = expectedBill(normalize('R', { input_tokens: 4346, input_tokens_details: { cache_write_tokens: 4343 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 } }), gptRates, cacheRule('R', 'gpt-5.6-luna'));
  assert.equal(rWrite, Math.round((3 * 0.05 + 4343 * 0.05 * 1.25 + 5 * 0.25) * 100) / 100);

  // Gemini: cached tokens reported but billed in full; thoughts not billed (billed 678).
  const g = expectedBill(normalize('G', { promptTokenCount: 34622, cachedContentTokenCount: 33764, candidatesTokenCount: 1, thoughtsTokenCount: 16 }), { prompt: 0.01952, completion: 0.1625 }, cacheRule('G', 'g'), { flavor: 'G' });
  assert.equal(verdict(678, g), 'fits');

  assert.equal(verdict(0, 5), 'unbilled');
  assert.equal(verdict(50, 20), 'over');
  assert.equal(verdict(null, 20), 'unknown');
});
