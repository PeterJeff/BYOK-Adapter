// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLedgerWriter } = require('../../src/ledger/writer');
const { readAll, last } = require('../../src/ledger/reader');

/** @returns {import('../../src/ledger/writer').LedgerRecord} */
function record(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    conversationId: 'conv-1',
    tenant: 'public',
    model: 'gpt-5.4-nano',
    resolvedModel: 'gpt-5.4-nano-2026-03-17',
    flavor: 'CC',
    inputUncached: 100,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    visibleOutput: 10,
    thinking: 0,
    thinkingUnknown: false,
    estAsCost: 12.5,
    rateSource: 'tokenizer',
    latencyMs: 250,
    status: 'ok',
    errorClass: null,
    cancelled: false,
    toolCallCount: 0,
    ...overrides,
  };
}

test('appends JSONL lines with no prompt text field, mergeable across files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asksage-ledger-'));
  const writerA = createLedgerWriter(dir);
  const writerB = createLedgerWriter(dir); // simulates a second extension-host process
  writerA.append(record({ conversationId: 'conv-a' }));
  writerB.append(record({ conversationId: 'conv-b' }));
  writerA.append(record({ conversationId: 'conv-a', estAsCost: 5 }));

  assert.notEqual(writerA.filePath, writerB.filePath, 'one file per process, per §3.4');

  const all = readAll(dir);
  assert.equal(all.length, 3);
  for (const r of all) {
    assert.ok(!('prompt' in r) && !('promptText' in r) && !('messages' in r), 'no prompt text in the ledger by default');
  }
  // Cross-file ordering isn't guaranteed at millisecond resolution (readAll sorts by `ts`, and
  // two different processes' files can tie), so check presence, not relative order across files.
  assert.deepEqual(all.map((r) => r.conversationId).sort(), ['conv-a', 'conv-a', 'conv-b']);
  assert.ok(all.some((r) => r.conversationId === 'conv-a' && r.estAsCost === 5));
});

test('last() returns the most recently appended record within a single writer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asksage-ledger-'));
  const writer = createLedgerWriter(dir);
  writer.append(record({ estAsCost: 1 }));
  writer.append(record({ estAsCost: 2 }));
  writer.append(record({ estAsCost: 3 }));
  assert.equal(last(dir).estAsCost, 3);
});

test('readAll tolerates a corrupt line instead of failing the whole read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asksage-ledger-'));
  const writer = createLedgerWriter(dir);
  writer.append(record());
  fs.appendFileSync(writer.filePath, 'not json\n');
  writer.append(record({ estAsCost: 99 }));
  const all = readAll(dir);
  assert.equal(all.length, 2);
});

test('readAll/last on a missing directory return empty', () => {
  assert.deepEqual(readAll('/no/such/dir'), []);
  assert.equal(last('/no/such/dir'), null);
});
