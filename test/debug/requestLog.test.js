// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequestLog } = require('../../src/debug/requestLog');
const { readAll } = require('../../src/ledger/reader'); // same JSONL shape, reused as a generic reader

test('writes one JSONL line per record, including request/response text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asksage-debuglog-'));
  const writer = createRequestLog(dir);
  writer.write({
    ts: new Date().toISOString(),
    conversationId: 'conv-1',
    model: 'gpt-4.1-nano',
    flavor: 'CC',
    attempt: 1,
    request: { model: 'gpt-4.1-nano', messages: [{ role: 'user', content: 'what color is the sky?' }] },
    responseText: "Sorry, I can't assist with that.",
    usage: { prompt_tokens: 100, completion_tokens: 9 },
    resolvedModel: 'gpt-4.1-nano-2025-04-14',
    error: null,
  });
  const all = readAll(dir);
  assert.equal(all.length, 1);
  assert.equal(/** @type {any} */ (all[0]).request.messages[0].content, 'what color is the sky?');
  assert.equal(/** @type {any} */ (all[0]).responseText, "Sorry, I can't assist with that.");
});
