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

test('a getter is read on every check, so a lowered cap applies without a reload', () => {
  let limits = { sessionCapTokens: 50000, hourlyCapTokens: 0 };
  const cap = createSpendCap(() => limits);
  cap.record('conv-1', 160);
  assert.doesNotThrow(() => cap.check('conv-1'));
  limits = { sessionCapTokens: 100, hourlyCapTokens: 0 };
  assert.throws(() => cap.check('conv-1'), /session spend cap reached \(160 of 100/);
});

test('bump: asksage.requestMoreTokens raises one conversation\'s effective session cap, additively', () => {
  const cap = createSpendCap({ sessionCapTokens: 100, hourlyCapTokens: 0 });
  cap.record('conv-1', 150);
  assert.throws(() => cap.check('conv-1'), /session spend cap reached \(150 of 100/);
  cap.bump('conv-1', 100);
  assert.equal(cap.bumpFor('conv-1'), 100);
  assert.doesNotThrow(() => cap.check('conv-1')); // 150 of 200 now
  cap.bump('conv-1', 100); // stacks
  assert.equal(cap.bumpFor('conv-1'), 200);
});

test('bump: only affects the conversation it was applied to', () => {
  const cap = createSpendCap({ sessionCapTokens: 100, hourlyCapTokens: 0 });
  cap.bump('conv-1', 500);
  assert.equal(cap.bumpFor('conv-2'), 0);
  cap.record('conv-2', 150);
  assert.throws(() => cap.check('conv-2'), /session spend cap reached/);
});

test('bump: ignores a non-positive amount', () => {
  const cap = createSpendCap({ sessionCapTokens: 100, hourlyCapTokens: 0 });
  cap.bump('conv-1', 0);
  cap.bump('conv-1', -5);
  assert.equal(cap.bumpFor('conv-1'), 0);
});
