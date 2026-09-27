// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../../src/normalize');

test('M: thinking split from output_tokens when reported, cache creation split by TTL', () => {
  const withThinking = normalize('M', { input_tokens: 11, output_tokens: 100, output_tokens_details: { thinking_tokens: 40 }, cache_read_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 0 } });
  assert.deepEqual(withThinking, { inputUncached: 11, cacheRead: 5, cacheWrite5m: 30, cacheWrite1h: 0, cacheWriteUnsplit: 0, visibleOutput: 60, thinking: 40, thinkingUnknown: false });

  const noThinkingField = normalize('M', { input_tokens: 11, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 20 });
  assert.equal(noThinkingField.thinkingUnknown, true);
  assert.equal(noThinkingField.visibleOutput, 100);
  assert.equal(noThinkingField.cacheWriteUnsplit, 20);
});

test('CC: uncached = prompt - cached - written; reasoning split from completion', () => {
  const z = normalize('CC', { prompt_tokens: 4312, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: null }, completion_tokens_details: { reasoning_tokens: 0 } });
  assert.deepEqual(z, { inputUncached: 4312, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, visibleOutput: 4, thinking: 0, thinkingUnknown: false });
});

test('CC: Claude served through CC answers with Anthropic-shaped usage (measured 2026-09-25)', () => {
  const z = normalize('CC', { input_tokens: 11, output_tokens: 5, cache_read_input_tokens: 3 });
  assert.equal(z.inputUncached, 11);
  assert.equal(z.cacheRead, 3);
});

test('R: cache_write_tokens reported separately, priced as an unsplit write (measured on gpt-5.6-luna)', () => {
  const z = normalize('R', { input_tokens: 4346, input_tokens_details: { cache_write_tokens: 4343, cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 } });
  assert.equal(z.inputUncached, 3);
  assert.equal(z.cacheWriteUnsplit, 4343);
  assert.equal(z.visibleOutput, 5);
});

test('G: cached tokens counted but not discounted (billing side, not here); thoughtsTokenCount kept separate', () => {
  const z = normalize('G', { promptTokenCount: 34622, cachedContentTokenCount: 33764, candidatesTokenCount: 1, thoughtsTokenCount: 16 });
  assert.equal(z.inputUncached, 858);
  assert.equal(z.cacheRead, 33764);
  assert.equal(z.thinking, 16);
});

test('normalize returns null for missing usage', () => {
  assert.equal(normalize('CC', null), null);
});
