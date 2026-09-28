// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReasoningCache } = require('../../src/state/reasoningCache');

test('set then get returns the same state', () => {
  const cache = createReasoningCache();
  cache.set('call-1', { thinking: 'because', signature: 'sig-1' });
  assert.deepEqual(cache.get('call-1'), { thinking: 'because', signature: 'sig-1' });
});

test('get on a miss returns undefined', () => {
  const cache = createReasoningCache();
  assert.equal(cache.get('nope'), undefined);
});

test('entries expire after the TTL', () => {
  let now = 1000;
  const cache = createReasoningCache({ ttlMs: 100, now: () => now });
  cache.set('call-1', { thinking: '', signature: 'sig-1' });
  now += 50;
  assert.deepEqual(cache.get('call-1'), { thinking: '', signature: 'sig-1' });
  now += 100;
  assert.equal(cache.get('call-1'), undefined);
});

test('bounded by entry count: the oldest is evicted first (LRU)', () => {
  const cache = createReasoningCache({ maxEntries: 2 });
  cache.set('a', { thinking: '', signature: '1' });
  cache.set('b', { thinking: '', signature: '2' });
  cache.set('c', { thinking: '', signature: '3' });
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('a'), undefined);
  assert.deepEqual(cache.get('b'), { thinking: '', signature: '2' });
  assert.deepEqual(cache.get('c'), { thinking: '', signature: '3' });
});

test('re-setting an existing key refreshes its LRU position', () => {
  const cache = createReasoningCache({ maxEntries: 2 });
  cache.set('a', { thinking: '', signature: '1' });
  cache.set('b', { thinking: '', signature: '2' });
  cache.set('a', { thinking: '', signature: '1-new' }); // touch a, so b is now the oldest
  cache.set('c', { thinking: '', signature: '3' });
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual(cache.get('a'), { thinking: '', signature: '1-new' });
});

test('set with no signature is a no-op (nothing worth caching)', () => {
  const cache = createReasoningCache();
  cache.set('a', { thinking: 'x', signature: '' });
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size(), 0);
});
