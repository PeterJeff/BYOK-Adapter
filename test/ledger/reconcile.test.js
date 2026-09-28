// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { logNumbers, matchLogRows, attributeCause, reconcile } = require('../../src/ledger/reconcile');
const { verdict } = require('../../src/rates/formula');

/** @param {Partial<import('../../src/ledger/writer').LedgerRecord>} o */
function rec(o) {
  return /** @type {import('../../src/ledger/writer').LedgerRecord} */ ({
    ts: '2026-09-28T00:00:00.000Z',
    conversationId: 'conv-1',
    tenant: 'public',
    model: 'gpt-4.1',
    resolvedModel: 'gpt-4.1-2026-01-01',
    flavor: 'CC',
    inputUncached: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    visibleOutput: 0,
    thinking: 0,
    thinkingUnknown: false,
    estAsCost: 100,
    rateSource: 'live',
    latencyMs: 500,
    status: 'ok',
    errorClass: null,
    cancelled: false,
    toolCallCount: 0,
    ...o,
  });
}

test('logNumbers: keeps only the billing fields, drops prompt/response text and ids', () => {
  assert.deepEqual(logNumbers({ id: 5, date_time: 't', model: 'm', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, prompt: 'secret', user_id: 9 }), {
    id: 5,
    date_time: 't',
    model: 'm',
    prompt_tokens: 1,
    completion_tokens: 2,
    total_tokens: 3,
  });
});

