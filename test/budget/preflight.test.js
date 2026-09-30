// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { charsOfRequest, estimatePreflightCost, checkPreflight } = require('../../src/budget/preflight');

class TextPart {
  constructor(value) {
    this.value = value;
  }
}
class ToolCallPart {
  constructor(callId, name, input) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
}
class ToolResultPart {
  constructor(callId, content) {
    this.callId = callId;
    this.content = content;
  }
}
const ctors = { TextPart, ToolCallPart, ToolResultPart };

test('charsOfRequest: sums text, tool-call input, tool-result text and tool schemas', () => {
  const messages = [
    { role: 1, content: [new TextPart('hello')] },
    { role: 2, content: [new ToolCallPart('c1', 'read', { path: 'a' })] },
    { role: 1, content: [new ToolResultPart('c1', [new TextPart('file contents')])] },
  ];
  const tools = [{ name: 'read', description: 'reads a file', inputSchema: { type: 'object' } }];
  const chars = charsOfRequest(messages, tools, ctors);
  const expected = 'hello'.length + (JSON.stringify({ path: 'a' }).length + 'read'.length) + 'file contents'.length + JSON.stringify(tools[0]).length;
  assert.equal(chars, expected);
});

test('charsOfRequest: an empty request is zero chars', () => {
  assert.equal(charsOfRequest([], [], ctors), 0);
});

test('estimatePreflightCost: full price when there is no cache history yet (ratio 0)', () => {
  const cost = estimatePreflightCost(3700, { prompt: 0.1, completion: 0.5 }, { read: 0.1, write5m: 1.25, write1h: 2 }, 0);
  // 1000 input tokens * 0.1 (full price, ratio 0)
  assert.equal(cost, 1000 * 0.1);
});

test('estimatePreflightCost: blends in the cache-read discount as the ratio approaches 1', () => {
  const cost = estimatePreflightCost(3700, { prompt: 0.1, completion: 0.5 }, { read: 0.1, write5m: 1.25, write1h: 2 }, 1);
  // fully cached: 1000 tokens * 0.1 * 0.1 (read multiplier)
  assert.equal(cost, 1000 * 0.1 * 0.1);
});

test('estimatePreflightCost: no cache rule for this model/flavor means full price regardless of ratio', () => {
  const cost = estimatePreflightCost(3700, { prompt: 0.1, completion: 0.5 }, null, 1);
  assert.equal(cost, 1000 * 0.1);
});

test('checkPreflight: ok when well under every cap', () => {
  const r = checkPreflight({ estimatedCost: 10, spent: { conversation: 0, hourly: 0 }, limits: { sessionCapTokens: 1000, hourlyCapTokens: 1000 } });
  assert.equal(r.level, 'ok');
  assert.equal(r.message, null);
});

test('checkPreflight: warns once the projected session spend crosses the warn fraction', () => {
  const r = checkPreflight({ estimatedCost: 50, spent: { conversation: 760, hourly: 0 }, limits: { sessionCapTokens: 1000, hourlyCapTokens: 0 }, warnFraction: 0.8 });
  assert.equal(r.level, 'warn');
  assert.match(/** @type {string} */ (r.message), /session spend would reach/);
});

test('checkPreflight: stops once the projected spend would exceed the cap minus the reserve', () => {
  const r = checkPreflight({ estimatedCost: 300, spent: { conversation: 800, hourly: 0 }, limits: { sessionCapTokens: 1000, hourlyCapTokens: 0 }, reserve: 50 });
  assert.equal(r.level, 'stop');
  assert.match(/** @type {string} */ (r.message), /would push the session spend/);
});

test('checkPreflight: an hourly cap can stop a request even when the session cap has room', () => {
  const r = checkPreflight({ estimatedCost: 500, spent: { conversation: 0, hourly: 900 }, limits: { sessionCapTokens: 100000, hourlyCapTokens: 1000 } });
  assert.equal(r.level, 'stop');
  assert.match(/** @type {string} */ (r.message), /hourly spend/);
});

test('checkPreflight: a cap of 0 disables that check', () => {
  const r = checkPreflight({ estimatedCost: 1000000, spent: { conversation: 1000000, hourly: 1000000 }, limits: { sessionCapTokens: 0, hourlyCapTokens: 0 } });
  assert.equal(r.level, 'ok');
});

// DEFECTS D6: the balance limit.
const { hoursUntilMonthlyReset } = require('../../src/budget/preflight');
const roomy = { spent: { conversation: 0, hourly: 0 }, limits: { sessionCapTokens: 0, hourlyCapTokens: 0 } };

test('checkPreflight: stops when the estimate exceeds the remaining balance', () => {
  const r = checkPreflight({ ...roomy, estimatedCost: 500, balance: { remaining: 400, monthlyLimit: 10000, hoursToReset: 300 } });
  assert.equal(r.level, 'stop');
  assert.equal(r.source, 'balance');
  assert.match(r.message || '', /only 400 remain/);
});

test('checkPreflight: the reserve is kept back from the balance', () => {
  const at = (/** @type {number} */ reserve) => checkPreflight({ ...roomy, estimatedCost: 100, reserve, balance: { remaining: 150, monthlyLimit: 10000, hoursToReset: 300 } }).level;
  assert.equal(at(0), 'warn', 'covered, but under 20% of the month is left');
  assert.equal(at(100), 'stop', '150 - 100 < 100');
});

test('checkPreflight: warns when the request would leave under (1 - warnFraction) of the monthly limit', () => {
  const r = checkPreflight({ ...roomy, estimatedCost: 100, warnFraction: 0.8, balance: { remaining: 2050, monthlyLimit: 10000, hoursToReset: 300 } });
  assert.equal(r.level, 'warn');
  assert.equal(r.source, 'balance');
  assert.equal(checkPreflight({ ...roomy, estimatedCost: 100, warnFraction: 0.8, balance: { remaining: 2500, monthlyLimit: 10000, hoursToReset: 300 } }).level, 'ok');
});

test('checkPreflight: in the last hours before the monthly reset a shortfall warns instead of blocking', () => {
  const r = checkPreflight({ ...roomy, estimatedCost: 500, balance: { remaining: 400, monthlyLimit: 10000, hoursToReset: 3 } });
  assert.equal(r.level, 'warn');
  assert.match(r.message || '', /monthly reset is under 3 hours away/);
});

test('checkPreflight: an unknown balance changes nothing, and a cap stop wins over a balance warning', () => {
  assert.equal(checkPreflight({ ...roomy, estimatedCost: 500, balance: { remaining: null } }).level, 'ok');
  const r = checkPreflight({ estimatedCost: 500, spent: { conversation: 900, hourly: 0 }, limits: { sessionCapTokens: 1000, hourlyCapTokens: 0 }, balance: { remaining: 2100, monthlyLimit: 10000, hoursToReset: 300 } });
  assert.equal(r.level, 'stop');
  assert.equal(r.source, 'session');
});

test('hoursUntilMonthlyReset: counts to 00:00 UTC on the 1st', () => {
  assert.equal(hoursUntilMonthlyReset(Date.UTC(2026, 8, 30, 21, 0, 0)), 3);
  assert.equal(hoursUntilMonthlyReset(Date.UTC(2026, 11, 31, 0, 0, 0)), 24);
});
