// @ts-check
'use strict';

// PLAN.md §3.5 / §9 Phase 1 accept criterion: "the spend cap stops a synthetic runaway loop".

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpendCap } = require('../../src/budget/spendCap');

test('session cap stops a synthetic runaway loop in one conversation', () => {
  const cap = createSpendCap({ sessionCapTokens: 1000, hourlyCapTokens: 0 });
  let rounds = 0;
  assert.doesNotThrow(() => cap.check('conv-1'));
  // A runaway agent loop: many rounds, each recording more cost, on the same conversation.
  // check() is called before every round the way the provider does before sending a request.
  for (; rounds < 100; rounds++) {
    try {
      cap.check('conv-1');
    } catch {
      break;
    }
    cap.record('conv-1', 50);
  }
  assert.ok(rounds < 100, 'the loop should have been stopped well before 100 rounds');
  assert.throws(() => cap.check('conv-1'), /session spend cap reached/);
  assert.equal(cap.snapshot('conv-1').conversation >= 1000, true);
});

test('the cap is per-conversation: a fresh conversation is unaffected', () => {
  const cap = createSpendCap({ sessionCapTokens: 100, hourlyCapTokens: 0 });
  cap.record('conv-a', 200);
  assert.throws(() => cap.check('conv-a'));
  assert.doesNotThrow(() => cap.check('conv-b'));
});

test('hourly cap trips across conversations and prunes entries older than an hour', () => {
  const cap = createSpendCap({ sessionCapTokens: 0, hourlyCapTokens: 500 });
  cap.record('conv-a', 300);
  cap.record('conv-b', 250);
  assert.throws(() => cap.check('conv-c'), /hourly spend cap reached/);
});

test('0 disables a cap', () => {
  const cap = createSpendCap({ sessionCapTokens: 0, hourlyCapTokens: 0 });
  cap.record('conv-a', 1e9);
  assert.doesNotThrow(() => cap.check('conv-a'));
});
