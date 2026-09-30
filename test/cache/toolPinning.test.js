// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolPinning } = require('../../src/cache/toolPinning');

test('first request pins the tool list for that conversation', () => {
  const pinning = createToolPinning();
  const tools = [{ name: 'a' }, { name: 'b' }];
  assert.deepEqual(pinning.resolve('conv-1', tools), tools);
});

test('a tool added later is sent from that turn on and noted once (DEFECTS D7)', () => {
  const pinning = createToolPinning();
  pinning.resolve('conv-1', [{ name: 'a' }, { name: 'c' }]);
  const notes = [];
  const out = pinning.resolve('conv-1', [{ name: 'a' }, { name: 'b' }, { name: 'c' }], { onAdded: (m) => notes.push(m) });
  assert.deepEqual(out.map((t) => t.name), ['a', 'c', 'b'], 'pinned tools first, then the additions');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /b/);
  const again = pinning.resolve('conv-1', [{ name: 'a' }, { name: 'b' }, { name: 'c' }], { onAdded: (m) => notes.push(m) });
  assert.deepEqual(again.map((t) => t.name), ['a', 'c', 'b'], 'the merged list is the pinned list now');
  assert.equal(notes.length, 1, 'no further note once the change has been absorbed');
});

test('an addition and a removal in the same turn: the removed tool stays, the added one joins', () => {
  const pinning = createToolPinning();
  pinning.resolve('conv-1', [{ name: 'a' }, { name: 'b' }]);
  const out = pinning.resolve('conv-1', [{ name: 'a' }, { name: 'z' }]);
  assert.deepEqual(out.map((t) => t.name), ['a', 'b', 'z']);
});

test('a later turn with a removed tool still gets the full pinned list (cache stability over churn)', () => {
  const pinning = createToolPinning();
  pinning.resolve('conv-1', [{ name: 'a' }, { name: 'b' }]);
  const out = pinning.resolve('conv-1', [{ name: 'a' }]);
  assert.deepEqual(out.map((t) => t.name), ['a', 'b']);
});

test('different conversations are pinned independently', () => {
  const pinning = createToolPinning();
  pinning.resolve('conv-1', [{ name: 'a' }]);
  const out = pinning.resolve('conv-2', [{ name: 'z' }]);
  assert.deepEqual(out.map((t) => t.name), ['z']);
});

test('clear() forgets the pinned list, so the next resolve() re-pins', () => {
  const pinning = createToolPinning();
  pinning.resolve('conv-1', [{ name: 'a' }]);
  pinning.clear('conv-1');
  const out = pinning.resolve('conv-1', [{ name: 'b' }]);
  assert.deepEqual(out.map((t) => t.name), ['b']);
});
