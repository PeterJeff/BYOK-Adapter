// @ts-check
'use strict';

// Same fixtures as test/probe/api-probe.test.mjs (research), pointed at the CommonJS port.

const test = require('node:test');
const assert = require('node:assert/strict');
const { SseParser } = require('../../src/transport/sse');

test('SseParser handles split chunks, CRLF and multi-line data', () => {
  const p = new SseParser();
  const got = [...p.feed('event: a\r\ndata: {"x"'), ...p.feed(':1}\r'), ...p.feed('\n\r\ndata: l1\ndata: l2\n\n: comment\ndata: tail'), ...p.end()];
  assert.deepEqual(got, [{ event: 'a', data: '{"x":1}' }, { data: 'l1\nl2' }, { data: 'tail' }]);
});

test('sseEventJson parses JSON data and passes [DONE] through', () => {
  const { sseEventJson } = require('../../src/transport/sse');
  assert.deepEqual(sseEventJson({ data: '{"a":1}' }), { data: { a: 1 } });
  assert.deepEqual(sseEventJson({ data: '[DONE]' }), { data: '[DONE]' });
  assert.deepEqual(sseEventJson({ data: 'not json' }), { data: null, raw: 'not json' });
});
