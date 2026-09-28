// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parts } = require('../helpers/vscode-stub');
const { checkCacheHealth, longPrefix } = require('../../src/ui/cacheHealth');

const CTORS = { TextPart: parts.LanguageModelTextPart };
const ROLE_ENUM = { User: 1, Assistant: 2 };

test('longPrefix builds a deterministic string at least as long as requested', () => {
  const p = longPrefix(500);
  assert.ok(p.length >= 500);
  assert.equal(longPrefix(500), p);
});

test('checkCacheHealth: a repeat with cacheRead > 0 passes; all four checks report', async () => {
  let call = 0;
  const send = async () => {
    call++;
    if (call === 1) return { usage: { input_tokens: 5000, cache_read_input_tokens: 0 }, error: null, transportError: null };
    if (call === 2) return { usage: { input_tokens: 0, cache_read_input_tokens: 5000 }, error: null, transportError: null };
    return { usage: { input_tokens: 5000, cache_read_input_tokens: 0 }, error: null, transportError: null };
  };
  const normalize = (/** @type {string} */ _flavor, /** @type {any} */ u) => ({ inputUncached: u.input_tokens, cacheRead: u.cache_read_input_tokens });
  const results = await checkCacheHealth({ send, normalize, cacheRuleForModel: { read: 0.1, write5m: 1.25, write1h: 2 }, ctors: CTORS, roleEnum: ROLE_ENUM, flavor: 'M' });
  assert.equal(results.length, 4);
  assert.equal(results.find((r) => r.name === 'repeat (expect a cache hit)')?.pass, true);
  assert.equal(call, 3);
});

test('checkCacheHealth: no cacheRead on repeat fails that check when the model has a cache rule', async () => {
  const send = async () => ({ usage: { input_tokens: 5000, cache_read_input_tokens: 0 }, error: null, transportError: null });
  const normalize = () => ({ inputUncached: 5000, cacheRead: 0 });
  const results = await checkCacheHealth({ send, normalize, cacheRuleForModel: { read: 0.1, write5m: 1.25, write1h: 2 }, ctors: CTORS, roleEnum: ROLE_ENUM, flavor: 'M' });
  assert.equal(results.find((r) => r.name === 'repeat (expect a cache hit)')?.pass, false);
});

test('checkCacheHealth: no cache rule for this model/flavor skips (passes) the repeat check', async () => {
  const send = async () => ({ usage: { input_tokens: 5000, cache_read_input_tokens: 0 }, error: null, transportError: null });
  const normalize = () => ({ inputUncached: 5000, cacheRead: 0 });
  const results = await checkCacheHealth({ send, normalize, cacheRuleForModel: null, ctors: CTORS, roleEnum: ROLE_ENUM, flavor: 'G' });
  assert.equal(results.find((r) => r.name === 'repeat (expect a cache hit)')?.pass, true);
});

test('checkCacheHealth: a transport error fails the cold-prefix check', async () => {
  const send = async () => ({ usage: null, error: { message: 'bad request' }, transportError: null });
  const normalize = () => null;
  const results = await checkCacheHealth({ send, normalize, cacheRuleForModel: null, ctors: CTORS, roleEnum: ROLE_ENUM, flavor: 'M' });
  assert.equal(results.find((r) => r.name === 'cold prefix')?.pass, false);
});