test('matchLogRows: pairs a ledger record with the nearest same-model log row within tolerance, one-to-one', () => {
  const a = rec({ ts: '2026-09-28T00:00:00.000Z', model: 'gpt-4.1' });
  const b = rec({ ts: '2026-09-28T00:00:05.000Z', model: 'gpt-4.1' });
  const logRows = [
    { id: 1, date_time: '2026-09-28T00:00:00.500Z', model: 'gpt-4.1', prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    { id: 2, date_time: '2026-09-28T00:00:05.500Z', model: 'gpt-4.1', prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
  ];
  const pairs = matchLogRows([a, b], logRows);
  assert.equal(pairs[0].log?.id, 1);
  assert.equal(pairs[1].log?.id, 2);
});

test('matchLogRows: leaves a record unmatched when no same-model row is within tolerance', () => {
  const a = rec({ ts: '2026-09-28T00:00:00.000Z', model: 'gpt-4.1' });
  const logRows = [{ id: 1, date_time: '2026-09-28T01:00:00.000Z', model: 'gpt-4.1', prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }];
  const pairs = matchLogRows([a], logRows);
  assert.equal(pairs[0].log, null);
});

test('matchLogRows: only reconciles billable (status ok) records', () => {
  const a = rec({ status: 'cancelled' });
  const pairs = matchLogRows([a], []);
  assert.equal(pairs.length, 0);
});

test('attributeCause: not cold (cacheRead > 0) needs no attribution', () => {
  assert.equal(attributeCause(rec({}), rec({ cacheRead: 5 }), 'mixed'), null);
});

test('attributeCause: a conversation\'s first turn is cold but has nothing to compare against', () => {
  assert.equal(attributeCause(null, rec({ cacheRead: 0 }), 'mixed'), null);
});

test('attributeCause: tool-set churn takes priority', () => {
  const prev = rec({ toolSetHash: 'a', thinkingConfigHash: 'x' });
  const curr = rec({ toolSetHash: 'b', thinkingConfigHash: 'x', cacheRead: 0 });
  assert.equal(attributeCause(prev, curr, 'mixed'), 'tool-churn');
});

test('attributeCause: thinking-config change, when tools are unchanged', () => {
  const prev = rec({ toolSetHash: 'a', thinkingConfigHash: 'x' });
  const curr = rec({ toolSetHash: 'a', thinkingConfigHash: 'y', cacheRead: 0 });
  assert.equal(attributeCause(prev, curr, 'mixed'), 'thinking-config-change');
});

test('attributeCause: host failover, when resolvedModel changed but tools/thinking did not', () => {
  const prev = rec({ toolSetHash: 'a', resolvedModel: 'host-a' });
  const curr = rec({ toolSetHash: 'a', resolvedModel: 'host-b', cacheRead: 0 });
  assert.equal(attributeCause(prev, curr, 'mixed'), 'host-failover');
});

test('attributeCause: prefix changed, as the last specific cause before falling back to TTL/unknown', () => {
  const prev = rec({ toolSetHash: 'a', resolvedModel: 'h', prefixHash: 'p1' });
  const curr = rec({ toolSetHash: 'a', resolvedModel: 'h', prefixHash: 'p2', cacheRead: 0 });
  assert.equal(attributeCause(prev, curr, 'mixed'), 'prefix-changed');
});

test('attributeCause: TTL expiry, when nothing else changed but the gap exceeds the TTL window', () => {
  const prev = rec({ ts: '2026-09-28T00:00:00.000Z', toolSetHash: 'a', resolvedModel: 'h', prefixHash: 'p' });
  const curr = rec({ ts: '2026-09-28T00:06:00.000Z', toolSetHash: 'a', resolvedModel: 'h', prefixHash: 'p', cacheRead: 0 });
  assert.equal(attributeCause(prev, curr, '5m'), 'ttl-expiry');
});

test('attributeCause: unknown, when nothing tracked changed and the gap is within TTL', () => {
  const prev = rec({ ts: '2026-09-28T00:00:00.000Z', toolSetHash: 'a', resolvedModel: 'h', prefixHash: 'p' });
  const curr = rec({ ts: '2026-09-28T00:01:00.000Z', toolSetHash: 'a', resolvedModel: 'h', prefixHash: 'p', cacheRead: 0 });
  assert.equal(attributeCause(prev, curr, '5m'), 'unknown');
});

test('reconcile: matches, verdicts and attributes across a small conversation, and rolls up a summary', () => {
  const r1 = rec({ ts: '2026-09-28T00:00:00.000Z', model: 'gpt-4.1', inputUncached: 100, cacheRead: 0, estAsCost: 100, toolSetHash: 'a' });
  const r2 = rec({ ts: '2026-09-28T00:00:10.000Z', model: 'gpt-4.1', inputUncached: 10, cacheRead: 90, estAsCost: 20, toolSetHash: 'a' });
  const r3 = rec({ ts: '2026-09-28T00:00:20.000Z', model: 'gpt-4.1', inputUncached: 100, cacheRead: 0, estAsCost: 100, toolSetHash: 'b' });
  const logRows = [
    { id: 1, date_time: '2026-09-28T00:00:00.200Z', model: 'gpt-4.1', prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
    { id: 2, date_time: '2026-09-28T00:00:10.200Z', model: 'gpt-4.1', prompt_tokens: 100, completion_tokens: 0, total_tokens: 20 },
    { id: 3, date_time: '2026-09-28T00:00:20.200Z', model: 'gpt-4.1', prompt_tokens: 100, completion_tokens: 0, total_tokens: 105 },
  ];
  const { rows, summary } = reconcile({ ledgerRecords: [r1, r2, r3], logRows, verdict, ttlMode: 'mixed' });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].coldCause, null); // first turn of the conversation
  assert.equal(rows[1].coldCause, null); // not cold
  assert.equal(rows[2].coldCause, 'tool-churn');
  assert.equal(rows[0].verdict, 'fits');
  assert.equal(rows[2].verdict, 'fits');
  assert.equal(summary.matched, 3);
  assert.equal(summary.unmatched, 0);
  assert.deepEqual(summary.coldByCause, { 'tool-churn': 1 });
  assert.equal(summary.cacheReadPct, 30); // 90 of 300 cacheable input tokens (100+100+100) read from cache
});
