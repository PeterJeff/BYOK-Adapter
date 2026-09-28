// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { placeBreakpoints, cacheControl } = require('../../src/cache/breakpoints');

const LONG = 'x'.repeat(5000); // well above the default 1024-token (~3.8k char) minimum

test('cacheControl: empty ttl means the default (no ttl field), non-empty sets it', () => {
  assert.deepEqual(cacheControl(''), { type: 'ephemeral' });
  assert.deepEqual(cacheControl('1h'), { type: 'ephemeral', ttl: '1h' });
});

test('mixed mode (default): tools+system get 1h, the two most recent messages get 5m (default)', () => {
  const body = {
    tools: [{ name: 't', input_schema: {} }],
    system: [{ type: 'text', text: LONG }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: LONG }] },
      { role: 'assistant', content: [{ type: 'text', text: LONG }] },
    ],
  };
  // minPrefixTokens:0 isolates the TTL-mode behavior; the minimum-prefix skip has its own test below.
  const out = placeBreakpoints(body, { minPrefixTokens: 0 });
  assert.deepEqual(out.tools[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.deepEqual(out.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.deepEqual(out.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(out.messages[1].content[0].cache_control, { type: 'ephemeral' });
});

test('5m mode: nothing gets an explicit ttl', () => {
  const body = { tools: [{ name: 't' }], messages: [{ role: 'user', content: [{ type: 'text', text: LONG }] }] };
  const out = placeBreakpoints(body, { ttlMode: '5m', minPrefixTokens: 0 });
  assert.deepEqual(out.tools[0].cache_control, { type: 'ephemeral' });
});

test('1h mode: everything gets ttl:1h', () => {
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: LONG }] }] };
  const out = placeBreakpoints(body, { ttlMode: '1h' });
  assert.deepEqual(out.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '1h' });
});

test('below the minimum prefix, no breakpoint is placed', () => {
  const body = { tools: [{ name: 't' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'short' }] }] };
  const out = placeBreakpoints(body, { minPrefixTokens: 1024 });
  assert.equal(out.tools[0].cache_control, undefined);
  assert.equal(out.messages[0].content[0].cache_control, undefined);
});

test('only one cacheable message: breakpoint 4 (second-most-recent) is skipped, not an error', () => {
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: LONG }] }] };
  const out = placeBreakpoints(body);
  assert.deepEqual(out.messages[0].content[0].cache_control, { type: 'ephemeral' });
});

test('breakpoints 3/4 land on the two most recent cacheable messages, skipping an empty one', () => {
  const body = {
    messages: [
      { role: 'user', content: [{ type: 'text', text: LONG }] }, // bp4
      { role: 'assistant', content: [] }, // no content: not cacheable, skipped
      { role: 'user', content: [{ type: 'text', text: LONG }] }, // bp3
    ],
  };
  const out = placeBreakpoints(body);
  assert.deepEqual(out.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(out.messages[1].content.length, 0);
  assert.deepEqual(out.messages[2].content[0].cache_control, { type: 'ephemeral' });
});

test('does not mutate the input body', () => {
  const body = { tools: [{ name: 't' }], messages: [{ role: 'user', content: [{ type: 'text', text: LONG }] }] };
  placeBreakpoints(body);
  assert.equal(body.tools[0].cache_control, undefined);
  assert.equal(body.messages[0].content[0].cache_control, undefined);
});
