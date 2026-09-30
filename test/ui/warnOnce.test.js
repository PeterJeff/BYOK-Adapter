// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWarnOnce } = require('../../src/ui/warnOnce');

test('createWarnOnce: a key shows once per window, other keys are independent, and it shows again afterwards', () => {
  let t = 0;
  const gate = createWarnOnce({ windowMs: 1000, now: () => t });
  assert.equal(gate('a'), true);
  assert.equal(gate('a'), false);
  assert.equal(gate('b'), true);
  t = 999;
  assert.equal(gate('a'), false);
  t = 1000;
  assert.equal(gate('a'), true);
});
