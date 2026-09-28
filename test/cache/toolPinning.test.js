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

test('a later turn with an added tool still gets the original pinned list, and warns once', () => {
  const pinning = createToolPinning();
  pinning.resolve('conv-1', [{ name: 'a' }]);
  const warnings = [];
  const out = pinning.resolve('conv-1', [{ name: 'a' }, { name: 'newTool' }], { warn: (m) => warnings.push(m) });
  assert.deepEqual(out.map((t) => t.name), ['a']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /newTool/);
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
